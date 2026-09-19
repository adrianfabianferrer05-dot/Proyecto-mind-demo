/* La puerta del atajo del iPhone: dictas a Siri y lo que digas entra por aqui.

   Estaba desplegada en produccion sin codigo en el repositorio, y con su propia copia
   del interprete: la version antigua, la que se comia los miles ("1.234,56 €" acababa
   guardado como 234,56). Es decir, lo mismo escrito desde la app y dicho al atajo daba
   resultados distintos. Ahora las dos puertas usan el MISMO `interpret.js` que `mind`,
   que es de lo que se trataba: una sola forma de entender lo que dices.

   Se autentica distinto que la app a proposito: el atajo no tiene sesion de
   dispositivo, lleva un token propio guardado en el Vault. El token nunca aparece en
   el codigo ni viaja al navegador. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { KINDS, fallbackParse } from "./interpret.js";

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
/* Comparacion en tiempo constante: con un `===` normal, el tiempo de respuesta
   filtra cuantos caracteres del token has acertado. */
function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function vaultSecret(name: string) {
  const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  return rows[0]?.decrypted_secret ? String(rows[0].decrypted_secret) : null;
}
async function captureToken() {
  const token = await vaultSecret("segunda_mente_capture_token");
  if (!token) throw new Error("capture token missing");
  return token;
}
function normalizeText(text: string) { return text.replace(/\s+/g, " ").trim(); }

function responseText(out: any) {
  if (typeof out?.output_text === "string") return out.output_text;
  for (const item of out?.output || []) for (const part of item?.content || []) if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
  return null;
}
async function interpret(text: string) {
  const key = await vaultSecret("segunda_mente_openai_api_key");
  if (!key) return null;
  const schema = { type: "object", additionalProperties: false, properties: {
    kind: { type: "string", enum: [...KINDS] }, title: { type: "string" }, amount: { anyOf: [{ type: "number" }, { type: "null" }] }, currency: { anyOf: [{ type: "string" }, { type: "null" }] }, category: { anyOf: [{ type: "string" }, { type: "null" }] }, occurredAt: { anyOf: [{ type: "string" }, { type: "null" }] }, dueAt: { anyOf: [{ type: "string" }, { type: "null" }] }, clarificationNeeded: { type: "boolean" }, clarificationQuestion: { anyOf: [{ type: "string" }, { type: "null" }] }, confidence: { type: "number", minimum: 0, maximum: 1 }, debtDirection: { anyOf: [{ type: "string", enum: ["receivable", "payable"] }, { type: "null" }] }
  }, required: ["kind", "title", "amount", "currency", "category", "occurredAt", "dueAt", "clarificationNeeded", "clarificationQuestion", "confidence", "debtDirection"] };
  const now = new Date().toISOString();
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({
    model: "gpt-5.6-luna", store: false, reasoning: { effort: "none" },
    input: [{ role: "system", content: `Eres el intérprete privado de Segunda Mente. Convierte una frase natural en UN registro estructurado. Zona horaria Europe/Madrid. Ahora: ${now}. Tipos: expense gasto real; income ingreso real; task acción pendiente; idea idea; note recuerdo/contexto; event cita/reunión/plan con fecha; debt dinero pendiente por cobrar o pagar. “me deben 70€” es debt/receivable, nunca income. “le debo 40 a Juan” es debt/payable. Distingue dinero de horas: “18 50 cena” puede ser 18,50 € por el contexto; “llamar a las 18 50” es una hora y NO dinero. dueAt es el momento explícito en el que debería avisarse; no inventes una hora si el usuario no la dijo. occurredAt es cuándo ocurrió algo ya pasado, solo si está claro. No inventes datos. Si falta algo indispensable para actuar, pide una sola aclaración breve en español.` }, { role: "user", content: text }],
    text: { format: { type: "json_schema", name: "mind_capture", strict: true, schema } }
  })});
  if (!r.ok) { console.error("openai", r.status, await r.text()); return null; }
  const txt = responseText(await r.json()); if (!txt) return null;
  try { return JSON.parse(txt) } catch { return null }
}
/* El aviso se encola igual que desde la app; la politica (silencio nocturno,
   antelacion, tipos apagados) la aplica el trigger de la cola, no esta funcion. */
async function scheduleReminder(capture: any) {
  if (!capture?.due_at) return;
  const due = new Date(capture.due_at);
  if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now() + 30000) return;
  const body = String(capture.title || capture.raw_text || "Tienes algo pendiente.").slice(0, 220);
  await sql`insert into public.notification_queue(title,body,target_url,scheduled_at,status,capture_id) values('Segunda Mente',${body},'/',${due},'queued',${capture.id})`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const expected = await captureToken();
    const auth = req.headers.get("authorization") || "";
    const supplied = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-capture-token") || "").trim();
    if (!supplied || !safeEqual(supplied, expected)) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => null) as any;
    if (!body) return json({ ok: false, error: "invalid_json" }, 400);
    const raw = normalizeText(String(body.text ?? ""));
    if (!raw || raw.length > 4000) return json({ ok: false, error: "invalid_text" }, 400);

    const ai = await interpret(raw), parsed = ai || fallbackParse(raw);
    if (!KINDS.includes(parsed.kind as any)) parsed.kind = "note";
    const occurred = parsed.occurredAt && Number.isFinite(new Date(parsed.occurredAt).getTime()) ? new Date(parsed.occurredAt) : null;
    const due = parsed.dueAt && Number.isFinite(new Date(parsed.dueAt).getTime()) ? new Date(parsed.dueAt) : null;
    const sourceInput = String(body.source || "iphone_shortcut");
    const source = /^[a-z0-9_-]{1,64}$/i.test(sourceInput) ? sourceInput : "iphone_shortcut";
    const metadata = { shortcut: source === "iphone_shortcut", version: 7, interpreter: ai ? "openai" : "rules", confidence: parsed.confidence ?? null, clarification_needed: !!parsed.clarificationNeeded, clarification_question: parsed.clarificationQuestion ?? null, debt_direction: parsed.debtDirection ?? null };

    const rows = await sql`
      insert into public.mind_captures (raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed)
      values (${raw},${parsed.kind},${parsed.amount ?? null},${parsed.currency || "EUR"},${parsed.category ?? null},${parsed.title || raw.slice(0, 120)},${occurred},${due},${source},${sql.json(metadata)},${!!ai})
      returning id,raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed,completed_at,archived_at,created_at,updated_at
    `;
    const capture = rows[0];
    await scheduleReminder(capture);
    return json({ ok: true, capture, clarification: parsed.clarificationNeeded ? parsed.clarificationQuestion : null, ai: !!ai }, 201);
  } catch (err) {
    console.error("capture error", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: "internal_error", detail: message.slice(0, 160) }, 500);
  }
});
