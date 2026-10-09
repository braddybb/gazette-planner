// ─────────────────────────────────────────────────────────────────────────────
// Weekday 8:45am (Sydney) "what needs you today" DM to Nick. Plain counting only —
// no AI. Sends NOTHING on a day with nothing waiting, so a message always means
// something. Mon and Fri already get the week-ahead plan / Friday summary 15
// minutes later, so on those days this only carries what those don't: reporter
// requests, quiet-series decisions and untagged videos.
//
// Netlify cron is UTC, so it fires at both 21:45 and 22:45 UTC Sun–Thu and the
// function checks it is really 8am-hour Mon–Fri in Sydney (right across daylight
// saving). Reads: videodesk% snapshot, videotask% / videohelp% rows, this week's
// planner_stories (slots 01–04), away records.
//
// Env vars: the same four as video-digest.mjs (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN, NICK_SLACK_ID). Optional URL.
// ─────────────────────────────────────────────────────────────────────────────

import { sget, loadTasks, loadAway, awayIdx, groupReporters, sendDM, sydneyParts, mondayOf, QUIET_DAYS } from "./video-digest.mjs";

export const config = { schedule: "45 21,22 * * 0-4" };

const SITE = process.env.URL || "https://gari-planner.netlify.app";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SLOT_NAMES = { "01": "Original 1", "02": "Original 2", "03": "Video flip", "04": "Impact video" };
const utc = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const first = (n) => String(n || "").split(" ")[0];
const dayLabel = (ymd) => { const d = new Date(utc(ymd)); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()] + " " + d.getUTCDate() + "/" + (d.getUTCMonth() + 1); };
const list = (a, n = 4) => a.length > n ? a.slice(0, n).join(", ") + ` +${a.length - n} more` : a.join(", ");

export function shouldRun(now = new Date()) { const s = sydneyParts(now); return DAYS.includes(s.weekday) && s.hour === 8; }

