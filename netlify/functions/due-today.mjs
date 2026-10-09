// ─────────────────────────────────────────────────────────────────────────────
// Morning "your planner today" Slack DM to each reporter — plain counting, no AI.
// Weekdays 8:30am Sydney. Sends each reporter a private DM (not #editorial) listing
// what's due today, what's overdue, assigned stories still needing a day, and (Mon
// and Wed) how many of their slots aren't planned yet. Reporters with nothing to
// action get no message. Anyone away that day is skipped.
//
// Cron is UTC, so it fires at 21:30 and 22:30 UTC Sunday–Thursday and checks it is
// really 8am-hour Mon–Fri in Sydney (right across daylight saving).
// Imports helpers from video-digest.mjs — upload both to the same folder.
// Env vars: SLACK_BOT_TOKEN (chat:write), SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL.
// ─────────────────────────────────────────────────────────────────────────────
import { sydneyParts, mondayOf, sget, loadAway, awayIdx } from "./video-digest.mjs";

export const config = { schedule: "30 21,22 * * 0-4" };

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PLANNER_URL = "https://gari-planner.netlify.app/";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Same member IDs the Editor Dashboard and /assign use.
export const REPORTERS = [
  { name: "Douglas Connor",   pub: "Mid North Coaster",          slack: "U0B71KH9Y0K", base: 10 },
  { name: "Huw Bradshaw",     pub: "North Shore Lorikeet",       slack: "U08P2C7862Z", base: 10 },
  { name: "Matthew Sims",     pub: "Eastern Melburnian",         slack: "U07SHH3RB46", base: 10 },
  { name: "Zara Cuthbertson", pub: "West Vic Brolga — Wannon",   slack: "U08LY1YR6E8", base: 10 },
  { name: "Darcie Humphreys", pub: "West Vic Brolga — Ballarat", slack: "U0AFJML3A1G", base: 10 },
  { name: "Jacob Wallace",    pub: "Gippsland Monitor",          slack: "U08DG9R5A6R", base: 10 },
  { name: "Archie Milligan",  pub: "National Account",           slack: "U08DQ26CEE7", base: 8 },
];

export function shouldRun(now = new Date()) {
  const s = sydneyParts(now);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(s.weekday) && s.hour === 8;
}
const has = (v) => !!(v && String(v).trim());
const q = (s) => "“" + s + "”";

// rows: this week's planner rows for ONE reporter. todayIdx: 0=Mon … 4=Fri.
export function buildDueToday(rep, rows, todayIdx, awayI) {
  const live = (rows || []).filter((r) => r.status !== "abandoned" && !r.filed && has(r.headline));
  const dayIdx = (r) => (has(r.file_day) ? DAYS.indexOf(r.file_day) : -1);
  const due = live.filter((r) => dayIdx(r) === todayIdx);
  const overdue = live.filter((r) => dayIdx(r) > -1 && dayIdx(r) < todayIdx && !awayI.includes(dayIdx(r)));
  const needsDay = live.filter((r) => r.assigned_by && dayIdx(r) === -1);
  const L = [];
  if (due.length) { L.push("*Due today*"); due.forEach((r) => L.push("• " + q(r.headline) + (r.assigned_by ? " _(assigned)_" : ""))); L.push(""); }
  if (overdue.length) { L.push("*Overdue*"); overdue.forEach((r) => L.push("• " + q(r.headline) + " — was due " + r.file_day)); L.push(""); }
  if (needsDay.length) {
    L.push("*Assigned — needs a day*");
    needsDay.forEach((r) => L.push("• " + q(r.headline) + (r.carried_from ? " _(carried over from last week)_" : "")));
    L.push("");
  }
  if (todayIdx === 0 || todayIdx === 2) {
    const planned = (rows || []).filter((r) => parseInt(r.story_num, 10) <= rep.base && has(r.headline)).length;
    if (planned < rep.base) L.push(`${rep.base - planned} of your ${rep.base} slots aren't planned yet.`);
  }
  const body = L.join("\n").trim();
  if (!body) return null;
  return `:sunrise: *Morning ${rep.name.split(" ")[0]}* — your planner today\n\n${body}\n\n<${PLANNER_URL}|Open your planner>`;
}

export default async () => {
  if (!shouldRun()) return new Response("not a weekday 8am-hour Sydney — skipped");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN) { console.warn("due-today: missing env vars"); return new Response("not configured"); }
  const sp = sydneyParts(); const week = mondayOf(sp.ymd);
  const todayIdx = DAYS.indexOf(sp.weekday);
  const sent = [], skipped = [];
  try {
    const rows = await sget(`planner_stories?week_of=eq.${week}&select=reporter,publication,story_num,headline,file_day,filed,status,assigned_by,carried_from`);
    const away = await loadAway().catch(() => []);
    for (const rep of REPORTERS) {
      const idx = awayIdx(away, rep.name, rep.pub, week);
      if (idx.includes(todayIdx)) { skipped.push(rep.name + " (away)"); continue; }
      const mine = (rows || []).filter((r) => r.reporter === rep.name && r.publication === rep.pub);
      const text = buildDueToday(rep, mine, todayIdx, idx);
      if (!text) { skipped.push(rep.name); continue; }
      const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: rep.slack, text }) });
      const j = await r.json();
      if (j.ok) sent.push(rep.name); else console.error("due-today DM failed for", rep.name, j.error);
    }
    console.log("due-today sent:", sent.join(", "), "| skipped:", skipped.join(", "));
    return new Response(JSON.stringify({ sent, skipped }));
  } catch (e) { console.error("due-today failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
