// ─────────────────────────────────────────────────────────────────────────────
// Patch Radar — shared logic. Reuses the Impact Radar's parsing, HTTP, DB and
// scoring helpers (impact-lib.mjs); everything patch-specific lives here.
//
//  • "local" sources (a council, a local paper, a hospital) belong to one patch:
//    every fresh item goes to that patch.
//  • "shared" sources (state police, ABC, state agencies) serve several patches:
//    an item only lands in a patch if it names a place or a politician from it.
//    National Account also takes federal-politics items from sources flagged federal.
//  • "auto" sources: we look at the page, find its RSS feed if it has one (and
//    remember it), otherwise read the page's headline links.
// ─────────────────────────────────────────────────────────────────────────────
import { parseFeed, fetchText, adapterHtml, db, titleKey, normUrl, sha, matchWatch, MAX_AGE_HOURS, BATCH, stripHtml, clip } from "./impact-lib.mjs";

export const PATCHES = ["Eastern Melburnian", "North Shore Lorikeet", "West Vic Brolga — Wannon", "West Vic Brolga — Ballarat", "Gippsland Monitor", "Mid North Coaster", "National Account"];
export const SCORE_PER_RUN = 400;
export const ALERT_MIN = 85;     // default relevance needed for a Slack DM; each reporter can change theirs in their planner (system_flags patchpref:*)
export const ALERT_FLOOR = 60;   // lowest threshold a reporter can pick
export const ALERT_MAX = 6;      // max items per DM
// Reporter -> Slack member ID (same IDs the other Gazette functions use)
export const REPORTERS = [
  { name: "Matthew Sims", pub: "Eastern Melburnian", slack: "U07SHH3RB46" },
  { name: "Huw Bradshaw", pub: "North Shore Lorikeet", slack: "U08P2C7862Z" },
  { name: "Zara Cuthbertson", pub: "West Vic Brolga \u2014 Wannon", slack: "U08LY1YR6E8" },
  { name: "Darcie Humphreys", pub: "West Vic Brolga \u2014 Ballarat", slack: "U0AFJML3A1G" },
  { name: "Jacob Wallace", pub: "Gippsland Monitor", slack: "U08DG9R5A6R" },
  { name: "Douglas Connor", pub: "Mid North Coaster", slack: "U0B71KH9Y0K" },
  { name: "Archie Milligan", pub: "National Account", slack: "U08DQ26CEE7" },
];
export function alertDm(pub, items, site) {
  const L = [`:round_pushpin: *Patch Radar \u2014 ${pub}*`];
  items.slice(0, ALERT_MAX).forEach((it) => L.push(`\u2022 *${it.relevance}* <${it.url}|${clip(it.title, 110)}> _(${it.source_name})_${it.why ? "\n   " + clip(it.why, 160) : ""}`));
  if (items.length > ALERT_MAX) L.push(`_+${items.length - ALERT_MAX} more in your planner_`);
  L.push(`<${site}|Open Patch in your planner>`); return L.join("\n");
}
// Reporter alert preferences: latest "patchpref:<slug>:<ts>" row per reporter -> { name: minScore | null(off) }
export async function loadPrefs(D) {
  const out = {};
  try {
    const rows = await D.get("system_flags?key=like.patchpref*&order=key.desc&select=key,value&limit=500");
    for (const r of rows) { let v; try { v = JSON.parse(r.value); } catch { continue; } if (!v || !v.reporter || v.reporter in out) continue; out[v.reporter] = v.alertMin == null ? null : Math.max(ALERT_FLOOR, Math.min(100, Number(v.alertMin) || ALERT_MIN)); }
  } catch { /* no access: use defaults */ }
  return out;
}
async function dmSlack(ctx, channel, text) {
  const tok = ctx.env.SLACK_BOT_TOKEN; if (!tok) return false;
  const r = await ctx.fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text, unfurl_links: false }) });
  const j = await r.json(); if (!j.ok) throw new Error("Slack: " + j.error); return true;
}
export const POLITICS_RE = /\b(parliament(?:ary)?|senate|senator|house of representatives|federal (?:government|election|budget|court|police)|prime minister|albanese|opposition leader|angus taylor|treasurer|chalmers|minister for|cabinet|budget|labor|coalition|liberals?|nationals|greens|one nation|crossbench|teals?|independent mp|election|by-?election|poll(?:s|ing)?|policy|legislation|bill|inquiry|royal commission|estimates|hansard|high court|integrity commission|icac|ibac|nacc|ombudsman|auditor-general|aec|rba|interest rates?|inflation|cost of living|housing|medicare|nbn|ndis|immigration|defence|aukus)\b/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (t) => new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`, "i");

// ── auto adapter ─────────────────────────────────────────────────────────────
const looksFeed = (t) => /<(rss|feed|rdf:RDF)\b/i.test(t.slice(0, 1500));
export function findFeedLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]; if (!/rel=["']alternate["']/i.test(tag) || !/type=["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const h = tag.match(/href=["']([^"']+)["']/i); if (!h) continue;
    try { out.push(new URL(h[1].replace(/&amp;/g, "&"), base).toString()); } catch {}
  }
  return out;
}
export async function adapterAuto(src, ctx) {
  const cfg = src.config || {};
  if (cfg.feed_url) {
    try { const items = parseFeed(await fetchText(ctx.fetch, cfg.feed_url)); if (items.length) return { items: items.slice(0, 60), feed: cfg.feed_url }; } catch { /* fall through to rediscover */ }
  }
  const text = await fetchText(ctx.fetch, src.url);
  if (looksFeed(text)) { const items = parseFeed(text); return { items: items.slice(0, 60), feed: src.url }; }
  const base = new URL(src.url);
  const cands = [...findFeedLinks(text, src.url), new URL("/feed/", base).toString(), new URL("/rss", base).toString(), new URL("/feed", base).toString()];
  for (const u of [...new Set(cands)].slice(0, 4)) {
    try { const t = await fetchText(ctx.fetch, u, { timeout: 8000 }); if (looksFeed(t)) { const items = parseFeed(t); if (items.length) return { items: items.slice(0, 60), feed: u }; } } catch { /* try next */ }
  }
  // no feed: read headline links from the page itself (same parsing the Radar uses)
  const html = await adapterHtml({ url: src.url, config: cfg.include ? { include: cfg.include } : {} }, { fetch: async () => ({ ok: true, text: async () => text }) });
  return { items: html, feed: null };
}

// ── geography gate ───────────────────────────────────────────────────────────
export function buildMatchers(areas, people) {
  const m = {};
  for (const p of PATCHES) m[p] = { terms: [], people: [] };
  for (const a of areas) if (m[a.patch]) m[a.patch].terms = (a.terms || []).map((t) => ({ t, re: wordRe(t) }));
  for (const x of people) if (m[x.patch] && x.active !== false && x.name) m[x.patch].people.push({ t: x.name, re: wordRe(x.name) });
  return m;
}
// returns { patches:[...], mentions:[names] } for one fetched item
export function assignPatches(src, item, matchers) {
  const hay = `${item.title} ${item.summary || ""}`;
  const serves = (src.patches && src.patches.length) ? src.patches : PATCHES;
  if (src.scope === "local") {
    const mentions = []; for (const p of serves) for (const x of (matchers[p] ? matchers[p].people : [])) if (x.re.test(hay)) mentions.push(x.t);
    return { patches: serves.slice(0, 1), mentions: [...new Set(mentions)] };
  }
  const patches = []; const mentions = [];
  for (const p of serves) {
    const mm = matchers[p]; if (!mm) continue;
    let hit = mm.terms.some((x) => x.re.test(hay));
    const who = mm.people.filter((x) => x.re.test(hay));
    if (who.length) { hit = true; who.forEach((x) => mentions.push(x.t)); }
    if (p === "National Account" && !hit && src.config && src.config.federal && POLITICS_RE.test(hay)) hit = true;
    if (hit) patches.push(p);
  }
  return { patches, mentions: [...new Set(mentions)] };
}

// ── AI triage for patch reporters ────────────────────────────────────────────
export const KINDS = ["council", "planning / development", "court / crime", "police / emergency", "health", "state politics", "federal politics", "local news", "environment / infrastructure", "business / jobs", "other"];
export function scoreSystem(briefs) {
  return `You are the local-news triage desk for Gazette, a network of Australian mastheads, each covering a "patch". Reporters read your output at the start of the week to decide what to chase.

