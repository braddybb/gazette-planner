// ─────────────────────────────────────────────────────────────────────────────
// Impact Radar — WORKER (Netlify background function: "-background" → up to 15 min).
// Pulls every active source in impact_sources, drops anything off-beat or already
// seen, saves the rest to impact_items, has Claude score each new item (relevance,
// why it matters, a story angle, topics, which masthead it touches), then DMs the
// Impact editor about any watchlist hits.
//
// Env vars: ANTHROPIC_API_KEY (already set for GARI), SUPABASE_SERVICE_ROLE_KEY
// (already set), SLACK_BOT_TOKEN (already set), IMPACT_EDITOR_SLACK_ID (new —
// the Impact editor's Slack member ID, for DMs). Optional: IMPACT_MODEL (defaults
// to a small, cheap model), BSKY_HANDLE + BSKY_APP_PASSWORD (to read Bluesky).
// It works without the Slack/Bluesky ones — those parts just report "not set up".
// ─────────────────────────────────────────────────────────────────────────────
import { run } from "./impact-lib.mjs";

export default async () => {
  const env = process.env;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error("impact: missing SUPABASE_SERVICE_ROLE_KEY"); return new Response("not configured", { status: 500 }); }
  try {
    const out = await run({ fetch: globalThis.fetch, env, now: Date.now(), model: env.IMPACT_MODEL || "claude-haiku-5-5" });
    console.log("impact run:", JSON.stringify(out).slice(0, 600));
    return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) { console.error("impact run failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
