// Patch Radar WORKER (Netlify background function, up to 15 min). Fetches every active patch source,
// routes items to patches, has Claude score them. Started by patch-cron at 7:15am Sydney Mon–Fri, by an editor
// pressing "Scan patches", or by a reporter pressing "Scan my patch". Only the 7:15am scheduled run DMs each reporter their patch's best new items (and mirrors to #gari); manual scans never message Slack. Env: SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (both set already).
import { run, PATCHES } from "./patch-lib.mjs";

// Who may start a scan: the 6:15am scheduler or an editor (whole network, 60s guard), or any signed-in
// reporter (their own patch only, once per 10 minutes per patch).
async function who(req, env, patches) {
  try {
    const body = await req.clone().json().catch(() => null);
    if (!body || body.force !== true) return null;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!token) return null;
    if (env.SUPABASE_SERVICE_ROLE_KEY && token === env.SUPABASE_SERVICE_ROLE_KEY) return { scope: "all", minGapMs: 60e3, notify: true }; // only the 7:15am scheduler DMs reporters / mirrors to #gari
    const base = env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co"; const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY };
    const u = await fetch(`${base}/auth/v1/user`, { headers: { ...h, Authorization: `Bearer ${token}` } }); if (!u.ok) return null;
    const id = (await u.json()).id; if (!id) return null;
    const p = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role`, { headers: { ...h, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    const rows = p.ok ? await p.json() : []; const role = rows[0] && rows[0].role;
    if (role === "editor") return { scope: patches.includes(body.patch) ? body.patch : "all", minGapMs: 60e3 };
    if (role === "reporter" && patches.includes(body.patch)) return { scope: body.patch, minGapMs: 10 * 60e3 };
    return null;
  } catch { return null; }
}
export default async (req) => {
  const env = process.env;
  const who_ = req && req.method === "POST" ? await who(req, env, PATCHES) : null;
  if (!who_) return new Response("manual or scheduled scans only", { status: 200 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return new Response("not configured", { status: 500 });
  try {
    const out = await run({ fetch: globalThis.fetch, env, now: Date.now(), model: env.IMPACT_MODEL || "claude-haiku-5-5", scope: who_.scope, minGapMs: who_.minGapMs, notify: who_.notify === true });
    console.log("patch run:", JSON.stringify(out).slice(0, 600)); return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) { console.error("patch run failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
