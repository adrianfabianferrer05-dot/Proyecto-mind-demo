import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN = "https://proyecto-mind-demo.vercel.app";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(DB_URL, { prepare: false, max: 1 });
const SECRET_NAME = "segunda_mente_openai_api_key";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorize(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length < 24) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await sql`
    select id, label
    from public.mind_device_sessions
    where token_hash = ${tokenHash} and revoked_at is null
    limit 1
  `;
  if (!rows.length) return null;
  await sql`update public.mind_device_sessions set last_seen_at = now() where id = ${rows[0].id}`;
  return rows[0];
}

async function enabled() {
  const rows = await sql`
    select id
    from vault.decrypted_secrets
    where name = ${SECRET_NAME} and decrypted_secret is not null and length(decrypted_secret) > 0
    limit 1
  `;
  return rows.length > 0;
}

async function verifyOpenAIKey(key: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: "Responde exactamente: OK",
      max_output_tokens: 8,
      store: false,
      reasoning: { effort: "none" },
    }),
  });
  if (response.ok) return { ok: true as const };
  const body = await response.json().catch(() => null) as any;
  const message = String(body?.error?.message || "No pude validar esa clave con OpenAI.").slice(0, 220);
  return { ok: false as const, status: response.status, message };
}

async function storeKey(key: string) {
  const rows = await sql`select id from vault.decrypted_secrets where name = ${SECRET_NAME} limit 1`;
  if (rows.length) {
    await sql`select vault.update_secret(${rows[0].id}::uuid, ${key}, ${SECRET_NAME}, 'OpenAI API key for Segunda Mente interpretation')`;
    return;
  }
  await sql`select vault.create_secret(${key}, ${SECRET_NAME}, 'OpenAI API key for Segunda Mente interpretation')`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403);

  const device = await authorize(req);
  if (!device) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    if (req.method === "GET") return json({ ok: true, aiEnabled: await enabled() });
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    const body = await req.json().catch(() => ({})) as any;
    const action = String(body.action || "set_openai_key");
    if (action !== "set_openai_key") return json({ ok: false, error: "unknown_action" }, 400);

    const key = String(body.key || "").trim();
    if (key.length < 20 || key.length > 512 || /\s/.test(key)) {
      return json({ ok: false, error: "invalid_key", detail: "La clave no tiene un formato válido." }, 400);
    }

    const check = await verifyOpenAIKey(key);
    if (!check.ok) {
      return json({ ok: false, error: "openai_key_rejected", detail: check.message }, check.status === 429 ? 429 : 400);
    }

    await storeKey(key);
    return json({ ok: true, aiEnabled: true });
  } catch (error) {
    console.error("mind-config", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
