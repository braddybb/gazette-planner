// ─────────────────────────────────────────────────────────────────────────────
// Reporter "Need video help" → the Video Desk + an instant Slack DM to Nick.
//
// The reporter planner POSTs here (signed in as the reporter). We check the
// session token is a real, signed-in user, then INSERT one row into system_flags
// (key "videohelp:<time>-<id>") with the service key — insert-only, never an
// update — and DM Nick so it can't sit unseen. The Video Desk shows it under
// "Needs your eye → Reporters asking for you" until he resolves it.
//
// Env vars (all already used by the other video functions): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN, NICK_SLACK_ID. Optional: URL
// (Netlify sets it) for the link in the DM.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN    = process.env.SLACK_BOT_TOKEN;
const NICK_ID      = process.env.NICK_SLACK_ID;
const SITE         = process.env.URL || "https://gari-planner.netlify.app";

export const TYPES = ["Shoot help", "Edit help", "Idea / series pitch", "Stuck on it", "Something else"];
const SLOT_NAMES = { "01": "Original 1", "02": "Original 2", "03": "Video flip", "04": "Impact video" };
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

// Pure: turn the request body into the stored record (or null if it's unusable).
export function cleanPayload(b, now = Date.now(), rand = Math.random().toString(36).slice(2, 6)) {
  if (!b || typeof b !== "object") return null;
  const reporter = clip(b.reporter, 80), pub = clip(b.pub, 80), slot = clip(b.slot, 3);
  if (!reporter || !pub || !SLOT_NAMES[slot]) return null;
  const type = TYPES.includes(b.type) ? b.type : "Something else";
  const id = now.toString(36) + rand;
  return { id, ts: now, reporter, pub, week: clip(b.week, 10), slot, headline: clip(b.headline, 200), type, note: clip(b.note, 500) };
}
export function dmText(rec) {
  const lines = [`:clapper: *${rec.reporter}* needs video help — *${rec.type}*`, `_${SLOT_NAMES[rec.slot]}${rec.headline ? ": " + rec.headline : ""}_`];
  if (rec.note) lines.push(">" + rec.note.replace(/\n+/g, " "));
  lines.push(`<${SITE}/videodesk|Open the Video Desk>`);
  return lines.join("\n");
}

async function signedIn(token) {
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SERVICE_KEY) return json({ error: "not configured" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let ok = false; try { ok = await signedIn(token); } catch { ok = false; }
  if (!ok) return json({ error: "not signed in" }, 401);
  let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const rec = cleanPayload(body);
  if (!rec) return json({ error: "bad request" }, 400);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/system_flags`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ key: `videohelp:${rec.ts}-${rec.id}`, value: JSON.stringify(rec) }),
    });
    if (!res.ok) { console.error("video-help insert failed", res.status, (await res.text()).slice(0, 200)); return json({ error: "could not save" }, 502); }
  } catch (e) { console.error("video-help insert error", e); return json({ error: "could not save" }, 502); }
  // The request is filed; the DM is a bonus and must never fail the call.
  if (BOT_TOKEN && NICK_ID) {
    try {
      const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: NICK_ID, text: dmText(rec) }) });
      const j = await r.json(); if (!j.ok) console.warn("video-help DM:", j.error);
    } catch (e) { console.warn("video-help DM failed", e); }
  }
  return json({ ok: true, id: rec.id });
};
