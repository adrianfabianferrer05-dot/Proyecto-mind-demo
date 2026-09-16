const ALLOWED_KINDS = new Set(['expense', 'income', 'task', 'idea', 'note']);

function classify(text) {
  const t = String(text || '').trim();
  const amountMatch = t.match(/(?:€\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)?/i);
  const expense = /\b(gast|pag|compr|cena|comida|gasolina|supermerc|mercadona)\w*/i.test(t);
  const income = /\b(cobrad|ingres|nomina|nómina|sueldo)\w*/i.test(t);
  const task = /\b(recu[eé]rd|mañana|llamar|hacer|tarea|pendiente)\b/i.test(t);
  const idea = /\bidea\b/i.test(t);

  return {
    raw_text: t,
    kind: income ? 'income' : expense ? 'expense' : task ? 'task' : idea ? 'idea' : 'note',
    amount: amountMatch ? Number(amountMatch[1].replace(',', '.')) : null,
  };
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const expected = process.env.CAPTURE_TOKEN;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-capture-token'];
  if (!expected || !supplied || supplied !== expected) {
    return json(res, 401, { ok: false, error: 'unauthorized' });
  }

  const raw = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body); } catch { return { text: req.body }; } })()
    : (req.body || {});

  const text = String(raw.text || '').trim().slice(0, 4000);
  if (!text) return json(res, 400, { ok: false, error: 'text_required' });

  const parsed = classify(text);
  if (raw.kind && ALLOWED_KINDS.has(raw.kind)) parsed.kind = raw.kind;

  const row = {
    raw_text: parsed.raw_text,
    kind: parsed.kind,
    amount: Number.isFinite(parsed.amount) ? parsed.amount : null,
    currency: 'EUR',
    source: String(raw.source || 'iphone_shortcut').slice(0, 80),
    metadata: { shortcut: true, version: 2 },
    processed: false,
  };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(res, 503, { ok: false, error: 'storage_not_configured' });

  try {
    const r = await fetch(`${url}/rest/v1/mind_captures`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('capture_store_failed', r.status, detail);
      return json(res, 502, { ok: false, error: 'storage_failed' });
    }

    const saved = await r.json();
    return json(res, 201, { ok: true, capture: saved[0] || row });
  } catch (error) {
    console.error('capture_store_exception', error);
    return json(res, 502, { ok: false, error: 'storage_unreachable' });
  }
}
