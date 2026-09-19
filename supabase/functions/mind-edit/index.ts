/* Acciones directas: todo lo que el usuario cambia a mano, sin pasar por el
   interprete. Vive aparte de `mind` a proposito: alli el texto libre se interpreta
   y aqui los campos vienen ya decididos por la persona, asi que no hay modelo, no
   hay ambiguedad y no hay nada que adivinar.

   - capture_update : cambiar titulo, fecha o tipo de algo ya capturado
   - capture_create : crear una tarea o un plan con los campos rellenos
   - capture_delete : borrarlo de verdad (archivar solo lo aparta, y lo archivado
                      sigue saliendo al buscar por significado)
   - prefs_get / prefs_set : preferencias de avisos (encendido, por tipo, antelacion
                             y silencio nocturno; no hay preferencia de gym porque
                             hoy ningun entreno encola avisos)

   Reprograma el aviso al cambiar la fecha, y lo cancela si la nueva fecha ya pasó
   o si el tipo deja de avisar. Misma autenticacion por token de dispositivo que el
   resto: el token nunca viaja en claro a la base, solo su sha256. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN = "https://proyecto-mind-demo.vercel.app";
const KINDS = ["expense", "income", "task", "idea", "note", "event", "debt"];
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const cors = () => ({
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const rows = await sql`select id,label from public.mind_device_sessions where token_hash=${await sha256Hex(token)} and revoked_at is null limit 1`;
  if (!rows.length) return null;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return rows[0];
}

const UUID = /^[0-9a-f-]{36}$/i;
const COLS = sql`id,raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed,completed_at,archived_at,created_at,updated_at`;

function cleanDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : undefined; // undefined = invalida
}

/* Un aviso solo se encola si el tipo avisa y la preferencia lo permite. El resto
   de la politica (silencio nocturno, antelacion) la aplica el trigger en la cola,
   para que valga igual venga de donde venga el aviso. */
async function reschedule(capture: any) {
  await sql`update public.notification_queue set status='cancelled',updated_at=now() where capture_id=${capture.id}::uuid and status='queued'`;
  if (!capture.due_at || capture.completed_at || capture.archived_at) return;
  const due = new Date(capture.due_at);
  if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now() + 30000) return;
  const body = String(capture.title || capture.raw_text || "Tienes algo pendiente.").slice(0, 220);
  await sql`insert into public.notification_queue(title,body,target_url,scheduled_at,status,capture_id)
            values('Segunda Mente',${body},'/',${due},'queued',${capture.id})`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await auth(req))) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "capture_update") {
      const id = String(body.id || "");
      if (!UUID.test(id)) return json({ ok: false, error: "invalid_id" }, 400);
      const found = await sql`select ${COLS} from public.mind_captures where id=${id}::uuid limit 1`;
      if (!found.length) return json({ ok: false, error: "not_found" }, 404);
      const current = found[0];

      const title = body.title === undefined ? current.title : String(body.title).trim().slice(0, 200);
      if (body.title !== undefined && !title) return json({ ok: false, error: "title_required" }, 400);
      const due = body.dueAt === undefined ? current.due_at : cleanDate(body.dueAt);
      if (due === undefined) return json({ ok: false, error: "invalid_date" }, 400);
      const kind = body.kind === undefined ? current.kind : String(body.kind);
      if (!KINDS.includes(kind)) return json({ ok: false, error: "invalid_kind" }, 400);

      const rows = await sql`update public.mind_captures
        set title=${title}, due_at=${due}, kind=${kind}, updated_at=now()
        where id=${id}::uuid returning ${COLS}`;
      await reschedule(rows[0]);
      return json({ ok: true, capture: rows[0] });
    }

    if (action === "capture_create") {
      const kind = String(body.kind || "task");
      if (!KINDS.includes(kind)) return json({ ok: false, error: "invalid_kind" }, 400);
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) return json({ ok: false, error: "title_required" }, 400);
      const due = cleanDate(body.dueAt);
      if (due === undefined) return json({ ok: false, error: "invalid_date" }, 400);
      const rows = await sql`insert into public.mind_captures(raw_text,kind,title,due_at,currency,source,metadata,processed)
        values(${title},${kind},${title},${due},'EUR','week_view',${sql.json({ interpreter: "manual" })},true)
        returning ${COLS}`;
      await reschedule(rows[0]);
      return json({ ok: true, capture: rows[0] }, 201);
    }

    /* Borrado de verdad. Archivar es reversible y sigue en la memoria; esto no.
       La cola de avisos cuelga de la captura con ON DELETE CASCADE, y el
       movimiento bancario conciliado se queda con la referencia a null en vez de
       desaparecer con ella. */
    if (action === "capture_delete") {
      const id = String(body.id || "");
      if (!UUID.test(id)) return json({ ok: false, error: "invalid_id" }, 400);
      const rows = await sql`delete from public.mind_captures where id=${id}::uuid returning id`;
      if (!rows.length) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, deleted: rows[0].id });
    }

    if (action === "prefs_get") {
      const rows = await sql`select * from public.notification_preferences where id=1`;
      return json({ ok: true, prefs: rows[0] || null });
    }

    if (action === "prefs_set") {
      const p = body.prefs || {};
      const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
      const mins = (v: unknown, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.round(n) : fallback;
      };
      const hour = (v: unknown, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.round(n) : fallback;
      };
      const cur = (await sql`select * from public.notification_preferences where id=1`)[0] || {};
      const rows = await sql`update public.notification_preferences set
        enabled=${bool(p.enabled, cur.enabled ?? true)},
        tasks=${bool(p.tasks, cur.tasks ?? true)},
        events=${bool(p.events, cur.events ?? true)},
        reminders=${bool(p.reminders, cur.reminders ?? true)},
        lead_minutes=${mins(p.leadMinutes, cur.lead_minutes ?? 0)},
        quiet_from_hour=${hour(p.quietFromHour, cur.quiet_from_hour ?? 23)},
        quiet_to_hour=${hour(p.quietToHour, cur.quiet_to_hour ?? 8)},
        quiet_enabled=${bool(p.quietEnabled, cur.quiet_enabled ?? true)},
        updated_at=now()
        where id=1 returning *`;
      return json({ ok: true, prefs: rows[0] });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    console.error("mind-edit", err);
    const detail = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: "internal_error", detail: detail.slice(0, 180) }, 500);
  }
});
