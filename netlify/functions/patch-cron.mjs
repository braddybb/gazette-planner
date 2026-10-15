// Patch Radar scheduler: 7:15am Sydney, Mon–Fri (cron is UTC, so both daylight-saving offsets are scheduled and the hour is checked here).
export const config = { schedule: "15 20,21 * * 0-4" };
export function sydneyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, weekday: p.weekday };
}
export const shouldRun = (now = new Date()) => { const s = sydneyNow(now); return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(s.weekday) && s.hour === 7; };
export default async () => {
  if (!shouldRun()) return new Response("not 7:15am Mon–Fri Sydney — skipped");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) return new Response("not configured", { status: 500 });
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  try {
    await fetch(`${base}/.netlify/functions/patch-run-background`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ force: true }) });
    return new Response("Patch Radar morning scan triggered");
  } catch (e) { return new Response(`trigger failed: ${e.message}`, { status: 500 }); }
};
