import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import webpush from "npm:web-push@3.6.7";

const ALLOWED_ORIGINS = new Set([
  "https://proyecto-mind-demo.vercel.app",
]);

const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(DB_URL, { prepare: false, max: 1 });

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://proyecto-mind-demo.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function secrets() {
  const rows = await sql`
    select name, decrypted_secret
    from vault.decrypted_secrets
    where name in (
      'segunda_mente_vapid_private',
      'segunda_mente_vapid_public',
      'segunda_mente_push_send_token'
    )
  `;
  const out: Record<string, string> = {};
  for (const row of rows) out[row.name] = row.decrypted_secret;
  if (!out.segunda_mente_vapid_private || !out.segunda_mente_vapid_public || !out.segunda_mente_push_send_token) {
    throw new Error("push secrets missing");
  }
  return out;
}

function validSubscription(s: any) {
  return !!(
    s && typeof s === "object" &&
    typeof s.endpoint === "string" && s.endpoint.startsWith("https://") &&
    s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string"
  );
}

async function deliver(subscription: any, payload: { title: string; body: string; url?: string }, vapidPublic: string, vapidPrivate: string) {
  webpush.setVapidDetails("https://proyecto-mind-demo.vercel.app", vapidPublic, vapidPrivate);
  return await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 300, urgency: "normal" });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, origin);

  try {
    const sec = await secrets();

    if (req.method === "GET") {
      return json({ ok: true, publicKey: sec.segunda_mente_vapid_public }, 200, origin);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "subscribe") {
      const code = String(body.code || "");
      const subscription = body.subscription;
      if (!code || !validSubscription(subscription)) return json({ ok: false, error: "invalid_request" }, 400, origin);

      const codeHash = await sha256Hex(code);
      const codes = await sql`
        select code_hash
        from public.push_activation_codes
        where code_hash = ${codeHash}
          and used_at is null
          and expires_at > now()
        limit 1
      `;
      if (!codes.length) return json({ ok: false, error: "invalid_or_expired_code" }, 401, origin);

      const ua = req.headers.get("user-agent") || null;
      await sql`
        insert into public.push_subscriptions(endpoint, subscription, user_agent, active, failure_count, last_error, updated_at)
        values (${subscription.endpoint}, ${sql.json(subscription)}, ${ua}, true, 0, null, now())
        on conflict (endpoint) do update set
          subscription = excluded.subscription,
          user_agent = excluded.user_agent,
          active = true,
          failure_count = 0,
          last_error = null,
          updated_at = now()
      `;

      try {
        await deliver(
          subscription,
          { title: "Segunda Mente", body: "Notificaciones activadas ✓", url: "/" },
          sec.segunda_mente_vapid_public,
          sec.segunda_mente_vapid_private,
        );
        await sql`
          update public.push_subscriptions
          set last_success_at = now(), last_error = null, failure_count = 0, updated_at = now()
          where endpoint = ${subscription.endpoint}
        `;
        await sql`update public.push_activation_codes set used_at = now() where code_hash = ${codeHash}`;
        await sql`
          insert into public.notification_log(kind, title, body, target_count, success_count, failure_count, metadata)
          values ('web_push_test', 'Segunda Mente', 'Notificaciones activadas ✓', 1, 1, 0, ${sql.json({ endpoint: subscription.endpoint.slice(0, 80) })})
        `;
        return json({ ok: true, testPush: true }, 200, origin);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await sql`
          update public.push_subscriptions
          set failure_count = failure_count + 1, last_error = ${message.slice(0, 500)}, updated_at = now()
          where endpoint = ${subscription.endpoint}
        `;
        return json({ ok: false, error: "push_test_failed", detail: message.slice(0, 180) }, 502, origin);
      }
    }

    if (action === "send") {
      const auth = req.headers.get("authorization") || "";
      const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : String(body.token || "");
      if (!provided || !safeEqual(provided, sec.segunda_mente_push_send_token)) {
        return json({ ok: false, error: "unauthorized" }, 401, origin);
      }

      const title = String(body.title || "Segunda Mente").slice(0, 80);
      const message = String(body.body || "Tienes algo pendiente.").slice(0, 220);
      const url = typeof body.url === "string" && body.url.startsWith("/") ? body.url : "/";
      const rows = await sql`select endpoint, subscription from public.push_subscriptions where active = true order by updated_at desc limit 20`;
      let success = 0;
      let failure = 0;

      for (const row of rows) {
        try {
          await deliver(row.subscription, { title, body: message, url }, sec.segunda_mente_vapid_public, sec.segunda_mente_vapid_private);
          success++;
          await sql`update public.push_subscriptions set last_success_at=now(), failure_count=0, last_error=null, updated_at=now() where endpoint=${row.endpoint}`;
        } catch (err: any) {
          failure++;
          const status = Number(err?.statusCode || 0);
          const msg = err instanceof Error ? err.message : String(err);
          await sql`
            update public.push_subscriptions
            set failure_count=failure_count+1,
                last_error=${msg.slice(0, 500)},
                active=case when ${status} in (404,410) then false else active end,
                updated_at=now()
            where endpoint=${row.endpoint}
          `;
        }
      }

      await sql`
        insert into public.notification_log(kind, title, body, target_count, success_count, failure_count, metadata)
        values ('web_push', ${title}, ${message}, ${rows.length}, ${success}, ${failure}, ${sql.json({ url })})
      `;
      return json({ ok: true, targets: rows.length, success, failure }, 200, origin);
    }

    return json({ ok: false, error: "unknown_action" }, 400, origin);
  } catch (err) {
    console.error("push function error", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: "internal_error", detail: message.slice(0, 180) }, 500, origin);
  }
});
