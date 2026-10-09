// ─────────────────────────────────────────────────────────────────────────────
// Impact Radar — morning digest. Weekdays 7:30am Sydney: DMs the Impact editor the
// top-scoring items from the last 24 hours, the watchlist-hit count, and any saved
// leads left untouched for 3+ days. Sends nothing if there is nothing worth saying.
// Netlify cron is UTC, so it fires at both 20:30 and 21:30 UTC (Sun–Thu) and the
// function checks it really is 7am-hour Mon–Fri in Sydney (right across DST).
// Env: SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN, IMPACT_EDITOR_SLACK_ID.
// ─────────────────────────────────────────────────────────────────────────────
import { db, sendDM, digestText } from "./impact-lib.mjs";

export const config = { schedule: "30 20,21 * * 0-4" };

export function sydneyNow(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23", weekday: "short", day: "numeric", month: "short" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), weekday: p.weekday, label: `${p.weekday} ${p.day} ${p.month}` };
}
export const shouldRun = (now = new Date()) => { const s = sydneyNow(now); return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(s.weekday) && s.hour === 7; };

export async function build(ctx) {
  const D = db(ctx); const since = new Date(ctx.now - 24 * 3600e3).toISOString(); const old = new Date(ctx.now - 3 * 864e5).toISOString();
  const [top, hits, saved] = await Promise.all([
    D.get(`impact_items?status=eq.new&relevance=gte.70&fetched_at=gte.${since}&order=relevance.desc&limit=8&select=title,url,source_name,why,relevance`),
    D.get(`impact_items?fetched_at=gte.${since}&status=neq.dismissed&select=id,watch_hits&limit=500`),
    D.get(`impact_items?status=eq.saved&saved_at=lt.${old}&select=id&limit=200`).catch(() => []),
  ]);
  return digestText({ items: top, hitCount: hits.filter((r) => (r.watch_hits || []).length).length, savedOld: saved.length, site: ctx.env.URL || "https://gari-planner.netlify.app", today: sydneyNow(new Date(ctx.now)).label });
}

export default async () => {
  if (!shouldRun()) return new Response("not 7am Mon–Fri Sydney — skipped");
  const env = process.env;
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SLACK_BOT_TOKEN || !env.IMPACT_EDITOR_SLACK_ID) { console.warn("impact-digest: missing env vars"); return new Response("not configured"); }
  try {
    const text = await build({ fetch: globalThis.fetch, env, now: Date.now() });
    if (!text) return new Response("nothing worth sending");
    await sendDM({ fetch: globalThis.fetch, env }, text);
    return new Response("sent");
  } catch (e) { console.error("impact-digest failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
