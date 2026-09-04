// ─────────────────────────────────────────────────────────────────────────────
// /assign  —  Slack slash command that drops an "Editor assignment" card into a
// reporter's Planner, under Extra stories, in the current week.
//
// One Netlify function handles both halves of the Slack round-trip:
//   • the /assign slash command  → opens a modal (reporter + headline + notes)
//   • the modal submission        → inserts a planner_stories row and confirms
//
// It writes the SAME row shape the Planner writes by hand, so the card is
// identical to a reporter-added extra — except `assigned_by` is set, which the
// Planner already uses to label the card "Editor assignment".
//
// Extras are story_num beyond the base slots (8 for National Account, 10 for the
// local mastheads); this computes the next free extra slot for that reporter's week.
//
// Security: every request is verified against the Slack signing secret, so even
// though the endpoint is public only Slack can trigger it. The Supabase writes use
// the service-role key (server-side only) to insert on a reporter's behalf; that
// bypasses RLS for the insert but changes no RLS config.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;                 // xoxb-… (scopes: commands, chat:write)
const SUPABASE_URL   = process.env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co";
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;      // secret — server only
const TABLE = "planner_stories";

// ── pure helpers (unit-tested) ───────────────────────────────────────────────
function verifySlack(rawBody, sig, ts, secret = SIGNING_SECRET) {
  if (!sig || !ts || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // >5 min old → reject (replay guard)
  const mac = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig)); } catch { return false; }
}

function mondayOfNow(now = new Date()) {
  // "today" in Australian eastern time, then wind back to that week's Monday
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();                 // 0 Sun … 6 Sat
  dt.setUTCDate(dt.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return dt.toISOString().slice(0, 10);
}

function baseCountFor(pub) { return /^National Account/.test(pub || "") ? 8 : 10; }

function computeNextNum(existingNums, base) {
  const used = (existingNums || []).map(n => parseInt(n, 10)).filter(n => n > base);
  return String(Math.max(base + 1, ...used.map(n => n + 1))).padStart(2, "0");
}

function buildRow({ reporter, pub, week, num, headline, angle, notes, editorNote, assignedBy }) {
  return {
    reporter, publication: pub, week_of: week, story_num: num,
    headline: headline || "", angle: angle || "", notes: notes || "",
    format: "", word_count: "", file_day: "",
    todo: [], posted: [], filed: false,
    // editor notes are stored as a JSON-encoded array in the editor_note column (Planner convention)
    editor_note: JSON.stringify(editorNote ? [{ id: "a" + Date.now().toString(36), text: editorNote, addressed: false }] : []),
    editor_note_addressed: false,
    assigned_by: assignedBy || "Editor",
    updated_at: new Date().toISOString(),
  };
}

// ── Supabase (service role) ──────────────────────────────────────────────────
async function supa(method, path, body, prefer = "return=representation") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function listReporters() {
  const rows = await supa("GET", `profiles?select=name,reporter_name,publication,role&order=name`);
  return (rows || [])
    .filter(r => r.role !== "editor" && r.publication)
    .map(r => ({ reporter: r.reporter_name || r.name, publication: r.publication }));
}

async function nextExtraNum(reporter, pub, week) {
  const rows = await supa("GET",
    `${TABLE}?reporter=eq.${encodeURIComponent(reporter)}&publication=eq.${encodeURIComponent(pub)}&week_of=eq.${encodeURIComponent(week)}&select=story_num`);
  return computeNextNum((rows || []).map(r => r.story_num), baseCountFor(pub));
}

// ── Slack Web API ────────────────────────────────────────────────────────────
async function slack(method, payload) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${BOT_TOKEN}` },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function buildModal(reporters) {
  const options = reporters.slice(0, 100).map(r => ({
    text: { type: "plain_text", text: `${r.reporter} — ${r.publication}`.slice(0, 75) },
    value: JSON.stringify({ r: r.reporter, p: r.publication }).slice(0, 150),
  }));
  return {
    type: "modal", callback_id: "assign_story",
    title: { type: "plain_text", text: "Assign a story" },
    submit: { type: "plain_text", text: "Assign" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "input", block_id: "reporter", label: { type: "plain_text", text: "Reporter" },
        element: { type: "static_select", action_id: "v", placeholder: { type: "plain_text", text: "Choose a reporter" }, options } },
      { type: "input", block_id: "headline", label: { type: "plain_text", text: "Headline / working title" },
        element: { type: "plain_text_input", action_id: "v" } },
      { type: "input", block_id: "angle", optional: true, label: { type: "plain_text", text: "Angle" },
        element: { type: "plain_text_input", action_id: "v" } },
      { type: "input", block_id: "notes", optional: true, label: { type: "plain_text", text: "Brief / notes" },
        element: { type: "plain_text_input", action_id: "v", multiline: true } },
      { type: "input", block_id: "editor_note", optional: true, label: { type: "plain_text", text: "Note to reporter (shows on the card)" },
        element: { type: "plain_text_input", action_id: "v", multiline: true } },
    ],
  };
}

const val = (view, block) => {
  const b = view.state.values[block];
  const el = b && b.v;
  if (!el) return "";
  if (el.selected_option) return el.selected_option.value;
  return (el.value || "").trim();
};

// ── entry point ──────────────────────────────────────────────────────────────
export default async (req) => {
  const raw = await req.text();
  if (!verifySlack(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"))) {
    return new Response("bad signature", { status: 401 });
  }
  const params = new URLSearchParams(raw);

  // (A) modal submission → insert the row
  if (params.get("payload")) {
    const payload = JSON.parse(params.get("payload"));
    if (payload.type === "view_submission" && payload.view.callback_id === "assign_story") {
      try {
        const sel = JSON.parse(val(payload.view, "reporter"));
        const week = mondayOfNow();
        const num = await nextExtraNum(sel.r, sel.p, week);
        const row = buildRow({
          reporter: sel.r, pub: sel.p, week, num,
          headline: val(payload.view, "headline"),
          angle: val(payload.view, "angle"),
          notes: val(payload.view, "notes"),
          editorNote: val(payload.view, "editor_note"),
          assignedBy: payload.user?.name || payload.user?.username || "Editor",
        });
        await supa("POST", TABLE, row, "return=minimal");
        await slack("chat.postMessage", {
          channel: payload.user.id,
          text: `:white_check_mark: Assigned to *${sel.r}* — ${sel.p}, week of ${week}, extra slot ${num}.\n> ${row.headline || "(no headline yet)"}`,
        }).catch(() => {});
        return new Response("", { status: 200 }); // empty 200 closes the modal
      } catch (e) {
        return new Response(JSON.stringify({ response_action: "errors", errors: { headline: "Couldn't save: " + String(e.message).slice(0, 140) } }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("", { status: 200 });
  }

  // (B) /assign slash command → open the modal
  if (params.get("command")) {
    try {
      const reporters = await listReporters();
      const r = await slack("views.open", { trigger_id: params.get("trigger_id"), view: buildModal(reporters) });
      if (!r.ok) console.error("views.open failed:", r);
    } catch (e) { console.error("open modal failed:", e); }
    return new Response("", { status: 200 });
  }

  return new Response("", { status: 200 });
};
