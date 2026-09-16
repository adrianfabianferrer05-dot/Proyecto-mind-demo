import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-capture-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function captureToken() {
  const rows = await sql`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'segunda_mente_capture_token'
    limit 1
  `;
  if (!rows.length || !rows[0].decrypted_secret) throw new Error("capture token missing");
  return String(rows[0].decrypted_secret);
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function classify(text: string) {
  const t = text.toLowerCase();
  const idea = /\b(idea|se me ocurre|podr[ií]a|proyecto|inventar|crear una?)\b/.test(t);
  const income = /\b(cobrad[oa]?|cobrar|ingres[oa]|n[oó]mina|sueldo|me han pagado|he recibido|me deben|me debe)\b/.test(t);
  const expense = /(?:€|\beuros?\b)|\b(gast(?:e|ado|ar|o)?|pag(?:u[eé]|ado|ar|o)?|compr(?:e|ado|ar|o)?|cena|comida|gasolina|supermercado|mercadona|restaurante|caf[eé]|parking|peaje|alquiler|factura)\b/.test(t);
  const task = /\b(recuerda|recu[eé]rdame|recordar|tarea|pendiente|tengo que|hay que|llamar|hacer|cita|mañana|pasado mañana|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes|el s[aá]bado|el domingo)\b/.test(t);

  if (idea) return "idea";
  if (income) return "income";
  if (expense) return "expense";
  if (task) return "task";
  return "note";
}

function financialAmount(text: string, kind: string): number | null {
  if (kind !== "expense" && kind !== "income") return null;

  const normalized = text.replace(/\u00a0/g, " ");

  let m = normalized.match(/(?:€\s*)?(\d{1,7})(?:[.,](\d{1,2}))(?:\s*€)?/);
  if (m) {
    const cents = m[2].padEnd(2, "0");
    const n = Number(`${m[1]}.${cents}`);
    return Number.isFinite(n) ? n : null;
  }

  m = normalized.match(/(?:€\s*)?\b(\d{1,7})\s+(\d{2})\b(?:\s*€)?/);
  if (m) {
    const n = Number(`${m[1]}.${m[2]}`);
    return Number.isFinite(n) ? n : null;
  }

  m = normalized.match(/(?:€\s*)?\b(\d{1,7})\b(?:\s*€|\s*euros?)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parse(text: string) {
  const kind = classify(text);
  return { kind, amount: financialAmount(text, kind) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const expected = await captureToken();
    const auth = req.headers.get("authorization") || "";
    const supplied = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7)
      : req.headers.get("x-capture-token") || "";
    if (!supplied || !safeEqual(supplied, expected)) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => null) as any;
    if (!body) return json({ ok: false, error: "invalid_json" }, 400);

    const raw = normalizeText(String(body.text ?? ""));
    if (!raw || raw.length > 4000) return json({ ok: false, error: "invalid_text" }, 400);

    const parsed = parse(raw);
    const sourceInput = String(body.source || "iphone_shortcut");
    const source = /^[a-z0-9_-]{1,64}$/i.test(sourceInput) ? sourceInput : "iphone_shortcut";

    const rows = await sql`
      insert into public.mind_captures (
        raw_text, kind, amount, currency, source, metadata, processed
      ) values (
        ${raw}, ${parsed.kind}, ${parsed.amount}, 'EUR', ${source},
        ${sql.json({ shortcut: source === "iphone_shortcut", version: 4, parser: "deterministic_v4" })}, false
      )
      returning id, raw_text, kind, amount, currency, source, processed, created_at
    `;

    return json({ ok: true, capture: rows[0] }, 201);
  } catch (err) {
    console.error("capture error", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: "internal_error", detail: message.slice(0, 160) }, 500);
  }
});
