// ─────────────────────────────────────────────────────────────────────────────
// Friday-morning Video Desk summary → Slack DM to Nick. Plain counting only —
// no AI, no drafting. Runs 9am Sydney every Friday.
//
// Netlify cron is UTC, so it fires at both 22:00 and 23:00 UTC on Thursdays and
// the function itself checks that it is really Friday 9am in Sydney (this keeps
// it right across daylight saving). Reads: the latest videodesk% snapshot,
// videotask% rows, and this week's planner_stories (slots 01–04, local mastheads).
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN (chat:write),
// and NICK_SLACK_ID (Nick's Slack member ID, e.g. U01ABC2DEF3) — the only new one.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { schedule: "0 22,23 * * 4" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN    = process.env.SLACK_BOT_TOKEN;
const NICK_ID      = process.env.NICK_SLACK_ID;

const SLOT_NAMES = { "01": "Original 1", "02": "Original 2", "03": "Video flip", "04": "Impact video" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
// The six local mastheads (National Account is deliberately left out). Used so a reporter
// with NO planner rows at all still shows up as behind, instead of being invisible.
export const ROSTER = [
  { name: "Douglas Connor", pub: "Mid North Coaster" }, { name: "Huw Bradshaw", pub: "North Shore Lorikeet" },
  { name: "Matthew Sims", pub: "Eastern Melburnian" }, { name: "Zara Cuthbertson", pub: "West Vic Brolga — Wannon" },
  { name: "Darcie Humphreys", pub: "West Vic Brolga — Ballarat" }, { name: "Jacob Wallace", pub: "Gippsland Monitor" },
];
export const QUIET_DAYS = 14;
export function groupReporters(stories) {
  const by = {};
  ROSTER.forEach((r) => { by[r.name + "|" + r.pub] = { name: r.name, pub: r.pub, slots: {} }; });
  (stories || []).forEach((s) => {
    if (/^National Account/.test(s.publication || "")) return;
    const k = s.reporter + "|" + s.publication;
    (by[k] = by[k] || { name: s.reporter, pub: s.publication, slots: {} }).slots[s.story_num] = s;
  });
  return Object.values(by);
}
// Same rule as the desk: quiet = has logged episodes and none for QUIET_DAYS; manual "stalled" always counts.
export function activeSeriesCount(snap, r) {
  return ((snap && snap.series) || []).filter((s) => {
    if (s.reporter !== r.name || s.pub !== r.pub) return false;
    if (s.status === "stalled") return false;
    const eps = ((snap && snap.projects) || []).filter((p) => p.seriesId === s.id && p.stage >= 3);
    if (!eps.length) return true;
    const last = Math.max(s.touched || 0, ...eps.map((p) => p.publishedAt || p.stageAt || p.created || 0));
    return Math.floor((Date.now() - last) / 864e5) < QUIET_DAYS;
  }).length;
}

// ── pure helpers (exported for testing) ──
export function sydneyParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}
export function shouldRun(now = new Date()) { const s = sydneyParts(now); return s.weekday === "Fri" && s.hour === 9; }
const utc = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const mondayOf = (ymd) => { const d = new Date(utc(ymd)); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const fortnightIndex = (week) => Math.floor(utc(week) / 864e5 / 7) % 2;
const shortDay = (ymd) => { const d = new Date(utc(ymd)); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()] + " " + d.getUTCDate() + "/" + (d.getUTCMonth() + 1); };

export function checklistItems(week) {
  const f = fortnightIndex(week);
  return [
    { k: "heat", lbl: "Run HEAT review" },
    { k: "brandpub", lbl: "Publish a video to Gazette brand channels" },
    { k: "casestudy", lbl: "Case study of the week" },
    { k: "flag", lbl: "Send Friday end-of-week report" },
    ...(f === 0 ? [{ k: "feedback", lbl: "Reporter video feedback round" }] : [{ k: "pubteam", lbl: "Report to publishing team" }]),
  ];
}

// Friday: anything with a Mon–Thu file day that isn't filed is overdue; Friday/no day = due today.
export function slotState(row) {
  if (row && row.filed) return "filed";
  if (!(row && row.headline)) return "unplanned";
  const d = row.file_day ? DAYS.indexOf(row.file_day) : 4;
  return d >= 0 && d < 4 ? "overdue" : "due";
}

