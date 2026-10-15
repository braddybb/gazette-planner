// Patch Radar WORKER (Netlify background function, up to 15 min). Fetches every active patch source,
// routes items to patches, has Claude score them. Started by patch-cron at 6:15am Sydney Mon–Fri, or by an
// editor pressing "Scan patches" in the Editor Dashboard. Env: SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (both set already).
import { run } from "./patch-lib.mjs";

async function isEditor(req, env) {
  try {
    const body = await req.clone().json().catch(() => null);
    if (!body || body.force !== true) return false;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""); if (!token) return false;
    if (env.SUPABASE_SERVICE_ROLE_KEY && token === env.SUPABASE_SERVICE_ROLE_KEY) return true;
    const base = env.SUPABASE_URL || "https://asgyshkafnrqknnmkbfo.supabase.co"; const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY };
    const u = await fetch(`${base}/auth/v1/user`, { headers: { ...h, Authorization: `Bearer ${token}` } }); if (!u.ok) return false;
    const id = (await u.json()).id; if (!id) return false;
    const p = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role`, { headers: { ...h, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    const rows = p.ok ? await p.json() : []; return rows[0] && rows[0].role === "editor";
  } catch { return false; }
}
export default async (req) => {
  const env = process.env;
  const force = req && req.method === "POST" ? await isEditor(req, env) : false;
  if (!force) return new Response("manual or scheduled scans only", { status: 200 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return new Response("not configured", { status: 500 });
  try {
    const out = await run({ fetch: globalThis.fetch, env, now: Date.now(), model: env.IMPACT_MODEL || "claude-haiku-5-5", minGapMs: 60e3 });
    console.log("patch run:", JSON.stringify(out).slice(0, 600)); return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) { console.error("patch run failed:", e); return new Response("failed: " + e.message, { status: 500 }); }
};
