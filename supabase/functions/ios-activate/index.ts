import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN = "https://proyecto-mind-demo.vercel.app";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === ORIGIN ? ORIGIN : ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});
const json = (data: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function sha256Hex(value: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function safeLabel(value: unknown) {
  return String(value || "iPhone nativo").trim().replace(/\s+/g, " ").slice(0, 60) || "iPhone nativo";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);
  if (req.method === "GET") return json({ ok: true, ready: true }, 200, origin);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").trim();
    if (code.length < 8 || code.length > 128) return json({ ok: false, error: "invalid_code" }, 400, origin);

    const codeHash = await sha256Hex(code);
    const deviceToken = newToken();
    const tokenHash = await sha256Hex(deviceToken);
    const label = safeLabel(body.label);

    let activated = false;
    await sql.begin(async (tx) => {
      const used = await tx`
        update public.push_activation_codes
        set used_at = now()
        where code_hash = ${codeHash}
          and used_at is null
          and expires_at > now()
        returning code_hash`;
      if (!used.length) return;
      await tx`
        insert into public.mind_device_sessions(token_hash, label, last_seen_at)
        values(${tokenHash}, ${label}, now())`;
      activated = true;
    });

    if (!activated) return json({ ok: false, error: "invalid_or_expired_code" }, 401, origin);
    return json({ ok: true, deviceToken, label }, 201, origin);
  } catch (e) {
    console.error("ios-activate", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "activation_failed" }, 500, origin);
  }
});
