// ─────────────────────────────────────────────────────────────────────────────
// Monday-morning Video Desk plan → Slack DM to Nick. Plain counting only, no AI.
// The mirror of the Friday summary: what the week looks like before it starts.
// Fires at 22:00 and 23:00 UTC on Sundays; the function checks it is really
// Monday 9am in Sydney (so it is right across daylight saving).
//
// Imports helpers from video-digest.mjs — upload both files to the same folder.
// Env vars: the same as the Friday summary (NICK_SLACK_ID, SLACK_BOT_TOKEN,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL).
// ─────────────────────────────────────────────────────────────────────────────
import { sydneyParts, mondayOf, checklistItems, groupReporters, activeSeriesCount, sget, loadTasks, loadAway, awayIdx, sendDM } from "./video-digest.mjs";

export const config = { schedule: "0 22,23 * * 0" };

const SLOT_NAMES = { "01": "Original 1", "02": "Original 2", "03": "Video flip", "04": "Impact video" };
const utc = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (ymd, n) => new Date(utc(ymd) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dayName = (ymd) => { const d = new Date(utc(ymd)); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()] + " " + d.getUTCDate() + "/" + (d.getUTCMonth() + 1); };

export function shouldRun(now = new Date()) { const s = sydneyParts(now); return s.weekday === "Mon" && s.hour === 9; }

export function buildPlan({ today, week, snapshot, tasks, stories, away = [] }) {
  const snap = snapshot || { projects: [], checklist: {}, series: [] };
  const L = [];
  const prev = addDays(week, -7);

  L.push("*This week's checklist*");
  checklistItems(week).forEach((c) => L.push("• " + c.lbl));
  // Last week's misses, but only for weeks the desk was actually in use.
  const start = snap.deskStart || null;
  if (start && prev >= start) {
    const missed = checklistItems(prev).filter((c) => !((snap.checklist || {})[prev] || {})[c.k]);
    if (missed.length) L.push("_Carried over from last week:_ " + missed.map((c) => c.lbl).join("; "));
  }
  L.push("");

  const shoots = (snap.projects || []).filter((p) => p.stage === 0 && p.shootDate && daysBetween(today, p.shootDate) <= 6)
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate));
  if (shoots.length) {
    L.push("*Shoots*");
    shoots.forEach((p) => {
      const ps = p.preshoot || {}; const ready = ps.location && ps.gear && ps.talent && ps.brief;
      const late = daysBetween(today, p.shootDate) < 0;
      L.push(`• ${p.title} — ${late ? "date passed (" + dayName(p.shootDate) + "), not marked Shot" : dayName(p.shootDate)}${ready ? "" : " · pre-shoot open"}`);
    });
    L.push("");
  }

  const stuck = (snap.projects || []).filter((p) => p.stage < 4).map((p) => ({ p, age: Math.floor((Date.now() - (p.stageAt || p.created || Date.now())) / 864e5) }))
    .filter((x) => x.age >= 3 && !(x.p.stage === 0 && x.p.shootDate && daysBetween(today, x.p.shootDate) >= 0));
  if (stuck.length) {
    const st = ["Approved", "Shot", "Edited", "On platforms"];
    L.push("*Stuck in the pipeline*"); stuck.forEach((x) => L.push(`• ${x.p.title} — ${st[x.p.stage]} ${x.age}d ago`)); L.push("");
  }

  const allReps = groupReporters(stories);
  const awayNow = [];
  const reps = allReps.filter((r) => {
    const idx = awayIdx(away, r.name, r.pub, week);
    if (idx.length === 5) { awayNow.push(`${r.name} (all week)`); return false; }
    if (idx.length) awayNow.push(`${r.name} (${idx.map((i) => ["Mon", "Tue", "Wed", "Thu", "Fri"][i]).join(", ")})`);
    return true;
  });
  const plan = [];
  reps.forEach((r) => {
    const idx = awayIdx(away, r.name, r.pub, week);
    const need = Math.round(4 * (5 - idx.length) / 5);
    const missing = ["01", "02", "03", "04"].filter((n) => !(r.slots[n] && r.slots[n].headline));
    const planned = 4 - missing.length;
    if (planned < need) plan.push(`• *${r.name}* — ${planned}/${need} planned (need: ${missing.slice(0, need - planned).map((n) => SLOT_NAMES[n]).join(", ")})`);
  });
  if (awayNow.length) { L.push("*Away this week*"); awayNow.forEach((x) => L.push("• " + x)); L.push(""); }
  L.push(plan.length ? "*Planning — chase these by Wednesday*" : "*Planning*");
  if (plan.length) plan.forEach((x) => L.push(x)); else L.push("• All four videos planned for everyone 🎉");
  L.push("");

  const low = reps.map((r) => ({ r, n: activeSeriesCount(snap, r) })).filter((x) => x.n < 2);
  const newThis = (snap.series || []).filter((s) => s.started === week).length;
  L.push("*Series*");
  if (low.length) low.forEach((x) => L.push(`• ${x.r.name} — ${x.n}/2 running`)); else L.push("• Everyone has two running");
  L.push(newThis ? `• ${newThis} new series started this week` : "• No new series yet — aim for 1 across the team");
  L.push("");

  const open = (tasks || []).filter((t) => !t.done);
  if (open.length) {
    L.push("*Open tasks*");
    open.forEach((t) => {
      let tag = "";
      if (t.due) { const d = daysBetween(today, t.due); tag = d < 0 ? ` — overdue ${-d}d` : d === 0 ? " — due today" : ` — due ${dayName(t.due)}`; }
      L.push("• " + t.text + tag);
    });
  }
  return ":calendar: *Video Desk — the week ahead*\n\n" + L.join("\n").trim();
}

export default async () => {
  if (!shouldRun()) return new Response("not Monday 9am Sydney — skipped");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SLACK_BOT_TOKEN || !process.env.NICK_SLACK_ID) { console.warn("video-plan: missing env vars"); return new Response("not configured"); }
  const today = sydneyParts().ymd; const week = mondayOf(today);
  try {
    const snaps = await sget("system_flags?select=value&key=like.videodesk*&order=key.desc&limit=1");
    const snapshot = snaps[0] ? JSON.parse(snaps[0].value) : null;
    const tasks = await loadTasks();
    const away = await loadAway().catch(() => []);
    const stories = await sget(`planner_stories?week_of=eq.${week}&story_num=in.(01,02,03,04)&select=reporter,publication,story_num,headline,filed,file_day`);
    await sendDM(buildPlan({ today, week, snapshot, tasks, stories, away }));
    return new Response("sent");
  } catch (e) { console.error("video-plan failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