Patches:
${PATCHES.map((p) => `- ${p}: ${briefs[p] || ""}`).join("\n")}

For every numbered item give:
- relevance 0-100 FOR THE LISTED PATCHES. Be strict; scores should be spread out, and most items score below 60:
  90-100: rare (a few a week across the whole network). A major decision, charge, court result, closure or announcement that clearly changes things for many people in the patch and is story-ready now.
  75-89: a concrete decision or document with real local consequences that a reporter should chase this week.
  55-74: worth knowing; an incremental development, a proposal not yet decided, or a notable item with limited local impact.
  35-54: background, council PR, a routine notice, or relevant only by a stretch.
  0-34: not local, trivia, sport results, events listings, nothing new.
  If only a headline was given, cap the score at 70.
- kind (from the allowed list).
- patches: which of the item’s listed patches it genuinely touches (subset). Use [] if none.
- why: one plain sentence (max 22 words) naming the concrete thing that is new. No hype. If only a headline was given, say so.
- angle: only if relevance >= 55; max 28 words; a reportable angle with a local or accountability hook (who is affected, who decides, what the council/agency has not said). Otherwise empty.

Rules: use only the text given; never invent facts or names. Council agendas and development applications that affect residents score higher than council PR. Politicians’ media releases score 70+ only if they announce money, a decision, or a commitment for the patch.`;
}
export const SCORE_TOOL = {
  name: "score_items", description: "Return a triage result for every numbered item.",
  input_schema: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: {
    i: { type: "integer" }, relevance: { type: "integer", minimum: 0, maximum: 100 }, kind: { type: "string", enum: KINDS },
    patches: { type: "array", items: { type: "string", enum: PATCHES } }, why: { type: "string" }, angle: { type: "string" } },
    required: ["i", "relevance", "kind", "patches", "why"] } } }, required: ["results"] },
};
export function scoreUser(items) {
  return "Triage these items.\n\n" + items.map((it, n) => `[${n}] ${it.source_name} (${it.category || "news"}) · patches: ${(it.patches || []).join(" | ")} · ${it.published_at ? String(it.published_at).slice(0, 10) : "undated"}\n${it.title}\n${(it.summary || "(headline only)").slice(0, 500)}`).join("\n\n");
}
export function clampScore(r, item) {
  const mine = (item && item.patches) || [];
  const keep = Array.isArray(r.patches) ? r.patches.filter((p) => mine.includes(p)) : [];
  return { relevance: Math.max(0, Math.min(100, Math.round(Number(r.relevance) || 0))), kind: KINDS.includes(r.kind) ? r.kind : "other",
    patches: keep, why: String(r.why || "").slice(0, 240), angle: String(r.angle || "").slice(0, 300) };
}
export async function scoreBatch(items, ctx, briefs) {
  const body = JSON.stringify({ model: ctx.model, max_tokens: 3500, system: scoreSystem(briefs), tools: [SCORE_TOOL], tool_choice: { type: "tool", name: "score_items" }, messages: [{ role: "user", content: scoreUser(items) }] });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await ctx.fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": ctx.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body });
      const raw = await r.text(); let d; try { d = JSON.parse(raw); } catch { throw new Error(`API not JSON (HTTP ${r.status})`); }
      if (!r.ok || d.error) throw new Error((d.error && d.error.message) || `HTTP ${r.status}`);
      const block = (d.content || []).find((b) => b.type === "tool_use"); if (!block) throw new Error("no tool_use block");
      const byI = {}; ((block.input && block.input.results) || []).forEach((x) => { byI[x.i] = clampScore(x, items[x.i]); });
      return items.map((_, n) => byI[n] || null);
    } catch (e) { lastErr = e; if (attempt === 0) await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(1500); }
  }
  throw lastErr;
}

// ── one full run ─────────────────────────────────────────────────────────────
export async function run(ctx) {
  const D = db(ctx); const started = new Date(ctx.now); const scope = ctx.scope || "all";
  const stats = { fetched: 0, inserted: 0, scored: 0, errors: [] };
  try {
    const last = await D.get(`patch_runs?select=started_at&scope=eq.${encodeURIComponent(scope)}&order=started_at.desc&limit=1`);
    if (last[0] && ctx.now - Date.parse(last[0].started_at) < (ctx.minGapMs ?? 8 * 60e3)) return { skipped: "ran recently" };
  } catch (e) { stats.errors.push("throttle check: " + e.message); }
  const runRow = (await D.insert("patch_runs", { started_at: started.toISOString(), scope }))[0];
  const [allSources, areas, people] = await Promise.all([D.get("patch_sources?active=eq.true&select=*"), D.get("patch_areas?select=*"), D.get("patch_people?active=eq.true&select=*")]);
  const sources = scope === "all" ? allSources : allSources.filter((s) => (s.patches || []).includes(scope));
  const matchers = buildMatchers(areas, people); const briefs = Object.fromEntries(areas.map((a) => [a.patch, a.brief]));
  const seenTitle = new Set((await D.get(`patch_items?select=title_key&fetched_at=gte.${new Date(ctx.now - 4 * 864e5).toISOString()}&limit=10000`)).map((r) => r.title_key));
  const fresh = [];

  const queue = sources.slice();
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const src = queue.shift(); const patch = { last_run: new Date(ctx.now).toISOString() };
      try {
        let got;
        if (src.kind === "rss") got = { items: parseFeed(await fetchText(ctx.fetch, src.url)).slice(0, 60), feed: src.url };
        else if (src.kind === "html") got = { items: await adapterHtml(src, ctx), feed: null };
        else got = await adapterAuto(src, ctx);
        let kept = 0;
        for (const g of got.items) {
          stats.fetched++;
          if (g.published && ctx.now - g.published.getTime() > MAX_AGE_HOURS * 3600e3) continue;
          const tk = titleKey(g.title, g.sourceName);
          if (seenTitle.has(tk)) continue;
          const asg = assignPatches(src, g, matchers);
          if (!asg.patches.length) continue;
          seenTitle.add(tk);
          fresh.push({ source_id: src.id, source_name: src.name, category: src.category, url: g.url, url_key: sha(normUrl(g.url)), title_key: tk, title: g.title.slice(0, 400), summary: g.summary || null,
            published_at: g.published ? g.published.toISOString() : null, fetched_at: new Date(ctx.now).toISOString(), patches: asg.patches, mentions: asg.mentions });
          kept++;
        }
        patch.last_ok = new Date(ctx.now).toISOString(); patch.last_count = kept; patch.last_error = null; patch.verified = true;
        const newCfg = { ...(src.config || {}) };
        if (got.feed && newCfg.feed_url !== got.feed) { newCfg.feed_url = got.feed; patch.config = newCfg; }
        if (!got.feed && newCfg.feed_url) { delete newCfg.feed_url; patch.config = newCfg; }
      } catch (e) { patch.last_error = String(e.message || e).slice(0, 200); stats.errors.push(`${src.name}: ${patch.last_error}`); }
      try { await D.patch(`patch_sources?id=eq.${src.id}`, patch); } catch (e) { stats.errors.push("health: " + e.message); }
    }
  }));

  for (let i = 0; i < fresh.length; i += 50) {
    try { const ins = await D.insertIgnore("patch_items", fresh.slice(i, i + 50), "url_key"); stats.inserted += ins.length; } catch (e) { stats.errors.push("insert: " + e.message); }
  }

  if (!ctx.env.ANTHROPIC_API_KEY) stats.errors.push("ANTHROPIC_API_KEY missing — items are saved but not scored");
  else {
    let todo = [];
    // Score fairly: each patch gets its share of the cap (a scoped scan puts its own patch first), so no patch is starved by a big backlog elsewhere.
    try {
      const sel = "select=id,title,summary,source_name,category,published_at,score_tries,patches"; const seen = new Set();
      const order = scope === "all" ? PATCHES : [scope, ...PATCHES.filter((p) => p !== scope)];
      const per = scope === "all" ? Math.ceil(SCORE_PER_RUN / PATCHES.length) : SCORE_PER_RUN;
      for (const p of order) {
        if (todo.length >= SCORE_PER_RUN) break;
        const rows = await D.get(`patch_items?scored_at=is.null&score_tries=lt.3&patches=cs.${encodeURIComponent('{' + JSON.stringify(p) + '}')}&order=fetched_at.desc&limit=${per}&${sel}`);
        for (const r of rows) if (!seen.has(r.id) && todo.length < SCORE_PER_RUN) { seen.add(r.id); todo.push(r); }
      }
    } catch (e) { stats.errors.push("load unscored: " + e.message); }
    const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (batches.length) {
        const b = batches.shift();
        try {
          const res = await scoreBatch(b, ctx, briefs);
          for (let n = 0; n < b.length; n++) {
            if (!res[n]) { await D.patch(`patch_items?id=eq.${b[n].id}`, { score_tries: (b[n].score_tries || 0) + 1 }); continue; }
            const r = res[n]; await D.patch(`patch_items?id=eq.${b[n].id}`, { relevance: r.relevance, kind: r.kind, why: r.why, angle: r.angle, patches: r.patches, scored_at: new Date(ctx.now).toISOString() }); stats.scored++;
          }
        } catch (e) { stats.errors.push("AI: " + e.message); for (const it of b) { try { await D.patch(`patch_items?id=eq.${it.id}`, { score_tries: (it.score_tries || 0) + 1 }); } catch {} } }
      }
    }));
  }
  // DM each reporter their own patch's best new items (scored high, not alerted before, last 24h) — only on the 7:15am scheduled run
  if (ctx.notify) try {
    const prefs = await loadPrefs(D);
    const cand = await D.get(`patch_items?alerted=eq.false&relevance=gte.${ALERT_FLOOR}&fetched_at=gte.${new Date(ctx.now - 864e5).toISOString()}&order=relevance.desc&limit=200&select=id,title,url,source_name,why,relevance,patches`);
    const site = ctx.env.URL || "https://gari-planner.netlify.app";
    for (const rep of REPORTERS) {
      if (scope !== "all" && rep.pub !== scope) continue;
      const pref = prefs[rep.name]; if (pref === null) continue; // alerts switched off by the reporter
      const min = pref == null ? ALERT_MIN : pref;
      const mine = cand.filter((c) => (c.patches || []).includes(rep.pub) && c.relevance >= min); if (!mine.length) continue;
      const shown = mine.slice(0, ALERT_MAX);
      try {
        const msg = alertDm(rep.pub, mine, site);
        if (await dmSlack(ctx, rep.slack, msg)) {
          for (const it of shown) await D.patch(`patch_items?id=eq.${it.id}`, { alerted: true });
          // mirror to the editors' channel so Brad can see exactly what each reporter was sent (never blocks the DM)
          try { await dmSlack(ctx, ctx.env.GARI_SLACK_CHANNEL || "#gari", `:eyes: _Sent to ${rep.name}_\n${msg}`); } catch (e) { stats.errors.push(`#gari mirror: ${e.message}`); }
        }
        stats.alerts = (stats.alerts || 0) + 1;
      }
      catch (e) { stats.errors.push(`DM ${rep.name}: ${e.message}`); }
    }
  } catch (e) { stats.errors.push("alerts: " + e.message); }
  try { await D.patch(`patch_runs?id=eq.${runRow.id}`, { finished_at: new Date().toISOString(), fetched: stats.fetched, inserted: stats.inserted, scored: stats.scored, errors: stats.errors.length ? stats.errors.join(" | ").slice(0, 1500) : null }); } catch {}
  return stats;
}
