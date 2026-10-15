// Patch Radar morning digest: weekdays 7:15am Sydney, DMs the Impact editor the top 3 items per patch. Sends nothing if empty.
// Env: SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN, IMPACT_EDITOR_SLACK_ID.
import { db, sendDM } from "./impact-lib.mjs";
import { PATCHES, digestText } from "./patch-lib.mjs";
export const config = { schedule: "15 20,21 * * 0-4" };
export function sydneyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23", weekday: "short", day: "numeric", month: "short" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), weekday: p.weekday, label: `${p.weekday} ${p.day} ${p.month}` };
}
export const shouldRun = (now = new Date()) => { const s = sydneyNow(now); return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(s.weekday) && s.hour === 7; };
export async function build(ctx) {
  const D = db(ctx); const since = new Date(ctx.now - 24 * 3600e3).toISOString();
  const rows = await D.get(`patch_items?relevance=gte.70&fetched_at=gte.${since}&order=relevance.desc&limit=200&select=title,url,source_name,why,relevance,patches`);
  const byPatch = {}; for (const p of PATCHES) byPatch[p] = rows.filter((r) => (r.patches || []).includes(p));
  return digestText({ byPatch, site: (ctx.env.URL || "https://gari-planner.netlify.app"), today: sydneyNow(new Date(ctx.now)).label });
}
export default async () => {
  if (!shouldRun()) return new Response("not 7:15am Mon–Fri Sydney — skipped");
  const env = process.env;
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SLACK_BOT_TOKEN || !env.IMPACT_EDITOR_SLACK_ID) return new Response("not configured");
  try { const text = await build({ fetch: globalThis.fetch, env, now: Date.now() }); if (!text) return new Response("nothing worth sending"); await sendDM({ fetch: globalThis.fetch, env }, text); return new Response("sent"); }
  catch (e) { console.error("patch-digest failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
