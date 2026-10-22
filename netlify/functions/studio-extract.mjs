// ─────────────────────────────────────────────────────────────────────────────
// Studio auto-fill: reads one published story URL and returns the pieces the Studio
// templates need (headline, emphasis phrase, deck, pull quote, three short carousel
// beats, caption, byline, lead photo).
//
// GARI principle applied: it does not write the story for the reporter. Headline,
// quote and byline are taken from the page; the three carousel beats must be built
// only from facts in the article; the pull quote must be word-for-word. The function
// checks both after the model answers and returns `warnings` for anything it cannot
// find in the article, so a person always reviews before posting.
//
// Auth: caller must be a signed-in user (Supabase token in the Authorization header).
// Env vars (already on the site): ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
// optional SUPABASE_URL, STUDIO_MODEL (defaults to IMPACT_MODEL, then claude-haiku-5-5).
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const J = { "Content-Type": "application/json" };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: J });

// ── pure helpers (exported for tests) ────────────────────────────────────────
export function safeUrl(u) {
  let x; try { x = new URL(String(u || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const h = x.hostname.toLowerCase();
  if (h === "localhost" || !h.includes(".") || /\.(local|internal|lan)$/.test(h)) return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "::1" || h.startsWith("[")) return null;
  return x.toString();
}
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&rsquo;|&#8217;/g, "’").replace(/&lsquo;|&#8216;/g, "‘").replace(/&ldquo;|&#8220;/g, "“").replace(/&rdquo;|&#8221;/g, "”").replace(/&ndash;|&#8211;/g, "–").replace(/&mdash;|&#8212;/g, "—")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"); const tag = html.match(re); if (!tag) return "";
  const c = tag[0].match(/content=["']([^"']*)["']/i); return c ? decode(c[1]).trim() : "";
};
export function extractPage(html, baseUrl) {
  const title = meta(html, "og:title") || meta(html, "twitter:title") || ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const description = meta(html, "og:description") || meta(html, "description");
  let image = meta(html, "og:image") || meta(html, "twitter:image");
  if (image) { try { image = new URL(image, baseUrl).toString(); } catch { image = ""; } }
  const byline = meta(html, "author") || meta(html, "article:author") || meta(html, "parsely-author");
  const site = meta(html, "og:site_name");
  let body = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const art = body.match(/<article\b[\s\S]*?<\/article>/i); if (art) body = art[0];
  body = body.replace(/<\/(p|h[1-6]|li|blockquote|div|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  const text = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1).join("\n").slice(0, 14000);
  return { title: decode(title), description: decode(description), image, byline: decode(byline), site: decode(site), text };
}
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
export function checkOutput(out, page) {
  const hay = norm(page.text + " " + page.title + " " + page.description); const warnings = [];
  if (out.pullQuote) {
    const q = norm(out.pullQuote).replace(/^["']|["']$/g, "");
    if (!hay.includes(q)) { warnings.push("Pull quote is not word-for-word in the article, so it was removed: “" + out.pullQuote.slice(0, 80) + "”"); out.pullQuote = ""; out.quoteSpeaker = ""; }
  }
  if (out.emphasis && !norm(out.headline).includes(norm(out.emphasis))) out.emphasis = "";
  (out.slides || []).forEach((s) => {
    const nums = String(s.body || "").match(/\d[\d,.]*/g) || [];
    nums.forEach((n) => { const bare = n.replace(/[,.]+$/, ""); if (bare && !hay.includes(bare.replace(/,/g, "")) && !hay.includes(bare)) warnings.push(`“${s.label}” says ${bare}, which isn’t in the article — check it.`); });
  });
  return warnings;
}

// ── model call ───────────────────────────────────────────────────────────────
const TOOL = {
  name: "studio_fill",
  description: "Return the text for a set of social graphics built from one published story.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "The story's own headline, trimmed only if over 14 words. Keep the reporter's wording." },
      emphasis: { type: "string", description: "A phrase of 2-4 words copied exactly from `headline` that deserves a highlight. Empty string if none." },
      deck: { type: "string", description: "One sentence (max 22 words) taken from or closely following the article's own standfirst." },
      pullQuote: { type: "string", description: "One quote that appears word-for-word in the article, 6-28 words. Empty string if the article has no good quote." },
      quoteSpeaker: { type: "string", description: "Who said it, e.g. 'Nicole Thomson, vineyard owner'. Empty if no quote." },
      stat: { type: "string", description: "One number from the article as it is written there (e.g. '39 grape varieties'). Empty if none stands out." },
      statCaption: { type: "string", description: "Max 14 words saying what the number is. Empty if no stat." },
      slides: {
        type: "array", minItems: 3, maxItems: 3,
        items: { type: "object", properties: { label: { type: "string" }, body: { type: "string", description: "Max 55 words. Facts from the article only." } }, required: ["label", "body"] },
        description: "Exactly three beats labelled 'What happened?', 'Why does it matter?', 'Now what?'."
      },
      caption: { type: "string", description: "Instagram caption, max 60 words, in the masthead's plain voice. No hashtags, no emoji." },
    },
    required: ["headline", "deck", "slides", "caption"],
  },
};
const SYSTEM = `You prepare text for social graphics for Gazette Network, a regional Australian newsroom. You work from ONE published story and you coach, you do not write: keep the reporter's own words and framing wherever possible.
Rules:
- Use only facts that are in the article. Never add a fact, a number, a name or a claim that is not there.
- Humanise numbers (say "about 8 in 10", not "79.6%") unless the exact figure is the point.
- The pull quote must be copied exactly as it appears in the article. If the article has no strong quote, return an empty string. Do not paraphrase quotes.
- If the article has a single source or an advocate with a commercial or political interest, keep that attribution in the slide text ("according to ...").
- Plain, concrete, regional. No hype, no cliches, no rhetorical questions in body text, no emoji, no hashtags.
- Dates and places exactly as the article gives them.`;

export async function callModel(page, url, env, fetchFn = fetch) {
  const user = `URL: ${url}\nPage title: ${page.title}\nStandfirst: ${page.description}\nByline: ${page.byline}\n\nARTICLE TEXT:\n${page.text}`;
  const body = JSON.stringify({ model: env.STUDIO_MODEL || env.IMPACT_MODEL || "claude-haiku-5-5", max_tokens: 1800, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "studio_fill" }, messages: [{ role: "user", content: user }] });
  const r = await fetchFn("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body });
  const raw = await r.text(); let d; try { d = JSON.parse(raw); } catch { throw new Error("AI reply was not readable (HTTP " + r.status + ")"); }
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || "AI HTTP " + r.status);
  const block = (d.content || []).find((b) => b.type === "tool_use"); if (!block) throw new Error("AI returned nothing usable");
  return block.input || {};
}

async function signedIn(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!token) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) return false;
  try { const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }); return r.ok; } catch { return false; }
}

