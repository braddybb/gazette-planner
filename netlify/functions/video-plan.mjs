// ─────────────────────────────────────────────────────────────────────────────
// Week plan → Slack. The Video Desk POSTs here (signed in) when Nick locks his
// Monday plan; we DM the editorial director a plain summary. Nothing is stored
// here — the plan itself lives in the desk snapshot.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_BOT_TOKEN,
// CHEF_SLACK_ID (who gets the summary). Optional: URL (link in the message).
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SITE = process.env.URL || "https://gari-planner.netlify.app";
const clip = (v, n) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, n);

export function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 60).map((i) => ({ label: clip(i && i.label, 120), day: clip(i && i.day, 3), how: clip(i && i.how, 200), why: clip(i && i.why, 200), status: ["done", "skip", "away", "open"].includes(i && i.status) ? i.status : (i && i.done ? "done" : "open") })).filter((i) => i.label);
}
export function planText(week, items) {
  const open = items.filter((i) => i.status === "open"), done = items.filter((i) => i.status === "done"), skip = items.filter((i) => i.status === "skip"), away = items.filter((i) => i.status === "away");
  const noDay = open.filter((i) => !i.day);
  const L = [`:calendar: *Nick has locked the week of ${week}* — ${open.length} to deliver, ${done.length} already landed${skip.length ? `, ${skip.length} called off` : ""}${away.length ? `, ${away.length} away` : ""}`];
  if (noDay.length) L.push(`:warning: *Locked with gaps — ${noDay.length} item${noDay.length > 1 ? "s have" : " has"} no day set:* ${noDay.map((i) => i.label).join(", ")}`);
  const byDay = {};
  open.filter((i) => i.day).forEach((i) => { (byDay[i.day] = byDay[i.day] || []).push(i); });
  ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((d) => { if (byDay[d]) { L.push(`*${d}*`); byDay[d].forEach((i) => L.push(`• ${i.label}${i.how ? ` — _${i.how}_` : ""}`)); } });
  if (skip.length) { L.push("*Won't happen this week:*"); skip.forEach((i) => L.push(`• ${i.label} — ${i.why ? `_${i.why}_` : "no reason given"}`)); }
  if (away.length) L.push(`*Away:* ${away.map((i) => i.label).join(", ")}`);
  L.push(`<${SITE}/videodesk|Open the Video Desk>`);
  return L.join("\n");
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
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const items = cleanItems(b && b.items), week = clip(b && b.week, 10);
  if (!items.length || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ error: "bad request" }, 400);
  const to = process.env.CHEF_SLACK_ID;
  if (!BOT_TOKEN || !to) return json({ ok: true, sent: false });
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: to, text: planText(week, items), unfurl_links: false }) });
    const j = await r.json(); if (!j.ok) console.warn("video-plan DM:", j.error);
    return json({ ok: true, sent: !!j.ok });
  } catch (e) { console.warn("video-plan DM failed", e); return json({ ok: true, sent: false }); }
};
