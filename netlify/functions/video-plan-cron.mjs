// ─────────────────────────────────────────────────────────────────────────────
// Week plan follow-ups (Sydney time, plain counting, no AI):
//   Mon 10:00  Plan not locked yet → DM Nick, and tell the editorial director.
//   Fri 15:00  Plan vs actual → DM the editorial director (and Nick): what
//              landed, what slipped, and the reason Nick gave.
// Sends nothing when there is nothing to say (e.g. Monday and already locked).
//
// Netlify cron is UTC, so it fires at every hour that could be 10am/3pm in
// either daylight-saving offset, and the function checks the real Sydney time.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN,
// NICK_SLACK_ID, CHEF_SLACK_ID. Optional: URL.
// ─────────────────────────────────────────────────────────────────────────────
export const config = { schedule: "0 23,0,4,5 * * *" };
const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SITE = process.env.URL || "https://gari-planner.netlify.app";

export function sydneyParts(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) % 24, ymd: `${p.year}-${p.month}-${p.day}` };
}
export function mondayOf(ymd) { const [y, m, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return t.toISOString().slice(0, 10); }
export function whichJob(now = new Date()) { const s = sydneyParts(now); if (s.weekday === "Mon" && s.hour === 10) return "mon"; if (s.weekday === "Fri" && s.hour === 15) return "fri"; return null; }

// Pure: how did the committed items go?
export function scorePlan(plan, ctx) {
  const L = plan && plan.locked; if (!L) return null;
  const st = plan.state || {};
  const rows = L.items.map((i) => {
    let done;
    if (i.id.startsWith("impact:")) done = ctx.impactFiled.has(i.id.slice(7));
    else if (i.id === "series") done = ctx.seriesStarted || !!(st[i.id] && st[i.id].done);
    else if (i.id.startsWith("task:")) done = ctx.tasksDone.has(i.id.slice(5));
    else done = !!(st[i.id] && st[i.id].done);
    const skip = !!(st[i.id] && st[i.id].skip) || i.status === "skip";
    return { ...i, done, skip, away: i.status === "away", why: (st[i.id] && st[i.id].why) || i.why || "" };
  });
  const live = rows.filter((r) => !r.away);
  return { landed: live.filter((r) => r.done), missed: live.filter((r) => !r.done && !r.skip), calledOff: live.filter((r) => !r.done && r.skip), away: rows.filter((r) => r.away) };
}
const nm = (i) => (i.id.startsWith("impact:") ? "Impact video — " : "") + i.label;
export function fridayText(week, sc) {
  const L = [`:chart_with_upwards_trend: *Video Desk — week of ${week}: ${sc.landed.length} of ${sc.landed.length + sc.missed.length} landed*`];
  if (sc.landed.length) L.push("*Landed:* " + sc.landed.map(nm).join(", "));
  if (sc.missed.length) { L.push("*Missed:*"); sc.missed.forEach((m) => L.push(`• ${nm(m)}${m.day ? ` (planned ${m.day})` : " (never given a day)"}${m.why ? ` — _${m.why}_` : " — no reason logged"}`)); }
  if (sc.calledOff.length) { L.push("*Called off:*"); sc.calledOff.forEach((m) => L.push(`• ${nm(m)} — ${m.why ? `_${m.why}_` : "no reason given"}`)); }
  if (sc.away.length) L.push("*Away:* " + sc.away.map(nm).join(", "));
  L.push(`<${SITE}/videodesk|Open the Video Desk>`); return L.join("\n");
}

async function sget(path) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }
async function dm(channel, text) { if (!channel || !process.env.SLACK_BOT_TOKEN) return; const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text, unfurl_links: false }) }); const j = await r.json(); if (!j.ok) console.warn("video-plan-cron DM:", j.error); }

export default async () => {
  const job = whichJob(); if (!job || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("skip");
  const week = mondayOf(sydneyParts().ymd);
  const snap = await sget("system_flags?select=value&key=like.videodesk%25&order=key.desc&limit=1");
  let VD = {}; try { VD = JSON.parse(snap[0].value); } catch { return new Response("no snapshot"); }
  const plan = VD.plan && VD.plan[week];
  const nick = process.env.NICK_SLACK_ID, chef = process.env.CHEF_SLACK_ID;
  if (job === "mon") {
    if (plan && plan.locked) return new Response("already locked");
    await dm(nick, `:calendar: Morning — your plan for this week isn't locked yet. Set a day and how you'll make each deliverable happen, then lock it. <${SITE}/videodesk|Open the Video Desk>`);
    await dm(chef, `:hourglass_flowing_sand: Nick hasn't locked the Video Desk plan for the week of ${week} yet. I've nudged him.`);
    return new Response("nudged");
  }
  const sc = scorePlan(plan, await context(VD, week));
  if (!sc) { await dm(chef, `:warning: Nick never locked a Video Desk plan for the week of ${week}.`); return new Response("no plan"); }
  const text = fridayText(week, sc);
  await dm(chef, text); await dm(nick, text);
  return new Response("sent");
};
async function context(VD, week) {
  const rows = await sget(`planner_stories?select=reporter,story_num,filed&week_of=eq.${week}&filed=eq.true&story_num=in.(04,07)`);
  const impactFiled = new Set(rows.map((r) => r.reporter));
  const flags = await sget("system_flags?select=key,value&key=like.videotask%25&order=key.asc&limit=1000");
  const done = {};
  flags.forEach((f) => { if (f.key.startsWith("videotaskdone:")) { try { const v = JSON.parse(f.value); done[v.id] = !!v.done; } catch {} } });
  return { impactFiled, seriesStarted: (VD.series || []).some((s) => s.started === week), tasksDone: new Set(Object.keys(done).filter((k) => done[k])) };
}
