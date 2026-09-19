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
  let voiceMode = 'ok';

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
      if (body.action === 'capture_update') {
        const c = captures.find((x) => x.id === body.id);
        Object.assign(c, { title: body.title ?? c.title, kind: body.kind ?? c.kind, due_at: body.dueAt === undefined ? c.due_at : body.dueAt });
        return route.fulfill({ json: { ok: true, capture: c } });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (url.includes('gym-progress')) return route.fulfill({ json: { ok: true, rows: [] } });
    if (/\/gym(\?|$)/.test(url))
      return route.fulfill({ json: { ok: true, routine: { id: 'r1', name: 'Mi rutina' }, days: [], exercises: [], activeSession: null, activeSets: [], recentSets: [], bests: [], body: [], stats: {}, history: [{ id: 'h1', day_id: 'd1', day_name_snapshot: 'Torso', started_at: day(-1, 18), finished_at: day(-1, 19), set_count: 18, volume_kg: 5400 }] } });
    if (url.includes('mind-config')) return route.fulfill({ json: { ok: true, aiConfigured: true } });
    if (url.includes('bank-config')) return route.fulfill({ json: { ok: true, configured: false } });
    if (url.includes('/bank')) return route.fulfill({ json: { ok: true, connected: false, accounts: [], transactions: [] } });
    if (url.includes('/mind')) return route.fulfill({ json: { ok: true, captures, aiEnabled: true } });
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

  await page.locator(`#weekDay${idx} .row[data-id]`).first().click();
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
  await page.locator(`#weekDay${idx + 1} .row[data-id]`).first().click();
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

  /* ── iPhone: zonas tactiles y ancho ────────────────────────────────────── */
  await page.locator('.nav button[data-view="semana"]').click();
  await page.waitForTimeout(500);
  const pequenos = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#semana button, #semana [role="button"], #editSheet button, #prefsSheet button, #prefsSheet select, .nav button')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 44 || r.width < 44) bad.push(`${el.id || el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
  step('todo lo tocable llega a 44px', pequenos.length === 0, pequenos.join(' | '));
  step('sin scroll horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  step('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));

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
