// Background search — Netlify function (lean version)
//
// action "lookup"  FREE: ABN Lookup API + Gazette archive (RSS) + any shared dig from the last 30 days.
// action "dig"     PAID, capped: one Haiku call, max 3 web searches → findings + angles. Saved and shared.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (required)
//   ABR_GUID          (required for business records; free from ABN Lookup web services)
//   ANTHROPIC_API_KEY (required for Dig deeper)
//   BG_RSS_FEEDS      (comma-separated masthead RSS URLs for the archive search)
//   BG_DAILY_CAP      (digs per reporter per day, default 5)
//   BG_MODEL          (default claude-haiku-5-5)
//   BG_MAX_SEARCHES   (default 3)
//   BG_SEARCH_TOOL    (default web_search_20250305)

const SB_URL = process.env.SUPABASE_URL;
const MODEL = process.env.BG_MODEL || "claude-haiku-5-5";
const MAX_SEARCHES = Number(process.env.BG_MAX_SEARCHES || 3);
const DAILY_CAP = Number(process.env.BG_DAILY_CAP || 5);
const SEARCH_TOOL = process.env.BG_SEARCH_TOOL || "web_search_20250305";
const SHARE_DAYS = 30;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// ---------- Auth + Supabase ----------
async function verifyUser(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: process.env.SUPABASE_ANON_KEY } });
  return r.ok ? r.json() : null;
}
async function sb(path, method = "GET", body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

// ---------- Free: ABN Lookup ----------
async function abr(path) {
  const r = await fetch(`https://abr.business.gov.au/json/${path}&guid=${process.env.ABR_GUID}`);
  const t = await r.text();
  return JSON.parse(t.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, ""));
}
async function abnLookup(name) {
  if (!process.env.ABR_GUID) return { error: "ABN Lookup not configured" };
  const surname = name.trim().split(/\s+/).pop();
  const seen = new Map();
  for (const q of [...new Set([name, surname])]) {
    const m = await abr(`MatchingNames.aspx?name=${encodeURIComponent(q)}&maxResults=15`).catch(() => ({}));
    for (const n of m.Names || []) if (!seen.has(n.Abn)) seen.set(n.Abn, n);
  }
  const top = [...seen.values()].sort((a, b) => b.Score - a.Score).slice(0, 8);
  const details = await Promise.all(top.map((n) => abr(`AbnDetails.aspx?abn=${n.Abn}`).catch(() => null)));
  return {
    records: details.filter((d) => d && d.Abn).map((d) => ({
      abn: d.Abn,
      entity: d.EntityName,
      type: d.EntityTypeName,
      status: d.AbnStatus,
      status_from: d.AbnStatusEffectiveFrom,
      gst: d.Gst || null,
      state: d.AddressState,
      postcode: d.AddressPostcode,
      business_names: d.BusinessName || [],
      url: `https://abr.business.gov.au/ABN/View/${d.Abn}`,
    })),
  };
}

// ---------- Free: Gazette archive via RSS ----------
function rssItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s\S]*?<\/item>/g)) {
    const get = (tag) => {
      const x = m[0].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    items.push({ title: get("title"), link: get("link"), date: get("pubDate"), text: get("description") + " " + get("content:encoded") });
  }
  return items;
}
async function archiveSearch(name) {
  const feeds = (process.env.BG_RSS_FEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!feeds.length) return { error: "Archive feeds not configured" };
  const needle = norm(name);
  const surname = needle.split(" ").pop();
  const results = await Promise.all(feeds.map(async (f) => {
    try {
      const xml = await (await fetch(f)).text();
      return rssItems(xml).filter((i) => {
        const hay = norm(i.title + " " + i.text.replace(/<[^>]+>/g, " "));
        return hay.includes(needle) || (surname.length > 3 && hay.includes(surname) && hay.includes(needle.split(" ")[0]));
      }).map((i) => ({ title: i.title, link: i.link, date: i.date, feed: new URL(f).hostname }));
    } catch { return []; }
  }));
  return { stories: results.flat().slice(0, 20) };
}

// ---------- Paid: one Haiku call ----------
const GUARDRAILS = `You are a research assistant for a regional Australian newsroom, backgrounding a person from PUBLIC RECORDS for possible journalism.
HARD RULES — never break these:
- Never return a home address, suburb of residence, or anything locating where they live. Business addresses are fine.
- Never return personal phone numbers or personal emails. Only published business, office or campaign contacts.
- Never name or describe family members, partners or children.
- Never return private social accounts or property ownership.
- Health or similar personal details only if they discussed it in media; tag category "sensitive".
- Only report what sources state; every finding needs a URL. If a result might be a different person with the same name, leave it out and add a flag.
- Neutral, defamation-safe wording. Never call anything wrongdoing unless a court, tribunal or regulator found it.
- Australian spelling. Be brief.`;

const digSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: { type: "array", items: { type: "object", properties: {
      date: { type: "string" }, fact: { type: "string" },
      category: { type: "string", enum: ["business", "politics", "public_role", "legal", "media", "own_voice", "sensitive"] },
      source_url: { type: "string" } }, required: ["fact", "category", "source_url"] } },
    contacts: { type: "array", items: { type: "object", properties: {
      label: { type: "string" }, value: { type: "string" }, source_url: { type: "string" } }, required: ["value", "source_url"] } },
    flags: { type: "array", items: { type: "string" } },
    angles: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    right_of_reply: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "findings", "flags", "angles", "questions", "right_of_reply"],
};

async function dig(p, abnRecords) {
  const tools = [
    { type: SEARCH_TOOL, name: "web_search", max_uses: MAX_SEARCHES, user_location: { type: "approximate", country: "AU" } },
    { name: "report", description: "Submit the final result. Call once, at the end.", input_schema: digSchema },
  ];
  const known = abnRecords?.length
    ? `Business records already found (don't search for these again):\n${abnRecords.map((r) => `${r.entity} (${r.status}, ${r.state} ${r.postcode}; names: ${r.business_names.join("; ") || "none"})`).join("\n")}`
    : "";
  const user = `Person: ${p.name}${p.region ? `, ${p.region}` : ""}${p.role ? `, ${p.role}` : ""}.
${known}
With at most ${MAX_SEARCHES} searches, find the most newsworthy public record: political candidacies and results, public roles, court/tribunal/regulator decisions, notable media coverage, and claims they make about themselves. Collect any published business/office contacts.
Then give 2–3 story angles, 3–5 hard but fair questions, and anything adverse to put to them. Call report.`;

  let messages = [{ role: "user", content: user }];
  for (let turn = 0; turn < 3; turn++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: GUARDRAILS, tools, messages }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const rep = data.content.find((b) => b.type === "tool_use" && b.name === "report");
    if (rep) return rep.input;
    messages = data.stop_reason === "pause_turn"
      ? [...messages, { role: "assistant", content: data.content }]
      : [...messages, { role: "assistant", content: data.content }, { role: "user", content: "Now call report with your result." }];
  }
  throw new Error("No result returned");
}

// ---------- Handler ----------
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const user = await verifyUser(req);
  if (!user) return json(401, { error: "Not signed in" });

  let p;
  try { p = await req.json(); } catch { return json(400, { error: "Bad JSON" }); }
  if (!p.name || typeof p.name !== "string" || p.name.length > 120) return json(400, { error: "Name required" });
  const name_norm = norm(p.name);
  const since = new Date(Date.now() - SHARE_DAYS * 864e5).toISOString();
  // Start of today in Sydney time, as a UTC instant.
  const now = new Date();
  const sydNow = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const today = new Date(now.getTime() - (sydNow.getHours() * 3600 + sydNow.getMinutes() * 60 + sydNow.getSeconds()) * 1000 - now.getMilliseconds());

  try {
    if (p.action === "lookup") {
      const [abn, archive, shared, usedToday] = await Promise.all([
        abnLookup(p.name).catch((e) => ({ error: e.message })),
        archiveSearch(p.name).catch((e) => ({ error: e.message })),
        sb(`background_searches?name_norm=eq.${encodeURIComponent(name_norm)}&dug=eq.true&created_at=gte.${since}&order=created_at.desc&limit=1&select=id,region,role,dossier,created_at`),
        sb(`background_searches?user_id=eq.${user.id}&dug=eq.true&created_at=gte.${today.toISOString()}&select=id`),
      ]);
      await sb("background_searches", "POST", {
        user_id: user.id, user_email: user.email, name: p.name, name_norm, region: p.region || null, role: p.role || null, dug: false,
      });
      return json(200, { abn, archive, shared: shared[0] || null, digs_left: Math.max(0, DAILY_CAP - usedToday.length) });
    }

    if (p.action === "dig") {
      const usedToday = await sb(`background_searches?user_id=eq.${user.id}&dug=eq.true&created_at=gte.${today.toISOString()}&select=id`);
      if (usedToday.length >= DAILY_CAP) return json(429, { error: `Daily limit of ${DAILY_CAP} digs reached` });
      const result = await dig(p, p.abn_records);
      await sb("background_searches", "POST", {
        user_id: user.id, user_email: user.email, name: p.name, name_norm, region: p.region || null, role: p.role || null,
        dug: true, dossier: result,
      });
      return json(200, { result, digs_left: DAILY_CAP - usedToday.length - 1 });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(500, { error: String(e.message || e) });
  }
};

export const config = { path: "/api/background" };
