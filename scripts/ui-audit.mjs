/* Auditoría de interfaz en un navegador de verdad.

   Los tests de `node --test` prueban la lógica; esto prueba lo que pasa cuando alguien
   toca la pantalla con el dedo: que la hoja abra, que la fila se mueva de día, que el
   micrófono se suelte al terminar y que nada mida menos de 44 píxeles en un iPhone.
   Esa clase de fallo no se ve en un test de funciones y es justo la que se nota.

   Se salta solo si no hay navegador, igual que el typecheck se salta sin Deno: en CI
   se instala y aquí no hace falta que todo el mundo lo tenga.

   Se ejecuta con `npm run audit:ui`. Pasa a 390 px (iPhone normal) y a 320 px (el más
   estrecho que queda vivo). */
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('audit de interfaz omitido · playwright no esta instalado (en CI si se instala)');
  process.exit(0);
}

/* El navegador puede venir de la instalacion de playwright o de una imagen que ya
   trae Chromium; se acepta cualquiera antes que no poder comprobar nada. */
/* Microfono simulado: sin el, `getUserMedia` falla en un contenedor sin tarjeta de
   sonido y la parte de voz no se podria comprobar. */
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

async function launch() {
  try {
    return await chromium.launch({ args: ARGS });
  } catch (e) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const found = existsSync(base)
      ? readdirSync(base)
          .filter((d) => d.startsWith('chromium-'))
          .map((d) => join(base, d, 'chrome-linux', 'chrome'))
          .find((p) => existsSync(p))
      : null;
    if (!found) {
      console.log(`audit de interfaz omitido · no hay Chromium utilizable (${e.message.split('\n')[0]})`);
      process.exit(0);
    }
    return chromium.launch({ executablePath: found, args: ARGS });
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (path.includes('..')) return void res.writeHead(400).end();
    const file = join(ROOT, path);
    try {
      await access(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const day = (d, h = 12) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, 0, 0, 0);
  return x.toISOString();
};

async function run(width) {
  const fails = [];
  const step = (name, ok, extra = '') => {
    if (!ok) fails.push(`${name}${extra ? ' · ' + extra : ''}`);
    console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${extra && !ok ? ' · ' + extra : ''}`);
  };

  /* Con SM_SHOTS=<carpeta> ademas de comprobar, se guarda como queda. Sirve para
     mirar el diseño con ojos, que es lo unico que detecta que algo es feo. */
  const shotDir = process.env.SM_SHOTS;
  const shot = (name) => (shotDir ? page.screenshot({ path: `${shotDir}/${width}-${name}.png` }) : Promise.resolve());

  const { server, port } = await serve();
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    permissions: ['microphone'],
  });

  let captures = [
    { id: 'c1', raw_text: 'Cena con Marcos', title: 'Cena con Marcos', kind: 'event', amount: null, created_at: day(-2), due_at: day(1, 19), metadata: {} },
    { id: 'c2', raw_text: 'Llamar al seguro', title: 'Llamar al seguro', kind: 'task', amount: null, created_at: day(-1), due_at: day(0, 17), metadata: {} },
  ];
  let prefs = { id: 1, enabled: true, tasks: true, events: true, reminders: true, lead_minutes: 0, quiet_enabled: true, quiet_from_hour: 23, quiet_to_hour: 8 };
  const edits = [];
  const uploads = [];
  const gymActions = [];
  let voiceMode = 'ok';

  /* Rutina de ejemplo: tres dias y una semana a medio configurar, que es donde se
     ven los cuatro estados a la vez. `ayer` queda asignado y sin hacer (pendiente),
     `anteayer` tiene sesion (realizado) y hoy toca (programado). */
  const hoyWd = new Date().getDay();
  const ayerWd = (hoyWd + 6) % 7;
  const anteayerWd = (hoyWd + 5) % 7;
  const gymDays = [
    { id: 'gd1', routine_id: 'r1', name: 'Pecho + Espalda', position: 0, notes: null },
    { id: 'gd2', routine_id: 'r1', name: 'Pierna', position: 1, notes: null },
    { id: 'gd3', routine_id: 'r1', name: 'Brazos', position: 2, notes: null },
  ];
  const schedule = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    day_id: weekday === hoyWd ? 'gd1' : weekday === ayerWd ? 'gd2' : weekday === anteayerWd ? 'gd3' : null,
  }));
  const gymPayload = () => ({
    ok: true,
    routine: { id: 'r1', name: 'Mi rutina' },
    days: gymDays,
    exercises: [
      { id: 'ge1', day_id: 'gd1', name: 'Press banca', position: 0, target_sets: 3, rep_min: 8, rep_max: 12, rest_seconds: 120, increment_kg: 2.5 },
      { id: 'ge2', day_id: 'gd1', name: 'Dominadas', position: 1, target_sets: 3, rep_min: 6, rep_max: 10, rest_seconds: 120, increment_kg: 2.5 },
    ],
    activeSession: null,
    activeSets: [],
    recentSets: [],
    bests: [],
    body: [],
    schedule,
    stats: { sessions_month: 3, sessions_30d: 5 },
    history: [{ id: 'h1', day_id: 'gd3', day_name_snapshot: 'Brazos', started_at: day(-2, 18), finished_at: day(-2, 19), set_count: 18, volume_kg: 5400 }],
  });

  /* Movimientos de mentira con la forma de los de verdad: nombre ya normalizado,
     categoria puesta y uno ya emparejado con un gasto apuntado a mano. */
  const CATS = ['Alimentación', 'Comer fuera', 'Ocio', 'Transporte', 'Compras', 'Suscripciones', 'Hogar', 'Salud', 'Gimnasio', 'Viajes', 'Transferencias / Bizum', 'Efectivo', 'Ingresos', 'Otros', 'Sin clasificar'];
  const moneyActions = [];
  const movimientos = [
    { id: 'm1', booked_at: day(-1), amount: -29.42, merchant_normalized: 'Mercadona', description: 'OP.TARJ MERCADONA', category: 'Alimentación', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm2', booked_at: day(-2), amount: -17.7, merchant_normalized: 'Mercadona', description: 'OP.TARJ MERCADONA', category: 'Alimentación', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm3', booked_at: day(-2), amount: -23.1, merchant_normalized: 'Crepería Dimas', description: 'OP.TARJ CREPERIA', category: 'Comer fuera', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm4', booked_at: day(-4), amount: -7.8, merchant_normalized: 'Crepería Dimas', description: 'OP.TARJ CREPERIA', category: 'Comer fuera', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm5', booked_at: day(-5), amount: -8.99, merchant_normalized: 'Netflix', description: 'OP.TARJ NETFLIX', category: 'Suscripciones', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm6', booked_at: day(-6), amount: -20, merchant_normalized: 'E.S. Herrero', description: 'OP.TARJ ES HERRERO', category: 'Transporte', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: 'cap-1' },
    { id: 'm7', booked_at: day(-7), amount: -18, merchant_normalized: 'Bizum · Mohamed L.', description: 'BIZUM ENVIADO', category: 'Transferencias / Bizum', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
    { id: 'm8', booked_at: day(-8), amount: 200, merchant_normalized: 'Nómina · Marlex', description: 'NOMINA', category: 'Ingresos', classification_source: 'rule', classification_confidence: 1, reconciled_capture_id: null },
  ];
  const suscripciones = [{ comercio: 'Netflix', status: 'possible', amount: 8.99, months: 4, last_seen: day(-5).slice(0, 10) }];
  const mesActual = () => new Date().toISOString().slice(0, 7);
  function resumenDinero() {
    const porCat = new Map();
    for (const t of movimientos) {
      const c = t.category || 'Sin clasificar';
      const v = porCat.get(c) || { categoria: c, gastado: 0, ingresado: 0, movimientos: 0, anterior: 0 };
      if (t.amount < 0) v.gastado = Math.round((v.gastado - t.amount) * 100) / 100;
      else v.ingresado = Math.round((v.ingresado + t.amount) * 100) / 100;
      v.movimientos++;
      porCat.set(c, v);
    }
    const total = [...porCat.values()].reduce((s, c) => s + c.gastado, 0);
    /* Un mes anterior de mentira pero coherente: sirve para que la comparacion
       tenga algo con lo que comparar. */
    const previos = { 'Alimentación': 65, 'Comer fuera': 12, 'Suscripciones': 8.99 };
    const categorias = [...porCat.values()].map((c) => ({
      ...c,
      anterior: previos[c.categoria] || 0,
      diferencia: Math.round((c.gastado - (previos[c.categoria] || 0)) * 100) / 100,
      porcentaje: total > 0 ? Math.round((c.gastado / total) * 1000) / 10 : 0,
    })).sort((a, b) => b.gastado - a.gastado);
    return {
      ok: true, mes: mesActual(), mes_anterior: '2026-08', total_gastado: Math.round(total * 100) / 100,
      total_ingresado: 200, balance: Math.round((200 - total) * 100) / 100, movimientos: movimientos.length,
      gastado_mes_anterior: 85.99, diferencia_total: Math.round((total - 85.99) * 100) / 100,
      categorias, sin_clasificar: 0, fuentes: { rule: movimientos.length }, suscripciones, reconciliados: 1,
    };
  }

  await ctx.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.endsWith('/voice')) {
      if (req.method() === 'GET') return route.fulfill({ json: { ok: true, ready: true } });
      uploads.push({ type: req.headers()['content-type'] || '', bytes: req.postDataBuffer()?.length || 0 });
      if (voiceMode === 'ok') return route.fulfill({ json: { ok: true, text: 'mañana a las nueve tengo dentista' } });
      return route.fulfill({ status: 409, json: { ok: false, error: 'openai_not_connected' } });
    }
    if (url.includes('mind-edit')) {
      const body = req.postDataJSON() || {};
      edits.push(body);
      if (body.action === 'prefs_get') return route.fulfill({ json: { ok: true, prefs } });
      if (body.action === 'prefs_set') {
        const p = body.prefs || {};
        prefs = { ...prefs, enabled: p.enabled ?? prefs.enabled, tasks: p.tasks ?? prefs.tasks, events: p.events ?? prefs.events, reminders: p.reminders ?? prefs.reminders, lead_minutes: p.leadMinutes ?? prefs.lead_minutes, quiet_enabled: p.quietEnabled ?? prefs.quiet_enabled, quiet_from_hour: p.quietFromHour ?? prefs.quiet_from_hour, quiet_to_hour: p.quietToHour ?? prefs.quiet_to_hour };
        return route.fulfill({ json: { ok: true, prefs } });
      }
      if (body.action === 'capture_create') {
        const c = { id: 'nueva-' + edits.length, raw_text: body.title, title: body.title, kind: body.kind, amount: null, currency: 'EUR', category: null, due_at: body.dueAt, created_at: new Date().toISOString(), metadata: { interpreter: 'manual' }, completed_at: null, archived_at: null };
        captures = [c, ...captures];
        return route.fulfill({ status: 201, json: { ok: true, capture: c } });
      }
      if (body.action === 'capture_delete') {
        const antes = captures.length;
        captures = captures.filter((x) => x.id !== body.id);
        if (captures.length === antes) return route.fulfill({ status: 404, json: { ok: false, error: 'not_found' } });
        return route.fulfill({ json: { ok: true, deleted: body.id } });
      }
      if (body.action === 'capture_update') {
        const c = captures.find((x) => x.id === body.id);
        Object.assign(c, { title: body.title ?? c.title, kind: body.kind ?? c.kind, due_at: body.dueAt === undefined ? c.due_at : body.dueAt });
        return route.fulfill({ json: { ok: true, capture: c } });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (url.includes('gym-progress')) return route.fulfill({ json: { ok: true, rows: [] } });
    if (/\/gym(\?|$)/.test(url)) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON() || {};
        gymActions.push(body);
        if (body.action === 'set_schedule') {
          const fila = schedule.find((s) => s.weekday === body.weekday);
          if (fila) fila.day_id = body.dayId || null;
        }
      }
      return route.fulfill({ json: gymPayload() });
    }
    /* Dinero por categorias. El resumen se recalcula al vuelo desde `movimientos`
       para que un cambio de categoria se note de verdad en la pantalla y no solo en
       la peticion: si la fila no cambia, el test no vale nada. */
    if (/\/money(\?|$)/.test(url)) {
      const body = req.postDataJSON() || {};
      moneyActions.push(body);
      if (body.action === 'categories') return route.fulfill({ json: { ok: true, categories: CATS } });
      if (body.action === 'transactions')
        return route.fulfill({ json: { ok: true, category: body.category, month: body.month, transactions: movimientos.filter((t) => t.category === body.category) } });
      if (body.action === 'set_category') {
        const t = movimientos.find((x) => x.id === body.id);
        if (t) t.category = body.category;
        if (body.learn) for (const o of movimientos) if (o.merchant_normalized === t?.merchant_normalized) o.category = body.category;
        return route.fulfill({ json: { ok: true, learned: !!body.learn, also_updated: body.learn ? 1 : 0, merchant: t?.merchant_normalized || null } });
      }
      if (body.action === 'subscription') {
        const sub = suscripciones.find((x) => x.comercio === body.merchant);
        if (sub) sub.status = body.status;
        return route.fulfill({ json: { ok: true, subscription: sub } });
      }
      if (body.action === 'classify') return route.fulfill({ json: { ok: true, reglas: 0, ia: { resueltos: 0 }, sin_clasificar: 0 } });
      return route.fulfill({ json: resumenDinero() });
    }
    if (url.includes('mind-config')) return route.fulfill({ json: { ok: true, aiConfigured: true } });
    if (url.includes('bank-config')) return route.fulfill({ json: { ok: true, configured: true } });
    if (url.includes('/bank'))
      return route.fulfill({
        json: {
          ok: true,
          bank: {
            connection: { status: 'AUTHORIZED', last_synced_at: new Date().toISOString() },
            accounts: [{ id: 'a1', name: 'Cajamar', current_balance: 12345.67, available_balance: 12345.67, currency: 'EUR' }],
            transactions: [
              { id: 't1', description: 'Nomina', amount: 1850.4, currency: 'EUR', booked_at: day(-3) },
              { id: 't2', description: 'Mercadona', amount: -84.2, currency: 'EUR', booked_at: day(-1) },
            ],
          },
        },
      });
    if (url.includes('/mind')) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON() || {};
        if (body.action === 'recall') {
          return route.fulfill({ json: { ok: true, memories: [{ ...captures[captures.length - 1], similarity: 0.82, archived_at: new Date().toISOString() }] } });
        }
        if (body.action === 'capture') {
          const c = { id: 'sync-' + captures.length, raw_text: body.text, title: body.text, kind: 'note', amount: null, currency: 'EUR', category: null, due_at: null, created_at: new Date().toISOString(), metadata: {}, completed_at: null, archived_at: null };
          captures = [c, ...captures];
          return route.fulfill({ status: 201, json: { ok: true, capture: c, ai: false } });
        }
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { ok: true, captures, aiEnabled: true } });
    }
    return route.fulfill({ json: { ok: true } });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  /* El 409 de "sin clave" lo provocamos a proposito y el navegador lo apunta en
     consola aunque la app lo trate bien: eso no es un error de la app. */
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 160));
  });
  await page.addInitScript(() => {
    localStorage.setItem('sm_device_token', 't'.repeat(44));
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__tracks = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await real(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  /* ── Semana: crear, editar, mover de dia, completar y archivar ─────────── */
  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(600);
  step('Semana pinta los siete dias', (await page.locator('.week-day').count()) === 7);

  /* Se trabaja sobre un dia que tenga sitio para moverse al siguiente: el domingo
     es el ultimo de la semana y no hay "dia de despues" donde comprobar nada. */
  const idx = await page.evaluate(() => Math.min(((new Date().getDay() + 6) % 7) + 1, 5));
  const past = await page.evaluate(() => Math.max(((new Date().getDay() + 6) % 7) - 1, 0));
  await page.locator(`#weekDay${idx} [data-week-add]`).first().click();
  await page.waitForTimeout(450);
  step('el "+" de un dia abre el editor en modo Añadir', (await page.locator('#editHead').textContent()) === 'Añadir');
  step('al crear no se ofrece "completada"', !(await page.locator('#editDoneRow').isVisible()));
  step('al crear no se ofrece "archivar"', !(await page.locator('#editArchive').isVisible()));
  await page.fill('#editTitle', 'Recoger el coche');
  await page.locator('#editKinds [data-kind="event"]').click();
  await page.locator('#editSave').click();
  await page.waitForTimeout(700);
  step('la fila nueva aparece en su dia', (await page.locator(`#weekDay${idx} .row-title`).allTextContents()).includes('Recoger el coche'));

  /* Se busca la fila por su titulo, no la primera del dia: segun el dia de la semana
     que toque, el dia elegido ya trae algo del fixture y `.first()` abria otra cosa.
     El test pasaba o fallaba segun el dia en que se ejecutara. */
  await page.locator(`#weekDay${idx} .row[data-id]`).filter({ hasText: 'Recoger el coche' }).first().click();
  await page.waitForTimeout(450);
  step('tocar una fila la abre para editar', (await page.locator('#editHead').textContent()) === 'Editar');
  step('al editar si se ofrece "archivar"', await page.locator('#editArchive').isVisible());
  const antes = await page.inputValue('#editDue');
  await page.locator('[data-quick="next"]').click();
  const despues = await page.inputValue('#editDue');
  step('“+1 día” mueve el dia y conserva la hora', new Date(despues) - new Date(antes) === 86400000 && antes.slice(11) === despues.slice(11), `${antes} → ${despues}`);
  await page.locator('#editSave').click();
  await page.waitForTimeout(700);
  step('la fila se ha movido de dia', (await page.locator(`#weekDay${idx + 1} .row-title`).allTextContents()).includes('Recoger el coche'));

  if (past !== (await page.evaluate(() => (new Date().getDay() + 6) % 7))) {
    await page.locator(`#weekDay${past} [data-week-add]`).first().click();
    await page.waitForTimeout(400);
    await page.fill('#editTitle', 'Lo de ayer');
    await page.locator('#editSave').click();
    await page.waitForTimeout(600);
    const enviado = edits.filter((c) => c.action === 'capture_create').at(-1);
    const esperado = await page.evaluate((i) => {
      const d = new Date();
      d.setDate(d.getDate() - (((d.getDay() + 6) % 7) - i));
      return d.toDateString();
    }, past);
    step('un dia pasado se respeta al crear', new Date(enviado.dueAt).toDateString() === esperado, enviado.dueAt);
  }

  const check = page.locator('#weekDays [data-complete]').first();
  if (await check.count()) {
    await check.click();
    await page.waitForTimeout(500);
    step('completar desde Semana marca la fila', (await page.locator('#weekDays .row.done').count()) > 0);
  }
  await page.locator(`#weekDay${idx + 1} .row[data-id]`).filter({ hasText: 'Recoger el coche' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('#editArchive').click();
  await page.waitForTimeout(700);
  step('archivar saca la fila de la semana', !(await page.locator(`#weekDay${idx + 1} .row-title`).allTextContents()).includes('Recoger el coche'));

  await page.locator('[data-week-move="1"]').click();
  await page.waitForTimeout(300);
  const siguiente = await page.locator('#weekRange').textContent();
  await page.locator('[data-week-move="0"]').click();
  await page.waitForTimeout(300);
  step('se navega de semana y se vuelve a esta', siguiente === 'La semana que viene' && (await page.locator('#weekRange').textContent()) === 'Esta semana');

  const gym = page.locator('[data-week-gym]').first();
  if (await gym.count()) {
    await gym.click();
    await page.waitForTimeout(600);
    step('tocar un entreno abre Gym', (await page.locator('#gym.active').count()) === 1);
    await page.locator('.nav button[data-view="semana"]').click();
    await page.waitForTimeout(400);
  }

  /* ── Preferencias de aviso ─────────────────────────────────────────────── */
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(400);
  await page.locator('#prefsSettings').click();
  await page.waitForTimeout(700);
  step('las preferencias se leen del servidor', await page.locator('#prefsBody').isVisible());
  await page.selectOption('#prefLead', '15');
  await page.waitForTimeout(900);
  step('la antelacion se guarda de verdad', prefs.lead_minutes === 15, 'lead=' + prefs.lead_minutes);
  await page.locator('#prefQuiet').click();
  await page.waitForTimeout(900);
  step('apagar el silencio nocturno se guarda', prefs.quiet_enabled === false);
  step('al apagarlo se esconde la franja', !(await page.locator('#prefQuietHours').isVisible()));
  await page.locator('#prefEnabled').click();
  await page.waitForTimeout(900);
  step('apagar los avisos se guarda', prefs.enabled === false);
  step('con los avisos apagados el resto se atenua', (await page.locator('#prefsBody.is-off').count()) === 1);
  await page.locator('#prefsClose').click();
  await page.waitForTimeout(300);
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(300);

  /* ── Voz ───────────────────────────────────────────────────────────────── */
  await page.locator('.nav button[data-view="mente"]').click();
  await page.waitForTimeout(400);
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(1500);
  step('grabando, el nucleo se enciende', (await page.locator('#captureStage.listening').count()) === 1);
  step('se ve cuanto llevas grabado', /Te escucho · 0:0\d/.test(await page.locator('#voiceHint').textContent()));
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(2500);
  step('se sube audio de verdad', uploads.length === 1 && uploads[0].type.startsWith('audio/') && uploads[0].bytes > 1200, uploads[0] ? `${uploads[0].type} · ${uploads[0].bytes} bytes` : 'no se subio nada');
  step('el texto cae en el cuadro donde escribes', (await page.inputValue('#captureText')) === 'mañana a las nueve tengo dentista');
  step('el microfono se suelta al acabar', await page.evaluate(() => window.__tracks.every((t) => t.readyState === 'ended')));

  await page.fill('#captureText', '');
  voiceMode = 'nokey';
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(1100);
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(2200);
  step('sin clave se avisa en cristiano', (await page.locator('#toast').textContent()).includes('OpenAI'));

  voiceMode = 'ok';
  uploads.length = 0;
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(120);
  await page.locator('#voiceOrb').click({ force: true });
  await page.waitForTimeout(1200);
  step('un toque sin querer no sube nada', uploads.length === 0);

  /* ── Borrar de verdad (dos toques) y recuerdos que se pueden abrir ─────── */
  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(500);
  await page.locator(`#weekDay${idx} [data-week-add]`).first().click();
  await page.waitForTimeout(400);
  await page.fill('#editTitle', 'Esto lo voy a borrar');
  await page.locator('#editSave').click();
  await page.waitForTimeout(700);
  await page.locator(`#weekDay${idx} .row[data-id]`).filter({ hasText: 'Esto lo voy a borrar' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('#editDelete').click();
  await page.waitForTimeout(250);
  step('borrar pide un segundo toque', (await page.locator('#editDelete').textContent()).includes('otra vez'));
  step('y la hoja sigue abierta', await page.locator('#editSheet').evaluate((e) => e.classList.contains('show')));
  const antesDeBorrar = edits.filter((c) => c.action === 'capture_delete').length;
  step('con un solo toque no se borra nada', antesDeBorrar === 0);
  await page.locator('#editDelete').click();
  await page.waitForTimeout(800);
  step('al segundo toque se borra', edits.filter((c) => c.action === 'capture_delete').length === 1);
  step('y desaparece de la semana', !(await page.locator(`#weekDay${idx} .row-title`).allTextContents()).includes('Esto lo voy a borrar'));

  await page.locator('.nav button[data-view="mente"]').click();
  await page.waitForTimeout(400);
  await page.fill('#memoryQuery', 'lo de ayer');
  await page.locator('#memorySearchBtn').click();
  await page.waitForTimeout(900);
  step('la busqueda por significado devuelve algo', (await page.locator('.memory-hit').count()) > 0);
  step('un recuerdo archivado lo dice', (await page.locator('.memory-hit-archived').count()) > 0);
  await page.locator('.memory-hit').first().click();
  await page.waitForTimeout(500);
  step('tocar un recuerdo lo abre para editarlo', await page.locator('#editSheet').evaluate((e) => e.classList.contains('show')));
  await page.locator('#editCancel').click();
  await page.waitForTimeout(300);

  /* ── Sin red: lo que sueltas no se pierde ──────────────────────────────── */
  await page.fill('#captureText', '');
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(400);
  /* El aviso de "sin conexion" vive en Hoy, asi que hay que estar en Hoy para verlo. */
  await page.locator('.nav button[data-view="hoy"]').click();
  await page.waitForTimeout(400);
  step('sin red se avisa antes de que lo notes', await page.locator('#offlineBanner').isVisible());
  await page.locator('.nav button[data-view="mente"]').click();
  await page.waitForTimeout(400);
  await page.fill('#captureText', 'Sin red pero lo suelto igual');
  await page.locator('#captureSend').click();
  await page.waitForTimeout(700);
  step('lo capturado sin red se guarda aqui', (await page.locator('#mindRecent .row-title').allTextContents()).includes('Sin red pero lo suelto igual'));
  step('y se ve que esta pendiente de sincronizar', (await page.locator('#mindRecent .row.pending-sync').count()) > 0);
  step('la cuenta de pendientes sube', (await page.locator('#queueState').textContent()) === '1');
  const guardadoLocal = await page.evaluate(() => JSON.parse(localStorage.getItem('sm_pending_captures_v3') || '[]').length);
  step('sobrevive a cerrar la app', guardadoLocal === 1, `en localStorage: ${guardadoLocal}`);

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  step('al volver la red se sincroniza sola', (await page.locator('#queueState').textContent()) === '0');
  step('y deja de estar marcada como pendiente', (await page.locator('#mindRecent .row.pending-sync').count()) === 0);

  /* ── Dinero en formato español ─────────────────────────────────────────── */
  const dinero = await page.evaluate(() => euro(1234.56));
  step('el dinero se escribe como en España', dinero.replace(/ /g, ' ') === '1.234,56 €', dinero);

  /* ── Dinero: en euros y como se escriben en España ─────────────────────── */
  await page.locator('.nav button[data-view="dinero"]').click();
  await page.waitForTimeout(900);
  const saldo = (await page.locator('#moneyNet').textContent()).replace(/\u00a0/g, ' ');
  step('el saldo sale con separador de miles', saldo === '12.345,67 €', saldo);
  step('y dice de donde sale ese numero', (await page.locator('#moneyCaption').textContent()).includes('bancario'));
  step('el banco conectado se nota', (await page.locator('#bankNoteText').textContent()).includes('Cajamar'));
  const cifras = await page.locator('#moneyIn, #moneyOut, #moneyReceivable, #moneyPayable').allTextContents();
  step('ninguna cifra se queda en blanco', cifras.every((t) => /\d/.test(t)), cifras.join(' | '));

  await page.locator('.nav button[data-view="hoy"]').click();
  await page.waitForTimeout(700);
  const pulso = await page.locator('#todayPulse .pulse-tile').nth(1).textContent();
  step('Hoy y Dinero cuentan el mes igual', pulso.includes('banco') && /\d/.test(pulso), pulso.replace(/\s+/g, ' ').trim());

  /* ── Dinero: en que se va, y poder cambiarlo ───────────────────────────── */
  await page.locator('.nav button[data-view="dinero"]').click();
  await page.waitForTimeout(1500);
  const cats = page.locator('#moneyCats .money-cat');
  step('Dinero reparte el gasto por categorias', (await cats.count()) >= 4, `${await cats.count()} categorias`);
  const primera = (await cats.first().innerText()).replace(/\s+/g, ' ');
  step('la categoria mayor va primero y dice cuanto', /Alimentación/.test(primera) && /€/.test(primera), primera);
  step('y que porcentaje representa', /%/.test(primera) && /mov\./.test(primera), primera);
  step('se compara con el mes anterior', (await page.locator('#moneyCats .money-delta').count()) >= 3);
  step('y lo resume en una linea legible', /llevas/.test(await page.locator('#moneyInsight').innerText()));
  step('las posibles suscripciones no se llaman confirmadas', /Posible suscripción mensual/.test(await page.locator('#moneySubs').innerText()));

  await cats.first().click();
  await page.waitForTimeout(700);
  step('tocar una categoria abre sus movimientos', (await page.locator('#moneySheet.show').count()) === 1);
  step('y solo salen los de esa categoria', (await page.locator('#moneyTx .money-tx-row').count()) === 2, `${await page.locator('#moneyTx .money-tx-row').count()} filas`);

  await page.locator('#moneyTx .money-tx-row').first().click();
  await page.waitForTimeout(500);
  step('tocar un movimiento ofrece cambiarlo de categoria', (await page.locator('#moneyPicker:not([hidden]) .money-chip').count()) >= 10);
  await page.locator('#moneyPicker .money-chip', { hasText: 'Ocio' }).first().click();
  await page.waitForTimeout(700);
  const cambio = moneyActions.filter((a) => a.action === 'set_category');
  step('el cambio se guarda de verdad', cambio.length === 1 && cambio[0].category === 'Ocio', JSON.stringify(cambio[0] || {}));
  step('y pregunta si siempre, sin modal encima', (await page.locator('#moneyLearn:not([hidden])').count()) === 1);

  await page.locator('#moneyLearnYes').click();
  await page.waitForTimeout(900);
  const aprendido = moneyActions.filter((a) => a.action === 'set_category' && a.learn === true);
  step('decir que si crea la regla aprendida', aprendido.length === 1, JSON.stringify(aprendido[0] || {}));
  step('y la hoja deja de preguntar', (await page.locator('#moneyLearn:not([hidden])').count()) === 0);

  await page.locator('#moneySheetClose').click();
  await page.waitForTimeout(500);
  await page.locator('#moneyCats .money-cat', { hasText: 'Transporte' }).first().click();
  await page.waitForTimeout(700);
  step('un gasto ya apuntado a mano se marca como tal', (await page.locator('#moneyTx .money-tag').count()) === 1);
  await page.locator('#moneySheetClose').click();
  await page.waitForTimeout(400);

  const subBtn = page.locator('#moneySubs .money-sub-btn').first();
  await subBtn.click();
  await page.waitForTimeout(500);
  step('una suscripcion se puede confirmar', moneyActions.some((a) => a.action === 'subscription' && a.status === 'confirmed'));

  /* ── Gym: la rutina y el cuerpo se pintan ──────────────────────────────── */
  await page.locator('.nav button[data-view="gym"]').click();
  await page.waitForTimeout(1400);
  step('Gym abre con la rutina', (await page.locator('#gym.active').count()) === 1);
  step('el historial de entrenos se ve', (await page.locator('.gym-history-card, .gym-empty').count()) > 0);
  const cuerpo = page.locator('[data-gym-tab="body"]');
  if (await cuerpo.count()) {
    await cuerpo.click();
    await page.waitForTimeout(1200);
    step('el panel del cuerpo se dibuja', (await page.locator('#gym svg').count()) > 0);
  }

  /* ── Rutina semanal: configurarla en Gym y verla en Semana ─────────────── */
  await page.locator('.nav button[data-view="gym"]').click();
  await page.waitForTimeout(1200);
  const tabRutina = page.locator('[data-gym-tab="routine"]');
  if (await tabRutina.count()) {
    await tabRutina.click();
    await page.waitForTimeout(700);
  }
  step('Gym trae el selector de rutina semanal', (await page.locator('.gym-week-pick').count()) === 7);
  step('y dice cuantos dias entrenas', (await page.locator('#gymWeekNote').textContent()).includes('a la semana'));

  /* Se toca un dia que la rutina de ejemplo deja libre, para no pisar los tres que
     sostienen las comprobaciones de programado / pendiente / realizado. */
  const libreWd = (hoyWd + 3) % 7;
  await page.selectOption(`.gym-week-pick[data-weekday="${libreWd}"]`, 'gd2');
  await page.waitForTimeout(900);
  const enviado = gymActions.filter((a) => a.action === 'set_schedule').at(-1);
  step('elegir entrenamiento manda set_schedule', !!enviado && enviado.weekday === libreWd && enviado.dayId === 'gd2', JSON.stringify(enviado));
  step('y el selector se queda con lo elegido', (await page.inputValue(`.gym-week-pick[data-weekday="${libreWd}"]`)) === 'gd2');
  await page.selectOption(`.gym-week-pick[data-weekday="${libreWd}"]`, '');
  await page.waitForTimeout(900);
  step('volver a descanso tambien se guarda', gymActions.filter((a) => a.action === 'set_schedule').at(-1).dayId === null);

  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(900);
  const hoyIdx = (new Date().getDay() + 6) % 7;
  const ayerIdx = (hoyIdx + 6) % 7;
  const anteayerIdx = (hoyIdx + 5) % 7;
  const textoDe = async (i) => (await page.locator(`#weekDay${i} .rows`).textContent()).replace(/\s+/g, ' ').trim();

  step('el entreno de hoy sale como programado', (await page.locator(`#weekDay${hoyIdx} .week-plan-row.is-programado`).count()) === 1, await textoDe(hoyIdx));
  step('y dice que te toca entrenar', (await textoDe(hoyIdx)).includes('Entrenar'));
  if (ayerIdx < hoyIdx) {
    step('lo que tocaba ayer y no hiciste queda pendiente', (await page.locator(`#weekDay${ayerIdx} .week-plan-row.is-pendiente`).count()) === 1, await textoDe(ayerIdx));
  }
  if (anteayerIdx < hoyIdx) {
    step('lo que si entrenaste sale como realizado', (await page.locator(`#weekDay${anteayerIdx} .week-gym-row.is-realizado`).count()) === 1, await textoDe(anteayerIdx));
    step('y se nota que era el que tocaba', (await textoDe(anteayerIdx)).includes('era el de hoy'));
  }
  const descansos = await page.locator('.week-rest').count();
  step('los dias sin entreno salen como descanso', descansos >= 1, `${descansos} dias`);

  /* Tocar el entreno programado tiene que abrir Gym en ese dia, no en Gym a secas. */
  await page.locator(`#weekDay${hoyIdx} .week-plan-row.is-programado`).click();
  await page.waitForTimeout(1600);
  step('tocarlo abre Gym', (await page.locator('#gym.active').count()) === 1);
  step('y se posa en el dia que tocaba', (await page.locator('.gym-day[data-day-id="gd1"].is-target').count()) === 1);

  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(600);

  /* ── iPhone: zonas tactiles y ancho ────────────────────────────────────── */
  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(500);
  const pequenos = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#semana button, #semana [role="button"], #dinero button, #moneySheet button, #editSheet button, #prefsSheet button, #prefsSheet select, .nav button')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 44 || r.width < 44) bad.push(`${el.id || el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
  step('todo lo tocable llega a 44px', pequenos.length === 0, pequenos.join(' | '));
  step('sin scroll horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  step('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));

  if (shotDir) {
    for (const view of ['hoy', 'mente', 'semana', 'dinero', 'gym', 'archivo']) {
      await page.locator(`.nav button[data-view="${view}"]`).click();
      await page.waitForTimeout(900);
      await shot(view);
    }
  }

  await browser.close();
  server.close();
  return fails;
}

let total = 0;
for (const width of [390, 320]) {
  console.log(`\n${width} px`);
  const fails = await run(width);
  total += fails.length;
}
if (total) {
  console.error(`\naudit de interfaz FALLA · ${total} comprobaciones`);
  process.exit(1);
}
console.log('\naudit de interfaz ok · 390 y 320 px');
