/* Transcripcion de voz. La app graba con el microfono del iPhone y manda el audio
   en crudo aqui; aqui se transcribe y se devuelve texto. Nada mas.

   Vive aparte a proposito: la clave de OpenAI no puede salir del backend, asi que el
   navegador no puede hablar con OpenAI ni aunque quisiera. Llega el audio, sale el
   texto, y a partir de ahi el camino es el de siempre: el texto entra por `mind`, lo
   interpreta el mismo interprete que el teclado y termina en la misma confirmacion.
   Un solo interprete para todo, escriba uno o hable.

   El audio no se guarda en ningun sitio: se lee del cuerpo de la peticion, se reenvia
   y se olvida. Lo unico que persiste es lo que tu decidas guardar despues. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN = "https://proyecto-mind-demo.vercel.app";
const MAX_BYTES = 12 * 1024 * 1024; // ~10 min de voz en m4a; de sobra para soltar algo
/* El primero es el bueno; el segundo existe desde siempre y sirve de red por si la
   cuenta todavia no tiene acceso al nuevo. */
const MODELS = ["gpt-4o-mini-transcribe", "whisper-1"];
/* La extension del fichero no es decorativa: OpenAI valida que este en su lista
   antes de mirar el contenido. Las admitidas son flac, m4a, mp3, mp4, mpeg, mpga,
   oga, ogg, wav y webm; cualquier otra se rechaza aunque el audio sea perfecto.
   Por eso `audio/aac` va a "m4a" y no a "aac": aac no esta en la lista, y el
   decodificador de OpenAI reconoce el formato por el contenido de todas formas.

   Lo que manda de verdad cada navegador:
     iOS Safari  -> audio/mp4 (AAC dentro de MP4), a veces con ;codecs=mp4a.40.2
     Chrome      -> audio/webm;codecs=opus, y audio/mp4;codecs=opus en versiones nuevas
     Firefox     -> audio/ogg;codecs=opus
   El `;codecs=...` se recorta antes de buscar aqui. Lo que no reconozcamos cae en
   "m4a", que es lo que manda un iPhone y esta en la lista. */
const EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/oga": "oga",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const cors = () => ({
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function sha256Hex(value: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function auth(req: Request) {
  const h = req.headers.get("authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length < 24) return null;
  const rows = await sql`select id from public.mind_device_sessions where token_hash=${await sha256Hex(token)} and revoked_at is null limit 1`;
  if (!rows.length) return null;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return rows[0];
}

async function vaultSecret(name: string) {
  const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  return rows[0]?.decrypted_secret || null;
}

async function transcribe(key: string, audio: ArrayBuffer, type: string) {
  const ext = EXT[type] || "m4a";
  let last = "";
  for (const model of MODELS) {
    const form = new FormData();
    form.append("file", new File([audio], `voz.${ext}`, { type }));
    form.append("model", model);
    form.append("language", "es");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (r.ok) return String((await r.json())?.text || "").trim();
    last = (await r.text()).slice(0, 200);
    console.error("openai transcribe", model, r.status, last);
    /* Solo merece la pena reintentar si el problema es el modelo. Una clave mala o
       una cuota agotada van a fallar igual con el siguiente. */
    if (r.status !== 400 && r.status !== 404) break;
  }
  throw new Error(last || "transcription_failed");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403);
  if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await auth(req))) return json({ ok: false, error: "unauthorized" }, 401);

  /* Saber de antemano si se puede transcribir evita el peor final posible: grabar
     treinta segundos, subirlos y entonces enterarte de que no habia clave. */
  if (req.method === "GET") return json({ ok: true, ready: !!(await vaultSecret("segunda_mente_openai_api_key")) });

  try {
    const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("audio/")) return json({ ok: false, error: "audio_required" }, 415);

    const audio = await req.arrayBuffer();
    if (!audio.byteLength) return json({ ok: false, error: "empty_audio" }, 400);
    if (audio.byteLength > MAX_BYTES) return json({ ok: false, error: "audio_too_large" }, 413);

    const key = await vaultSecret("segunda_mente_openai_api_key");
    if (!key) return json({ ok: false, error: "openai_not_connected" }, 409);

    const text = await transcribe(key, audio, type);
    if (!text) return json({ ok: false, error: "nothing_heard" }, 422);
    return json({ ok: true, text });
  } catch (err) {
    console.error("voice", err);
    const detail = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: "transcription_failed", detail: detail.slice(0, 180) }, 502);
  }
});