export async function loadHelp() {
  const rows = await sget("system_flags?select=key,value&key=like.videohelp*&order=key.asc&limit=1000");
  const reqs = {}, done = {};
  (rows || []).forEach((row) => { let v; try { v = JSON.parse(row.value); } catch { return; } if (!v || !v.id) return;
    if (row.key.startsWith("videohelpdone:")) done[v.id] = true; else if (row.key.startsWith("videohelp:")) reqs[v.id] = v; });
  return Object.values(reqs).filter((r) => !done[r.id]).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

// Series that read "quiet" by the desk's own rule: logged episodes, none for QUIET_DAYS, not already stalled by hand.
export function quietSeries(snap, now = Date.now()) {
  return ((snap && snap.series) || []).filter((s) => {
    if (s.status === "stalled") return false;
    const eps = ((snap && snap.projects) || []).filter((p) => p.seriesId === s.id && p.stage >= 3);
    if (!eps.length) return false;
    const last = Math.max(s.touched || 0, ...eps.map((p) => p.publishedAt || p.stageAt || p.created || 0));
    return Math.floor((now - last) / 864e5) >= QUIET_DAYS;
  });
}
export function untaggedPublished(snap, now = Date.now()) {
  return ((snap && snap.projects) || []).filter((p) => p.stage >= 3 && !p.format && now - (p.publishedAt || p.stageAt || p.created || 0) < 14 * 864e5);
}

export function buildDaily({ today, week, weekday, snapshot, tasks = [], help = [], stories = [], away = [], now = Date.now() }) {
  const snap = snapshot || { projects: [], series: [] };
  const idx = DAYS.indexOf(weekday);
  const extrasOnly = idx === 0 || idx === 4;       // Mon / Fri have their own DM
  const items = [];

  if (help.length) {
    items.push(`*${help.length} reporter request${help.length > 1 ? "s" : ""} waiting:* ` + list(help.map((h) => `${first(h.reporter)} (${h.type || "help"}, ${SLOT_NAMES[h.slot] || "video"})`)));
  }
  const quiet = quietSeries(snap, now);
  if (quiet.length) items.push(`*Keep or end?* ` + list(quiet.map((s) => `${s.title} (${first(s.reporter)})`)) + " — quiet " + QUIET_DAYS + "+ days");
  const untag = untaggedPublished(snap, now);
  if (untag.length) items.push(`*${untag.length} published video${untag.length > 1 ? "s need" : " needs"} a format tag*`);

  if (!extrasOnly) {
    const openTasks = tasks.filter((t) => !t.done && t.due && daysBetween(today, t.due) <= 0);
    if (openTasks.length) items.push(`*Tasks due:* ` + list(openTasks.map((t) => t.text + (daysBetween(today, t.due) < 0 ? " (overdue)" : ""))));
    const shootLines = [];
    ((snap.projects) || []).filter((p) => p.stage === 0 && p.shootDate).forEach((p) => {
      const d = daysBetween(today, p.shootDate); const ready = p.preshoot && p.preshoot.location && p.preshoot.gear && p.preshoot.talent && p.preshoot.brief;
      const who = p.standalone ? "standalone" : first(p.reporter);
      if (d === 0 || d === 1) shootLines.push(`${d === 0 ? "today" : "tomorrow"}: ${p.title} (${who})${ready ? "" : " — pre-shoot not done"}`);
      else if (d < 0) shootLines.push(`${p.title} (${who}) — shoot date ${dayLabel(p.shootDate)} passed, not marked Shot`);
    });
    if (shootLines.length) items.push("*Shoots:* " + shootLines.join("; "));

    const od = [], due = [], unp = [];
    groupReporters(stories).forEach((r) => {
      const away_ = awayIdx(away, r.name, r.pub, week);
      if (away_.length === 5) return;
      let spare = 4 - Math.round(4 * (5 - away_.length) / 5);
      const mine = { od: 0, due: 0, unp: 0 };
      ["01", "02", "03", "04"].forEach((n) => {
        const row = r.slots[n];
        if (row && row.filed) return;
        const has = !!(row && row.headline);
        const di = has && row.file_day ? DAYS.indexOf(row.file_day) : (has ? 4 : -1);
        if (di > -1 && away_.includes(di)) return;
        if (!has) { if (spare > 0) { spare--; return; } if (idx >= 2) mine.unp++; return; }
        if (di < idx) mine.od++; else if (di === idx) mine.due++;
      });
      if (mine.od) od.push(`${first(r.name)}${mine.od > 1 ? " ×" + mine.od : ""}`);
      if (mine.due) due.push(`${first(r.name)}${mine.due > 1 ? " ×" + mine.due : ""}`);
      if (mine.unp) unp.push(`${first(r.name)}${mine.unp > 1 ? " ×" + mine.unp : ""}`);
    });
    if (od.length) items.push("*Overdue videos:* " + list(od, 6));
    if (due.length) items.push("*Due today:* " + list(due, 6));
    if (unp.length) items.push("*Not planned yet:* " + list(unp, 6));
  }

  if (!items.length) return null;
  return `:sunrise: *Video Desk — ${dayLabel(today)}*\n` + items.map((x) => "• " + x).join("\n") + `\n<${SITE}/videodesk|Open the desk>`;
}

export default async () => {
  if (!shouldRun()) return new Response("not 8am Mon–Fri Sydney — skipped");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SLACK_BOT_TOKEN || !process.env.NICK_SLACK_ID) { console.warn("video-daily: missing env vars"); return new Response("not configured", { status: 200 }); }
  const s = sydneyParts(); const today = s.ymd; const week = mondayOf(today);
  try {
    const snaps = await sget("system_flags?select=value&key=like.videodesk*&order=key.desc&limit=1");
    const snapshot = snaps[0] ? JSON.parse(snaps[0].value) : null;
    const [tasks, help, away] = await Promise.all([loadTasks().catch(() => []), loadHelp().catch(() => []), loadAway().catch(() => [])]);
    const stories = await sget(`planner_stories?week_of=eq.${week}&story_num=in.(01,02,03,04)&select=reporter,publication,story_num,headline,filed,file_day`);
    const text = buildDaily({ today, week, weekday: s.weekday, snapshot, tasks, help, stories, away });
    if (!text) return new Response("nothing waiting — no DM sent");
    await sendDM(text);
    return new Response("sent");
  } catch (e) { console.error("video-daily failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
