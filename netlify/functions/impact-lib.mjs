// ─────────────────────────────────────────────────────────────────────────────
// Impact Radar — shared engine (imported by impact-run-background.mjs and
// impact-digest.mjs). Zero dependencies.
//
//   sources (impact_sources)  →  adapters  →  gate  →  impact_items
//   →  Claude triage (score + why + angle)  →  watchlist alerts (Slack DM)
//
// Everything is injected (fetch, env, now) so it can be unit-tested offline.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

export const UA = "GazetteImpactRadar/1.0 (+https://gazettenews.au)";
export const MAX_AGE_HOURS = 72;        // ignore feed entries older than this
export const SCORE_PER_RUN = 60;        // cap on AI scoring per run (cost guard)
export const BATCH = 8;                 // items per AI call
export const TOPICS = ["climate", "energy", "environment", "water", "land & agriculture", "mining & resources", "transport & EVs", "politics & policy", "corporate & finance", "science & data", "local & regional"];
export const KINDS = ["news", "press release", "report / data", "announcement", "social", "opinion"];
export const JURIS = ["national", "NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "unknown"];
export const MASTHEADS = ["Eastern Melburnian", "North Shore Lorikeet", "West Vic Brolga", "Gippsland Monitor", "Mid North Coaster", "National Account"];

// ── text helpers ─────────────────────────────────────────────────────────────
export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "’").replace(/&#8216;/g, "‘").replace(/&#8212;/g, "—").replace(/&#8211;/g, "–")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } })
    .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() : "";
};
const attr = (block, tag, name) => { const m = block.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, "i")); return m ? m[1] : ""; };

// RSS 2.0 and Atom.
export function parseFeed(xml) {
  const out = [];
  const x = String(xml || "");
  if (/<entry[\s>]/i.test(x) && !/<item[\s>]/i.test(x)) {
    for (const raw of x.split(/<entry[\s>]/i).slice(1)) {
      const b = raw.split(/<\/entry>/i)[0];
      let link = ""; const links = b.match(/<link\b[^>]*>/gi) || [];
      for (const l of links) { const rel = (l.match(/rel="([^"]*)"/i) || [])[1]; const href = (l.match(/href="([^"]*)"/i) || [])[1]; if (href && (!rel || rel === "alternate")) { link = href; break; } }
      const title = stripHtml(pick(b, "title")); const pub = pick(b, "published") || pick(b, "updated");
      if (title && link) out.push({ title, url: link.replace(/&amp;/g, "&"), summary: stripHtml(pick(b, "summary") || pick(b, "content")).slice(0, 600), published: pub ? new Date(pub) : null });
    }
    return out;
  }
  for (const raw of x.split(/<item[\s>]/i).slice(1)) {
    const b = raw.split(/<\/item>/i)[0];
    const title = stripHtml(pick(b, "title")); const link = stripHtml(pick(b, "link")) || pick(b, "guid");
    const pub = pick(b, "pubDate") || pick(b, "dc:date");
    const src = stripHtml(pick(b, "source"));
    if (title && link) out.push({ title, url: link, summary: stripHtml(pick(b, "content:encoded") || pick(b, "description")).slice(0, 600), published: pub ? new Date(pub) : null, sourceName: src || null });
  }
  return out;
}

