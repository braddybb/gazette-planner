// ─────────────────────────────────────────────────────────────────────────────
// Impact Radar — SCHEDULER. Every 30 minutes it kicks off the background worker
// (impact-run-background), which does the slow work (fetch → gate → AI triage →
// alerts) and can run for up to 15 minutes. Cron is UTC; every 30 min is the same
// in any timezone.
// ─────────────────────────────────────────────────────────────────────────────
export const config = { schedule: "*/30 * * * *" };

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  try {
    await fetch(`${base}/.netlify/functions/impact-run-background`, { method: "POST" });
    return new Response("Impact Radar run triggered");
  } catch (e) { return new Response(`trigger failed: ${e.message}`, { status: 500 }); }
};
