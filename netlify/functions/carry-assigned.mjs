// ─────────────────────────────────────────────────────────────────────────────
// Carries unresolved ASSIGNED stories into the new week, so they stay on a
// reporter's planner until they're filed or abandoned.
//
// Runs early Monday (5am Sydney). For every story with `assigned_by` set that is
// still unfiled and not abandoned in an earlier week, it:
//   1. inserts a copy into this week as the reporter's next free extra slot
//      (headline, angle, notes, editor notes, format, to-do and posted ticks kept;
//       the file day is cleared so the reporter picks a new one),
//   2. marks the old row status = 'carried' so it never carries twice.
//
// Needs these columns on planner_stories (run once in the Supabase SQL editor):
//     alter table planner_stories
//       add column if not exists status text,
//       add column if not exists abandon_reason text,
//       add column if not exists abandoned_at timestamptz,
//       add column if not exists carried_from date;
//
// Env vars (already on the site): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Cron is UTC, so it fires at 18:00 and 19:00 UTC Sunday and checks it is really
// Monday 5am in Sydney (right across daylight saving).
// ─────────────────────────────────────────────────────────────────────────────

export const config = { schedule: "0 18,19 * * 0" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE = "planner_stories";
const LOOKBACK_WEEKS = 8;

// ── pure helpers (exported for testing) ──
export function sydneyParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}
export const shouldRun = (now = new Date()) => { const s = sydneyParts(now); return s.weekday === "Mon" && s.hour === 5; };
const utc = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (ymd, n) => new Date(utc(ymd) + n * 864e5).toISOString().slice(0, 10);
export const mondayOf = (ymd) => { const d = new Date(utc(ymd)); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return d.toISOString().slice(0, 10); };
export const baseCountFor = (pub) => (/^National Account/.test(pub || "") ? 8 : 10);

export function shouldCarry(row) {
  return !!(row && row.assigned_by && !row.filed && (!row.status || row.status === "open") && row.headline);
}
export function nextExtraNum(existingNums, base) {
  const used = (existingNums || []).map((n) => parseInt(n, 10)).filter((n) => n > base);
  return String(Math.max(base + 1, ...used.map((n) => n + 1))).padStart(2, "0");
}
export function buildCarryRow(old, week, num) {
  return {
    reporter: old.reporter, publication: old.publication, week_of: week, story_num: num,
    headline: old.headline || "", angle: old.angle || "", notes: old.notes || "",
    format: old.format || "", word_count: old.word_count || "", file_day: "",
    todo: old.todo || [], posted: old.posted || [], filed: false,
    editor_note: old.editor_note || "[]", editor_note_addressed: false,
    assigned_by: old.assigned_by,
    // first week it was assigned, preserved down a chain of carries
    carried_from: old.carried_from || old.week_of,
    updated_at: new Date().toISOString(),
  };
}

async function supa(method, path, body, prefer = "return=minimal") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function carryAssigned(thisWeek) {
  const since = addDays(thisWeek, -7 * LOOKBACK_WEEKS);
  const rows = await supa("GET", `${TABLE}?week_of=gte.${since}&week_of=lt.${thisWeek}&assigned_by=not.is.null&filed=eq.false&select=*&order=week_of.asc`, null, "return=representation");
  const todo = (rows || []).filter(shouldCarry);
  const summary = { carried: 0, skipped: 0, failed: 0 };
  for (const old of todo) {
    try {
      const k = `reporter=eq.${encodeURIComponent(old.reporter)}&publication=eq.${encodeURIComponent(old.publication)}`;
      const now = await supa("GET", `${TABLE}?${k}&week_of=eq.${thisWeek}&select=story_num,headline,carried_from,assigned_by`, null, "return=representation");
      const origin = old.carried_from || old.week_of;
      // already carried (a previous run died between the insert and the status update)?
      const dupe = (now || []).some((r) => r.assigned_by && r.headline === old.headline && r.carried_from === origin);
      if (!dupe) {
        const num = nextExtraNum((now || []).map((r) => r.story_num), baseCountFor(old.publication));
        await supa("POST", TABLE, buildCarryRow(old, thisWeek, num));
        summary.carried++;
      } else summary.skipped++;
      await supa("PATCH", `${TABLE}?${k}&week_of=eq.${old.week_of}&story_num=eq.${encodeURIComponent(old.story_num)}`, { status: "carried" });
    } catch (e) { summary.failed++; console.error("carry failed for", old.reporter, old.headline, e.message); }
  }
  return summary;
}

export default async () => {
  if (!shouldRun()) return new Response("not Monday 5am Sydney — skipped");
  if (!SERVICE_KEY) { console.warn("carry-assigned: missing SUPABASE_SERVICE_ROLE_KEY"); return new Response("not configured"); }
  try {
    const summary = await carryAssigned(mondayOf(sydneyParts().ymd));
    console.log("carry-assigned:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary));
  } catch (e) { console.error("carry-assigned failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
