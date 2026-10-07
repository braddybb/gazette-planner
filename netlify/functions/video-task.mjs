// ─────────────────────────────────────────────────────────────────────────────
// /videotask  —  Slack slash command that drops a task onto the Video Desk's
// "Needs your eye" box.
//
//     /videotask Send me the shoot list for the Wendouree pool piece by friday
//   (a trailing "by friday" / "due tomorrow" / "by 2026-10-14" becomes the due date)
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

// Pulls a trailing due date off the task text: "… by friday", "due tomorrow", "by 2026-10-14".
// Dates are worked out in Sydney time. A weekday means its next occurrence (today counts).
export function parseDue(text, now = new Date()) {
  const m = text.match(/\s*[\(\[]?\b(?:by|due)\s+(today|tomorrow|tmrw|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2})\b[\)\]]?\s*[.!]?\s*$/i);
  if (!m) return { text, due: null };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, mo, d] = today.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const w = m[1].toLowerCase();
  let due;
  if (w === "today") due = iso(base);
  else if (w === "tomorrow" || w === "tmrw") due = iso(base + 864e5);
  else if (/^\d{4}-/.test(w)) { due = isNaN(Date.parse(w)) ? null : w; }
  else {
    const idx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(w.slice(0, 3));
    const dow = new Date(base).getUTCDay();
    due = iso(base + ((idx - dow + 7) % 7) * 864e5);
  }
  if (!due) return { text, due: null };
  const stripped = text.slice(0, m.index).trim();
  return { text: stripped || text, due };
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

  const parsed = parseDue(text);
  const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const key = "videotask:" + Date.now() + "-" + id;
  const row = { key, value: JSON.stringify({ id, text: parsed.text, source: "slack", created: new Date().toISOString(), ...(parsed.due ? { due: parsed.due } : {}) }) };

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
  return reply(":white_check_mark: Added to the Video Desk" + (parsed.due ? " (due " + parsed.due + ")" : "") + ":\n>" + parsed.text);
};
