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

// "Scan now" from the Radar: a signed-in EDITOR can skip the 8-minute throttle (a 60-second
// guard against double-clicks remains). Anyone else asking for force is just treated as a normal run.
async function isEditor(req, env) {
  try {
    const body = await req.clone().json().catch(() => null);
    if (!body || body.force !== true) return false;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return false;
    const base = env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
    const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY };
    const u = await fetch(`${base}/auth/v1/user`, { headers: { ...h, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const id = (await u.json()).id; if (!id) return false;
    const p = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role`, { headers: { ...h, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    const rows = p.ok ? await p.json() : [];
    return rows[0] && rows[0].role === "editor";
  } catch { return false; }
}

export default async (req) => {
  const env = process.env;
  const force = req && req.method === "POST" ? await isEditor(req, env) : false;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error("impact: missing SUPABASE_SERVICE_ROLE_KEY"); return new Response("not configured", { status: 500 }); }
  try {
    const out = await run({ fetch: globalThis.fetch, env, now: Date.now(), model: env.IMPACT_MODEL || "claude-haiku-5-5", ...(force ? { minGapMs: 60e3 } : {}) });
    console.log("impact run:", JSON.stringify(out).slice(0, 600));
    return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) { console.error("impact run failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
