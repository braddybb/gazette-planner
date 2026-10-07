// ─────────────────────────────────────────────────────────────────────────────
// /videotask  —  Slack slash command that drops a task onto the Video Desk's
// "Needs your eye" box.
//
//     /videotask Send me the shoot list for the Wendouree pool piece
//
// Same pattern as slack-assign.mjs: every request is verified against the Slack
// signing secret (so only Slack can trigger it), and the write uses the
// service-role key server-side only. It INSERTS one row into system_flags
// (key "videotask:<time>-<id>") — it never updates or overwrites anything, so
// it cannot clash with the Video Desk's own saves. No new env vars needed:
// it reuses SLACK_SIGNING_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY,
// which the /assign function already uses on this Netlify site.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;   // secret — server only
const MAX_LEN = 500;

export function verifySlack(rawBody, sig, ts, secret = SIGNING_SECRET) {
  if (!sig || !ts || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // >5 min old → reject (replay guard)
  const mac = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig)); } catch { return false; }
}

const reply = (text) => new Response(
  JSON.stringify({ response_type: "ephemeral", text }),
  { status: 200, headers: { "Content-Type": "application/json" } }
);

export default async (req) => {
  const raw = await req.text();
  if (!verifySlack(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"))) {
    return new Response("bad signature", { status: 401 });
  }
  const params = new URLSearchParams(raw);
  if (!params.get("command")) return new Response("", { status: 200 });

  const text = (params.get("text") || "").trim();
  if (!text) return reply("Usage: `/videotask <what needs doing>` — it lands in the Video Desk's *Needs your eye* box.");
  if (text.length > MAX_LEN) return reply(`:warning: That's ${text.length} characters — keep tasks under ${MAX_LEN}.`);
  if (!SERVICE_KEY) return reply(":warning: The task function isn't configured (missing service key).");

  const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const key = "videotask:" + Date.now() + "-" + id;
  const row = { key, value: JSON.stringify({ id, text, source: "slack", created: new Date().toISOString() }) };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/system_flags`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 160)}`);
  } catch (e) {
    console.error("videotask save failed:", e);
    return reply(":warning: Couldn't add that task — " + String(e.message).slice(0, 160));
  }
  return reply(":white_check_mark: Added to the Video Desk:\n>" + text);
};