export function buildDigest({ today, week, snapshot, tasks, stories }) {
  const L = [];
  const snap = snapshot || { projects: [], checklist: {} };
  const wk = (snap.checklist || {})[week] || {};
  const open = checklistItems(week).filter((c) => !wk[c.k]);
  const flags = [];

  // desk checklist
  if (open.length) { L.push("*Your checklist — still open this week*"); open.forEach((c) => L.push("• " + c.lbl)); L.push(""); }

  // reporters
  const repLines = [];
  let filedTotal = 0, repCount = 0;
  groupReporters(stories).forEach((r) => {
    repCount++;
    const bits = [];
    let filed = 0;
    ["01", "02", "03", "04"].forEach((n) => {
      const st = slotState(r.slots[n]);
      if (st === "filed") filed++;
      else if (st === "overdue") bits.push(SLOT_NAMES[n] + " overdue");
      else if (st === "due") bits.push(SLOT_NAMES[n] + " due today");
      else bits.push(SLOT_NAMES[n] + " not planned");
    });
    filedTotal += filed;
    if (filed < 4) repLines.push(`• *${r.name}* ${filed}/4 — ${bits.join(", ")}`);
  });
  if (repCount) {
    L.push(`*Video output — ${filedTotal}/${repCount * 4} filed*`);
    if (repLines.length) repLines.forEach((x) => L.push(x)); else L.push("• Everyone is at 4/4 🎉");
    L.push("");
  }

  // pipeline
  const proj = (snap.projects || []).filter((p) => p.stage < 4);
  const pLines = [];
  proj.forEach((p) => {
    const age = Math.floor((Date.now() - (p.stageAt || p.created || Date.now())) / 864e5);
    const stages = ["Approved", "Shot", "Edited", "On platforms"];
    if (p.shootDate) {
      const d = daysBetween(today, p.shootDate);
      if (p.stage === 0 && d < 0) pLines.push(`• ${p.title} — shoot date (${shortDay(p.shootDate)}) passed, not marked Shot`);
      else if (p.stage === 0 && d <= 7) pLines.push(`• ${p.title} — shooting ${shortDay(p.shootDate)}`);
      else if (p.stage > 0 && age >= 3) pLines.push(`• ${p.title} — ${stages[p.stage]} ${age}d ago`);
    } else if (age >= 3) pLines.push(`• ${p.title} — ${stages[p.stage]} ${age}d ago`);
  });
  if (pLines.length) { L.push("*Pipeline*"); pLines.forEach((x) => L.push(x)); L.push(""); }

  // tasks
  const openTasks = (tasks || []).filter((t) => !t.done);
  if (openTasks.length) {
    L.push("*Open tasks*");
    openTasks.forEach((t) => {
      let tag = "";
      if (t.due) { const d = daysBetween(today, t.due); tag = d < 0 ? ` — overdue ${-d}d` : d === 0 ? " — due today" : ` — due ${shortDay(t.due)}`; }
      L.push("• " + t.text + tag);
    });
    L.push("");
  }

  const body = L.join("\n").trim();
  if (!body) return ":sunrise: *Video Desk — Friday* \nNothing outstanding. Nice week.";
  return ":sunrise: *Video Desk — Friday*\n\n" + body;
}

// ── io ──
export async function sget(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
export async function loadTasks() {
  const rows = await sget("system_flags?select=key,value&key=like.videotask*&order=key.asc&limit=1000");
  const tasks = {}, done = {};
  rows.forEach((row) => { let v; try { v = JSON.parse(row.value); } catch { return; } if (!v || !v.id) return;
    if (row.key.startsWith("videotaskdone:")) done[v.id] = !!v.done; else if (row.key.startsWith("videotask:")) tasks[v.id] = v; });
  return Object.values(tasks).map((t) => ({ ...t, done: !!done[t.id] }));
}

export async function sendDM(text) {
  const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: NICK_ID, text }) });
  const j = await r.json();
  if (!j.ok) throw new Error("Slack: " + j.error);
}

export default async () => {
  if (!shouldRun()) return new Response("not Friday 9am Sydney — skipped");
  if (!SERVICE_KEY || !BOT_TOKEN || !NICK_ID) { console.warn("video-digest: missing SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN or NICK_SLACK_ID"); return new Response("not configured", { status: 200 }); }
  const today = sydneyParts().ymd; const week = mondayOf(today);
  try {
    const snaps = await sget("system_flags?select=value&key=like.videodesk*&order=key.desc&limit=1");
    const snapshot = snaps[0] ? JSON.parse(snaps[0].value) : null;
    const tasks = await loadTasks();
    const stories = await sget(`planner_stories?week_of=eq.${week}&story_num=in.(01,02,03,04)&select=reporter,publication,story_num,headline,filed,file_day`);
    const text = buildDigest({ today, week, snapshot, tasks, stories });
    await sendDM(text);
    return new Response("sent");
  } catch (e) { console.error("video-digest failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