export function normUrl(u) {
  try {
    const x = new URL(u); x.hash = ""; x.hostname = x.hostname.toLowerCase();
    [...x.searchParams.keys()].forEach((k) => { if (/^utm_/i.test(k) || ["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ocid"].includes(k.toLowerCase())) x.searchParams.delete(k); });
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, "");
    return x.toString();
  } catch { return String(u || "").trim(); }
}
export const sha = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");
export function titleKey(title, sourceName) {
  let t = String(title || "").toLowerCase();
  if (sourceName) t = t.replace(new RegExp("\\s[-–|]\\s" + sourceName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$"), "");
  else t = t.replace(/\s[-–|]\s[^-–|]{2,40}$/, "");
  return sha(t.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 14).join(" "));
}

// ── relevance gate (cheap, before any AI) ────────────────────────────────────
export const IMPACT_RE = /\b(climate|emissions?|carbon|net[- ]zero|renewables?|solar|wind farms?|offshore wind|batter(?:y|ies)|hydrogen|nuclear|coal|gas|lng|fracking|oil|fuel|energy|electricity|power (?:prices?|bills?|stations?|plants?|outages?)|grid|aemo|nem|transmission|pipelines?|aer|clean energy|safeguard|offsets?|epbc|environment(?:al)?|biodiversity|extinction|threatened|endangered|koalas?|wildlife|habitat|reef|marine|coral|bushfires?|fire season|floods?|drought|heatwaves?|cyclones?|water|murray|darling|rivers?|dams?|irrigation|mining|mines?|pollution|contaminat\w*|pfas|epa|waste|recycl\w*|plastics?|landfill|forests?|logging|native vegetation|land clearing|agricultur\w*|fossil|woodside|santos|origin energy|agl|whitehaven|data cent(?:er|re)s?|evs?|electric vehicles?|greenwash\w*|esg|subsid\w*|rebates?|default market offer|price cap)\b/i;
export const ASX_NOISE = /appendix 3[a-z]|appendix 2a|appendix 4|change of director|substantial holder|becoming a substantial|ceasing to be a substantial|notice of (?:annual|general)|cleansing|application for quotation|proposed issue of securities|trading halt|reinstatement to quotation|quotation of securities|dividend\/distribution|^investor presentation$|^notification regarding unquoted|issue of securities|pause in trading/i;
export const passesGate = (title, summary) => IMPACT_RE.test(`${title} ${summary || ""}`);

// ── adapters: each returns [{title,url,summary,published,key?,sourceName?}] ──
export async function fetchText(fetchImpl, url, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: opts.accept || "*/*", ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
export async function adapterRss(src, ctx) { return parseFeed(await fetchText(ctx.fetch, src.url)).slice(0, 60); }
export async function adapterHtml(src, ctx) {
  const html = await fetchText(ctx.fetch, src.url);
  const base = new URL(src.url); const inc = src.config && src.config.include ? new RegExp(src.config.include, "i") : null;
  const seen = new Set(); const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(m[1].replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
    const title = stripHtml(m[2]);
    if (title.length < 20 || title.length > 220) continue;
    if (inc && !inc.test(href)) continue;
    const k = normUrl(href); if (seen.has(k)) continue; seen.add(k);
    out.push({ title, url: href, summary: "", published: null });
    if (out.length >= 40) break;
  }
  return out;
}
export async function adapterMastodon(src, ctx) {
  const host = (src.config && src.config.host) || "mastodon.au"; const out = [];
  for (const tag of (src.config && src.config.tags) || []) {
    const rows = JSON.parse(await fetchText(ctx.fetch, `https://${host}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`, { accept: "application/json" }));
    for (const s of rows) {
      if (s.reblog || (s.language && s.language !== "en")) continue;
      const text = stripHtml(s.content); if (text.length < 40 || !s.url) continue;
      out.push({ title: `${s.account && s.account.acct ? "@" + s.account.acct + ": " : ""}${text.slice(0, 160)}`, url: s.url, summary: text.slice(0, 600), published: s.created_at ? new Date(s.created_at) : null });
    }
  }
  return out;
}
export async function adapterBluesky(src, ctx) {
  const { BSKY_HANDLE, BSKY_APP_PASSWORD } = ctx.env;
  if (!BSKY_HANDLE || !BSKY_APP_PASSWORD) throw new Error("needs BSKY_HANDLE and BSKY_APP_PASSWORD in Netlify");
  const s = await ctx.fetch("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD }) });
  if (!s.ok) throw new Error(`Bluesky login HTTP ${s.status}`);
  const jwt = (await s.json()).accessJwt; const out = [];
  for (const q of (src.config && src.config.queries) || []) {
    const r = JSON.parse(await fetchText(ctx.fetch, `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25&sort=latest&lang=en`, { headers: { Authorization: `Bearer ${jwt}` }, accept: "application/json" }));
    for (const p of r.posts || []) {
      const text = (p.record && p.record.text) || ""; if (text.length < 40) continue;
      const rkey = String(p.uri || "").split("/").pop(); const handle = p.author && p.author.handle;
      out.push({ title: `@${handle}: ${text.slice(0, 160)}`, url: `https://bsky.app/profile/${handle}/post/${rkey}`, summary: text.slice(0, 600), published: p.record && p.record.createdAt ? new Date(p.record.createdAt) : null });
    }
  }
  return out;
}
export async function adapterAsx(src, ctx) {
  const out = []; const cutoff = ctx.now - 3 * 864e5;
  for (const code of (src.config && src.config.codes) || []) {
    let j; try { j = JSON.parse(await fetchText(ctx.fetch, `https://asx.api.markitdigital.com/asx-research/1.0/companies/${code.toLowerCase()}/announcements`, { accept: "application/json" })); } catch (e) { if (ctx.strictAsx) throw e; continue; }
    for (const a of (j.data && j.data.items) || []) {
      const d = new Date(a.date); if (!(d.getTime() >= cutoff)) continue;
      if (ASX_NOISE.test(a.headline || "")) continue;
      out.push({ title: `${a.isPriceSensitive ? "⚡ " : ""}${code.toUpperCase()}: ${a.headline}`, url: `https://www.asx.com.au/markets/trade-our-cash-market/announcements.${code.toLowerCase()}`, summary: `ASX announcement${a.isPriceSensitive ? " (price sensitive)" : ""} by ${j.data.displayName || code}`, published: d, key: `asx:${code.toLowerCase()}:${a.documentKey}` });
    }
  }
  return out;
}
export const ADAPTERS = { rss: adapterRss, html: adapterHtml, mastodon: adapterMastodon, bluesky: adapterBluesky, asx: adapterAsx };

// ── watchlists ───────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function matchWatch(item, lists) {
  const hay = `${item.title} ${item.summary || ""}`;
  const hits = [];
  for (const l of lists || []) {
    if (l.active === false) continue;
    if ((l.terms || []).some((t) => { t = String(t).trim(); if (!t) return false; return new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`, "i").test(hay); })) hits.push(l.label);
  }
  return hits;
}

// ── AI triage ────────────────────────────────────────────────────────────────
export const SCORE_SYSTEM = `You are the triage desk for the Impact editor at Gazette, a network of Australian local news mastheads.
Impact reporting covers climate, energy and the environment, and especially where they collide with politics, policy and money. The editor wants consequential, original, story-ready leads that hold power to account or show readers the local consequences of national and state decisions.

For every numbered item give:
- relevance 0-100:
  90-100: primary-source and story-ready now (a decision, approval, regulator finding, official document or data release, court ruling, major announcement) with clear consequences for people in Australia.
  70-89: strongly on-beat and worth the editor's attention today.
  40-69: useful background, commentary, an incremental development, or relevant only by a stretch.
  0-39: not our beat, non-Australian, trivia, a routine corporate/admin notice, or nothing new.
- topics (from the allowed list), kind, jurisdiction (the Australian state or "national"; "unknown" if unclear), and mastheads: which of our mastheads' patches this could genuinely touch (Eastern Melburnian = Melbourne's east; North Shore Lorikeet = Sydney's north shore; West Vic Brolga = Ballarat and western Victoria; Gippsland Monitor = Gippsland and Western Port; Mid North Coaster = NSW mid north coast; National Account = national stories). Use [] if none.
- why: one plain sentence (max 22 words) naming the concrete thing that is new or notable. No hype. If only a headline was given, say so.
- angle: only if relevance >= 55; max 28 words; a reportable angle with an accountability or local hook. Otherwise an empty string.

Rules: use only the text provided; never invent facts, numbers or names. Social posts score 50 or below unless they carry primary information (a document, official statement, data or eyewitness account). Routine ASX/admin notices score 20 or below. Opinion with no new information scores 45 or below.`;

export const SCORE_TOOL = {
  name: "score_items",
  description: "Return a triage result for every numbered item.",
  input_schema: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: {
    i: { type: "integer" }, relevance: { type: "integer", minimum: 0, maximum: 100 },
    topics: { type: "array", items: { type: "string", enum: TOPICS } }, kind: { type: "string", enum: KINDS }, jurisdiction: { type: "string", enum: JURIS },
    mastheads: { type: "array", items: { type: "string", enum: MASTHEADS } }, why: { type: "string" }, angle: { type: "string" },
  }, required: ["i", "relevance", "topics", "kind", "jurisdiction", "why"] } } }, required: ["results"] },
};
export function scoreUser(items) {
  return "Triage these items.\n\n" + items.map((it, n) => `[${n}] ${it.source_name} (${it.category}) · ${it.published_at ? String(it.published_at).slice(0, 10) : "undated"}\n${it.title}\n${(it.summary || "(headline only)").slice(0, 500)}`).join("\n\n");
}
export function clampScore(r) {
  const arr = (v, allowed) => (Array.isArray(v) ? v.filter((x) => allowed.includes(x)) : []);
  return {
    relevance: Math.max(0, Math.min(100, Math.round(Number(r.relevance) || 0))),
    topics: arr(r.topics, TOPICS), kind: KINDS.includes(r.kind) ? r.kind : "news", jurisdiction: JURIS.includes(r.jurisdiction) ? r.jurisdiction : "unknown",
    mastheads: arr(r.mastheads, MASTHEADS), why: String(r.why || "").slice(0, 240), angle: String(r.angle || "").slice(0, 300),
  };
}
export async function scoreBatch(items, ctx) {
  const body = JSON.stringify({ model: ctx.model, max_tokens: 3000, system: SCORE_SYSTEM, tools: [SCORE_TOOL], tool_choice: { type: "tool", name: "score_items" }, messages: [{ role: "user", content: scoreUser(items) }] });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await ctx.fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": ctx.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body });
      const raw = await r.text(); let d; try { d = JSON.parse(raw); } catch { throw new Error(`API not JSON (HTTP ${r.status})`); }
      if (!r.ok || d.error) throw new Error((d.error && d.error.message) || `HTTP ${r.status}`);
      const block = (d.content || []).find((b) => b.type === "tool_use"); if (!block) throw new Error("no tool_use block");
      const byI = {}; ((block.input && block.input.results) || []).forEach((x) => { byI[x.i] = clampScore(x); });
      return items.map((_, n) => byI[n] || null);
    } catch (e) { lastErr = e; if (attempt === 0) await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(1500); }
  }
  throw lastErr;
}

// ── Supabase REST (service role) ─────────────────────────────────────────────
export function db(ctx) {
  const base = `${ctx.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co"}/rest/v1`;
  const h = { apikey: ctx.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${ctx.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const chk = async (r) => { if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`); return r; };
  return {
    get: async (path) => (await chk(await ctx.fetch(`${base}/${path}`, { headers: h }))).json(),
    insertIgnore: async (table, rows, conflict) => (await chk(await ctx.fetch(`${base}/${table}?on_conflict=${conflict}`, { method: "POST", headers: { ...h, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rows) }))).json(),
    insert: async (table, row) => (await chk(await ctx.fetch(`${base}/${table}`, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(row) }))).json(),
    patch: async (path, row) => { await chk(await ctx.fetch(`${base}/${path}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(row) })); },
  };
}
export async function sendDM(ctx, text) {
  const { SLACK_BOT_TOKEN, IMPACT_EDITOR_SLACK_ID } = ctx.env;
  if (!SLACK_BOT_TOKEN || !IMPACT_EDITOR_SLACK_ID) return false;
  const r = await ctx.fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: IMPACT_EDITOR_SLACK_ID, text, unfurl_links: false }) });
  const j = await r.json(); if (!j.ok) throw new Error("Slack: " + j.error); return true;
}
const SITE = (ctx) => ctx.env.URL || "https://gari-planner.netlify.app";
export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
export function alertText(items, site) {
  const lines = [`:satellite_antenna: *Impact Radar — watchlist ${items.length > 1 ? "hits" : "hit"}*`];
  items.slice(0, 8).forEach((it) => lines.push(`• *${(it.watch_hits || []).join(", ")}* — <${it.url}|${clip(it.title, 110)}> _(${it.source_name})_${it.why ? "\n   " + clip(it.why, 160) : ""}`));
  if (items.length > 8) lines.push(`_+${items.length - 8} more_`);
  lines.push(`<${site}/impact|Open the Radar>`); return lines.join("\n");
}

// ── one full run ─────────────────────────────────────────────────────────────
export async function run(ctx) {
  const D = db(ctx); const started = new Date(ctx.now);
  const stats = { fetched: 0, inserted: 0, scored: 0, errors: [] };
  // throttle: the endpoint is public, so don't let hammering run up AI cost
  try {
    const last = await D.get("impact_runs?select=started_at&order=started_at.desc&limit=1");
    if (last[0] && ctx.now - Date.parse(last[0].started_at) < (ctx.minGapMs ?? 8 * 60e3)) return { skipped: "ran recently" };
  } catch (e) { stats.errors.push("throttle check: " + e.message); }
  const runRow = (await D.insert("impact_runs", { started_at: started.toISOString() }))[0];

  const [sources, lists] = await Promise.all([D.get("impact_sources?active=eq.true&select=*"), D.get("impact_watchlists?active=eq.true&select=*")]);
  const existing = new Set((await D.get(`impact_items?select=title_key&fetched_at=gte.${new Date(ctx.now - 4 * 864e5).toISOString()}&limit=8000`)).map((r) => r.title_key));
  const seenTitle = new Set(existing);
  const fresh = [];

  // 1. fetch every source (4 at a time), record health per source
  const queue = sources.slice();
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const src = queue.shift(); const patch = { last_run: new Date(ctx.now).toISOString() };
      try {
        const ad = ADAPTERS[src.kind]; if (!ad) throw new Error("unknown kind " + src.kind);
        const got = await ad(src, ctx); let kept = 0;
        for (const g of got) {
          stats.fetched++;
          if (g.published && ctx.now - g.published.getTime() > MAX_AGE_HOURS * 3600e3) continue;
          const trusted = !!(src.config && src.config.trusted) || src.kind === "asx";
          if (!trusted && !passesGate(g.title, g.summary)) continue;
          const tk = titleKey(g.title, g.sourceName);
          if (src.category !== "social" && seenTitle.has(tk)) continue;
          seenTitle.add(tk);
          const urlKey = g.key || sha(normUrl(g.url));
          const item = { source_id: src.id, source_name: g.sourceName ? `${g.sourceName} (via ${src.name})` : src.name, category: src.category, url: g.url, url_key: urlKey, title_key: tk, title: g.title.slice(0, 400), summary: g.summary || null,
            published_at: g.published ? g.published.toISOString() : null, fetched_at: new Date(ctx.now).toISOString() };
          item.watch_hits = matchWatch(item, lists);
          fresh.push(item); kept++;
        }
        patch.last_ok = new Date(ctx.now).toISOString(); patch.last_count = kept; patch.last_error = null;
      } catch (e) { patch.last_error = String(e.message || e).slice(0, 200); stats.errors.push(`${src.name}: ${patch.last_error}`); }
      try { await D.patch(`impact_sources?id=eq.${src.id}`, patch); } catch (e) { stats.errors.push("health: " + e.message); }
    }
  }));

  // 2. insert new (url_key unique → duplicates ignored)
  for (let i = 0; i < fresh.length; i += 50) {
    try { const ins = await D.insertIgnore("impact_items", fresh.slice(i, i + 50), "url_key"); stats.inserted += ins.length; } catch (e) { stats.errors.push("insert: " + e.message); }
  }

  // 3. AI triage of anything unscored
  if (!ctx.env.ANTHROPIC_API_KEY) stats.errors.push("ANTHROPIC_API_KEY missing — items are saved but not scored");
  else {
    let todo = [];
    try { todo = await D.get(`impact_items?scored_at=is.null&score_tries=lt.3&order=fetched_at.desc&limit=${SCORE_PER_RUN}&select=id,title,summary,source_name,category,published_at,score_tries`); } catch (e) { stats.errors.push("load unscored: " + e.message); }
    const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    const q2 = batches.slice();
    await Promise.all(Array.from({ length: Math.min(2, q2.length) }, async () => {
      while (q2.length) {
        const b = q2.shift();
        try {
          const res = await scoreBatch(b, ctx);
          for (let n = 0; n < b.length; n++) {
            if (!res[n]) { await D.patch(`impact_items?id=eq.${b[n].id}`, { score_tries: (b[n].score_tries || 0) + 1 }); continue; }
            await D.patch(`impact_items?id=eq.${b[n].id}`, { ...res[n], scored_at: new Date(ctx.now).toISOString() }); stats.scored++;
          }
        } catch (e) { stats.errors.push("AI: " + e.message); for (const it of b) { try { await D.patch(`impact_items?id=eq.${it.id}`, { score_tries: (it.score_tries || 0) + 1 }); } catch {} } }
      }
    }));
  }

  // 4. watchlist alerts (scored, or given up on) → DM once
  try {
    const cand = (await D.get(`impact_items?alerted=eq.false&fetched_at=gte.${new Date(ctx.now - 6 * 3600e3).toISOString()}&select=id,title,url,source_name,why,watch_hits,scored_at,score_tries&order=fetched_at.desc&limit=100`))
      .filter((r) => (r.watch_hits || []).length && (r.scored_at || (r.score_tries || 0) >= 3));
    const alertLabels = new Set(lists.filter((l) => l.alert !== false).map((l) => l.label));
    const toSend = cand.filter((r) => r.watch_hits.some((h) => alertLabels.has(h)));
    if (toSend.length) {
      const sent = await sendDM(ctx, alertText(toSend, SITE(ctx)));
      if (sent) for (const r of toSend) await D.patch(`impact_items?id=eq.${r.id}`, { alerted: true });
    }
  } catch (e) { stats.errors.push("alerts: " + e.message); }

  try { await D.patch(`impact_runs?id=eq.${runRow.id}`, { finished_at: new Date().toISOString(), fetched: stats.fetched, inserted: stats.inserted, scored: stats.scored, errors: stats.errors.length ? stats.errors.join(" | ").slice(0, 1500) : null }); } catch {}
  return stats;
}

// ── daily digest text (pure) ─────────────────────────────────────────────────
export function digestText({ items, hitCount, savedOld, site, today }) {
  if (!items.length && !hitCount) return null;
  const L = [`:satellite_antenna: *Impact Radar — ${today}*`];
  if (items.length) { L.push("*Top of the last 24 hours*"); items.forEach((it) => L.push(`• *${it.relevance}* <${it.url}|${clip(it.title, 110)}> _(${it.source_name})_\n   ${clip(it.why || "", 170)}`)); }
  if (hitCount) L.push(`:eyes: ${hitCount} watchlist hit${hitCount > 1 ? "s" : ""} in the last day`);
  if (savedOld) L.push(`:pushpin: ${savedOld} saved lead${savedOld > 1 ? "s" : ""} untouched for 3+ days`);
  L.push(`<${site}/impact|Open the Radar>`); return L.join("\n");
}
