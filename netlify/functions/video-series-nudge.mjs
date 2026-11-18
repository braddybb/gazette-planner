// ─────────────────────────────────────────────────
// Weekly nudge: if Nick hasn't logged a NEW series approach this week,
// DM the editorial director on Friday afternoon (Sydney time).
// Pairs with the instant Slack ping the desk sends when Nick logs one.
//
// Netlify cron is UTC; it fires at the hours that could be Fri 15:00 in
// either Sydney daylight-saving offset, and the function checks real
// Sydney time before doing anything.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN, CHEF_SLACK_ID.
// ─────────────────────────────────────────────────
export const config = { schedule: "0 4,5 * * 5" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";

export function sydneyParts(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) % 24, ymd: `${p.year}-${p.month}-${p.day}` };
}
export function mondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d)); const dow = t.getUTCDay();
  t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return t.toISOString().slice(0, 10);
}
// Pure + testable: has a new series been started this week?
export function newSeriesThisWeek(vd, weekMonday) {
  const series = (vd && Array.isArray(vd.series)) ? vd.series : [];
  return series.some((s) => s && s.started && mondayOf(s.started) === weekMonday);
}

async function latestVD() {
  const url = `${SUPABASE_URL}/rest/v1/system_flags?key=like.videodesk*&select=value&order=key.desc&limit=1`;
  const res = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows || !rows[0] || !rows[0].value) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}
async function dm(user, text) {
  if (!user) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ channel: user, text }),
  });
}

export default async () => {
  const s = sydneyParts();
  if (!(s.weekday === "Fri" && s.hour === 15)) return new Response("not the hour", { status: 200 });
  const vd = await latestVD();
  const week = mondayOf(s.ymd);
  if (vd && newSeriesThisWeek(vd, week)) return new Response("series logged, no nudge", { status: 200 });
  await dm(process.env.CHEF_SLACK_ID, "🎬 No new series approach has been logged on the Video Desk this week. If Nick tried something new with a reporter, ask him to log it on the desk.");
  return new Response("nudged", { status: 200 });
};