async function leadImage(url) {
  if (!url) return "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 GazetteStudio" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return "";
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3.2e6) return "";           // keeps the reply under Netlify's 6MB response limit
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch { return ""; }
}

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!(await signedIn(req))) return reply({ error: "Sign in again, then retry." }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return reply({ error: "ANTHROPIC_API_KEY is not set on the site." }, 500);
  let b; try { b = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }
  const url = safeUrl(b && b.url); if (!url) return reply({ error: "That doesn’t look like a public web address." }, 400);
  let html;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 GazetteStudio", Accept: "text/html" }, signal: AbortSignal.timeout(9000), redirect: "follow" });
    if (!r.ok) return reply({ error: `The page returned ${r.status}. Some sites block automated readers — use manual mode and paste the text.` }, 502);
    html = await r.text();
  } catch (e) { return reply({ error: "Couldn’t open that page (" + (e.name === "TimeoutError" ? "timed out" : "network error") + ")." }, 502); }
  const page = extractPage(html, url);
  if (page.text.length < 400) return reply({ error: "Couldn’t find the article text on that page. Use manual mode and paste it in." }, 422);
  let out;
  try { out = await callModel(page, url, process.env); } catch (e) { return reply({ error: "AI step failed: " + e.message }, 502); }
  const warnings = checkOutput(out, page);
  const image = await leadImage(page.image);
  return reply({ ok: true, url, site: page.site, byline: page.byline, ...out, warnings, image });
};
