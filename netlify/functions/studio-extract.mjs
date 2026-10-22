// ─────────────────────────────────────────────────────────────────────────────
// Studio auto-fill: reads one published story URL and returns the pieces the Studio
// templates need (headline, emphasis phrase, deck, pull quote, three short carousel
// beats, caption, byline, lead photo).
//
// GARI principle applied: it chooses, it does not write. Headline, standfirst, byline,
// every carousel sentence and the pull quote are the reporter's own words, copied
// exactly from the page. The model only decides WHICH sentences go under each beat
// (by number) and which phrase of the headline to highlight; the server then pastes in
// the original text. Nothing is shortened or rephrased. The pull quote and speaker are
// checked against the article and dropped if they are not found there.
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
  const h1raw = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const h1 = h1raw ? decode(h1raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
  const headline = h1 || tidyTitle(decode(title), decode(site));
  let body = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const art = body.match(/<article\b[\s\S]*?<\/article>/i); if (art) body = art[0];
  body = body.replace(/<\/(p|h[1-6]|li|blockquote|div|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  const text = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1 && l !== headline && l !== decode(description)).join("\n").slice(0, 30000);
  return { title: decode(title), headline, description: decode(description), image, byline: decode(byline), site: decode(site), text };
}
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
// ── sentences ────────────────────────────────────────────────────────────────
// Split the article into numbered sentences (never splitting inside a “quote”), keeping paragraph breaks.
export function splitSentences(text) {
  const sents = []; let para = 0;
  text.split("\n").forEach((line) => {
    line = line.trim(); if (!line) return; para++;
    let cur = "", open = 0;
    const flush = () => { const t = cur.trim(); if (t) sents.push({ id: sents.length + 1, text: t, para }); cur = ""; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]; cur += ch;
      if (ch === "\u201C") open++; else if (ch === "\u201D") open = Math.max(0, open - 1);
      if (/[.!?]/.test(ch) && !open) {
        let k = i + 1; while (k < line.length && /["'\u201D\u2019)\]]/.test(line[k])) { cur += line[k]; if (line[k] === "\u201D") open = 0; k++; }
        if ((k >= line.length || /\s/.test(line[k])) && !/\b(Mr|Mrs|Ms|Dr|St|Cr|Hon|Prof|Sen|Gen|No|vs)\.$/.test(cur.trim()) && !/\b[A-Z]\.$/.test(cur.trim())) { flush(); i = k - 1; }
        else i = k - 1;
      }
    }
    flush();
  });
  return sents;
}
const joinIds = (ids, sents) => {
  const byId = new Map(sents.map((x) => [x.id, x])); let out = "", lastPara = null;
  [...new Set(ids)].filter((n) => byId.has(n)).sort((a, b) => a - b).forEach((n) => { const x = byId.get(n); out += (lastPara === null ? "" : x.para === lastPara ? " " : "\n\n") + x.text; lastPara = x.para; });
  return out;
};
function tidyTitle(t, site) { t = String(t || "").trim(); if (site) t = t.replace(new RegExp("\\s*[|\\u2013\\u2014-]\\s*" + site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), ""); return t.replace(/\s*\|\s*[^|]{3,40}$/, "").trim(); }

// ── model call: it picks sentence numbers, it never writes ───────────────────
const TOOL = {
  name: "studio_pick",
  description: "Choose which of the reporter's own sentences go on each graphic. Return numbers only.",
  input_schema: {
    type: "object",
    properties: {
      emphasis: { type: "string", description: "A phrase of 1-4 words copied exactly from the headline that deserves a highlight. Empty string if none." },
      happened: { type: "array", items: { type: "integer" }, description: "Sentence numbers for the first beat: what happened. Usually consecutive, from the top of the story. Include as many as needed to tell it faithfully." },
      matters: { type: "array", items: { type: "integer" }, description: "Sentence numbers for the second beat: why it matters / the background or stakes." },
      next: { type: "array", items: { type: "integer" }, description: "Sentence numbers for the third beat: what happens next / what to do. Often near the end." },
      quote: { type: "string", description: "One quote that appears word-for-word in the article, without the quotation marks. Empty string if none is strong." },
      quoteSpeaker: { type: "string", description: "Who said it, exactly as the article names them (e.g. 'Nicole Thomson'), plus their role if the article gives it. Empty if no quote." },
      stat: { type: "string", description: "One figure exactly as the article writes it (e.g. '39' or '$2.4 million'). Empty if none stands out." },
      statSentence: { type: "integer", description: "Number of the sentence that contains that figure. 0 if no stat." },
      captionSentences: { type: "array", items: { type: "integer" }, description: "One or two sentence numbers that make a good Instagram caption on their own." }
    },
    required: ["emphasis", "happened", "matters", "next"]
  }
};
const SYSTEM = `You are an editor's assistant at Gazette Network, a regional Australian newsroom. You never write or rewrite. You only CHOOSE which of the reporter's own sentences go on each slide, by number. The text on the slides will be the reporter's exact words.
- Do not summarise, shorten, paraphrase or invent. Return sentence numbers only (plus a verbatim quote and a figure copied exactly).
- Keep each beat faithful to the story: don't separate a claim from its source or a quote from its speaker; include the sentence that names who said it.
- Beats may be as long as the story needs. Prefer consecutive sentences so each beat reads naturally. Don't repeat a sentence across beats.
- 'quote' must be a quote that appears word-for-word in the article. If there is no strong direct quote, return an empty string.`;

export async function callModel(page, url, sents, env, fetchFn = fetch) {
  const numbered = sents.map((x) => `[${x.id}] ${x.text}`).join("\n");
  const user = `URL: ${url}\nHeadline: ${page.headline}\nStandfirst: ${page.description}\n\nARTICLE, numbered by sentence:\n${numbered}`;
  const body = JSON.stringify({ model: env.STUDIO_MODEL || env.IMPACT_MODEL || "claude-haiku-5-5", max_tokens: 1200, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "studio_pick" }, messages: [{ role: "user", content: user }] });
  const r = await fetchFn("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body });
  const raw = await r.text(); let d; try { d = JSON.parse(raw); } catch { throw new Error("AI reply was not readable (HTTP " + r.status + ")"); }
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || "AI HTTP " + r.status);
  const block = (d.content || []).find((b) => b.type === "tool_use"); if (!block) throw new Error("AI returned nothing usable");
  return block.input || {};
}

// Turn the model's picks into slide text. Everything comes from the page, nothing from the model's own words.
export function assemble(pick, page, sents) {
  const warnings = []; const hay = norm(page.text);
  const ids = (a) => (Array.isArray(a) ? a.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= sents.length) : []);
  let h = ids(pick.happened), m = ids(pick.matters), n = ids(pick.next);
  const used = new Set(); const dedupe = (arr) => arr.filter((x) => (used.has(x) ? false : (used.add(x), true)));
  h = dedupe(h); m = dedupe(m); n = dedupe(n);
  if (!h.length && sents.length) { h = sents.slice(0, Math.min(3, sents.length)).map((x) => x.id); h.forEach((x) => used.add(x)); warnings.push("Couldn\u2019t tell which sentences tell what happened, so the first three are used. Check slide 2."); }
  const slides = [{ label: "What happened?", body: joinIds(h, sents) }, { label: "Why does it matter?", body: joinIds(m, sents) }, { label: "Now what?", body: joinIds(n, sents) }].filter((s) => s.body);
  let quote = String(pick.quote || "").replace(/^["\u201C\u2018']|["\u201D\u2019']$/g, "").trim(), speaker = String(pick.quoteSpeaker || "").trim();
  if (quote && !hay.includes(norm(quote))) { warnings.push("The quote the AI picked isn\u2019t word-for-word in the story, so it was left out."); quote = ""; }
  if (quote && speaker && !hay.includes(norm(speaker.split(",")[0]))) { warnings.push("Couldn\u2019t find the speaker\u2019s name in the story, so the quote has no attribution. Add it."); speaker = ""; }
  if (!quote) speaker = "";
  let stat = String(pick.stat || "").trim(), statCaption = "";
  if (stat && !hay.includes(norm(stat))) stat = "";
  if (stat) { const sx = sents.find((x) => norm(x.text).includes(norm(stat))) || sents.find((x) => x.id === parseInt(pick.statSentence, 10)); statCaption = sx ? sx.text : ""; }
  const capIds = ids(pick.captionSentences).slice(0, 2);
  const caption = (capIds.length ? joinIds(capIds, sents) : page.description || "").trim();
  const emphasis = pick.emphasis && norm(page.headline).includes(norm(pick.emphasis)) ? pick.emphasis : "";
  return { headline: page.headline, emphasis, deck: page.description || "", pullQuote: quote, quoteSpeaker: speaker, stat, statCaption, slides, caption, warnings };
}

async function signedIn(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!token) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) return false;
  try { const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }); return r.ok; } catch { return false; }
}

async function leadImage(url) {
  if (!url || !safeUrl(url)) return "";
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
    if (r.url && !safeUrl(r.url)) return reply({ error: "That link redirected somewhere that isn\u2019t allowed." }, 400);
    html = await r.text();
  } catch (e) { return reply({ error: "Couldn’t open that page (" + (e.name === "TimeoutError" ? "timed out" : "network error") + ")." }, 502); }
  const page = extractPage(html, url);
  if (page.text.length < 400) return reply({ error: "Couldn’t find the article text on that page. Use manual mode and paste it in." }, 422);
  const sents = splitSentences(page.text);
  if (sents.length < 4) return reply({ error: "That page has too little article text to work from." }, 422);
  let pick, image;
  try { [pick, image] = await Promise.all([callModel(page, url, sents, process.env), leadImage(page.image)]); } catch (e) { return reply({ error: "AI step failed: " + e.message }, 502); }
  const out = assemble(pick, page, sents);
  return reply({ ok: true, url, site: page.site, byline: page.byline, ...out, image });
};
