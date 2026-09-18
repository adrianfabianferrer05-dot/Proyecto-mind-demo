/* Edicion directa: el puente entre lo que se teclea y lo que se guarda.

   Se prueba contra los ficheros reales del cliente, no contra una copia: si manana
   alguien cambia `edit-api.js`, este test se entera. Lo que se vigila aqui es lo que
   de verdad rompe una agenda: que una hora local no se guarde como si fuera UTC, que
   "sin fecha" sea null y no "hoy", y que la interfaz no ofrezca preferencias que el
   backend tira a la basura. */
process.env.TZ = 'Europe/Madrid'; // la app es de una persona que vive en Madrid

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* ── edit-api.js ─────────────────────────────────────────────────────────── */

const apiSrc = read('edit-api.js');
function loadApi({ token = 'token-de-prueba-largo-suficiente', fetchImpl } = {}) {
  const store = { sm_device_token: token };
  const localStorage = { getItem: (k) => store[k] ?? null };
  const saved = [];
  const state = { captures: [] };
  const writeJSON = (k, v) => saved.push([k, v]);
  const CACHE_KEY = 'sm_capture_cache_v3';
  const factory = new Function(
    'localStorage',
    'fetch',
    'state',
    'writeJSON',
    'CACHE_KEY',
    `${apiSrc}\nreturn { editApi, mergeCapture, toLocalInput, fromLocalInput };`,
  );
  return { ...factory(localStorage, fetchImpl, state, writeJSON, CACHE_KEY), state, saved };
}

test('una hora escrita en el movil se guarda como esa misma hora', () => {
  const { toLocalInput, fromLocalInput } = loadApi();
  const escrito = '2026-09-21T17:30';
  const iso = fromLocalInput(escrito);
  /* 17:30 en Madrid en septiembre son las 15:30 UTC. Si esto sale 17:30Z, el aviso
     llega dos horas tarde, que es exactamente el fallo que nadie perdona. */
  assert.equal(iso, '2026-09-21T15:30:00.000Z');
  assert.equal(toLocalInput(iso), escrito, 'la vuelta tiene que devolver lo mismo');
});

test('"sin fecha" es null, no hoy', () => {
  const { fromLocalInput, toLocalInput } = loadApi();
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput(null), null);
  assert.equal(toLocalInput(null), '');
  assert.equal(toLocalInput('no es una fecha'), '');
});

test('sin token vinculado no se intenta siquiera la peticion', async () => {
  let llamadas = 0;
  const { editApi } = loadApi({ token: '', fetchImpl: () => (llamadas++, Promise.resolve()) });
  await assert.rejects(() => editApi('prefs_get'), /vincularse/);
  assert.equal(llamadas, 0);
});

test('el error del servidor se cuenta en cristiano', async () => {
  const casos = [
    [400, { error: 'title_required' }, /título/i],
    [400, { error: 'invalid_date' }, /fecha/i],
    [404, { error: 'not_found' }, /ya no está/i],
    [401, {}, /caducado/i],
    [500, { error: 'internal_error', detail: 'boom' }, /boom/],
  ];
  for (const [status, body, esperado] of casos) {
    const { editApi } = loadApi({
      fetchImpl: () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) }),
    });
    await assert.rejects(() => editApi('capture_update', { id: 'x' }), esperado, `status ${status}`);
  }
});

test('la accion y el token viajan donde deben', async () => {
  let visto = null;
  const { editApi } = loadApi({
    token: 'abcdefghijklmnopqrstuvwxyz123456',
    fetchImpl: (url, opts) => {
      visto = { url, opts };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });
  await editApi('capture_create', { title: 'Comprar pan' });
  assert.match(visto.url, /\/functions\/v1\/mind-edit$/);
  assert.equal(visto.opts.headers.Authorization, 'Bearer abcdefghijklmnopqrstuvwxyz123456');
  assert.deepEqual(JSON.parse(visto.opts.body), { action: 'capture_create', title: 'Comprar pan' });
});

test('guardar sustituye la fila, no la duplica', () => {
  const { mergeCapture, state, saved } = loadApi();
  state.captures.push({ id: 'a', title: 'Viejo' }, { id: 'b', title: 'Otro' });
  mergeCapture({ id: 'a', title: 'Nuevo' });
  assert.equal(state.captures.length, 2);
  assert.equal(state.captures[0].title, 'Nuevo');
  mergeCapture({ id: 'c', title: 'Recien creado' });
  assert.equal(state.captures.length, 3);
  assert.equal(state.captures[0].id, 'c', 'lo nuevo va primero');
  assert.equal(saved.at(-1)[0], 'sm_capture_cache_v3', 'y queda en cache para el modo avion');
});

/* ── edit-ui.js ──────────────────────────────────────────────────────────── */

const uiSrc = read('edit-ui.js');
const defaultFor = new Function(
  `${uiSrc.slice(uiSrc.indexOf('function defaultFor'), uiSrc.indexOf('function renderKinds'))}\nreturn defaultFor;`,
)();

test('lo que creas cae en el dia que has tocado', () => {
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();

  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const futuro = defaultFor(manana);
  assert.ok(mismoDia(futuro, manana), 'no se escapa del dia elegido');
  assert.equal(futuro.getHours(), 9, 'un dia futuro se propone a las 9:00');
  assert.equal(futuro.getMinutes(), 0);

  /* Tocar el "+" de un dia pasado es apuntar algo de ayer, no de hoy. Antes esto
     se colaba a la fecha de hoy sin decir nada. */
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 3);
  const pasado = defaultFor(ayer);
  assert.ok(mismoDia(pasado, ayer), 'un dia pasado se respeta tal cual');
  assert.equal(pasado.getHours(), 9);

  const hoy = new Date();
  const propuesta = defaultFor(hoy);
  assert.ok(mismoDia(propuesta, hoy), 'hoy no salta a manana');
  assert.ok(propuesta.getTime() >= Date.now() - 1000, 'hoy no propone una hora ya pasada');
});

/* ── week.js ─────────────────────────────────────────────────────────────── */

const weekSrc = read('week.js');
const weekStart = new Function(
  `${weekSrc.slice(weekSrc.indexOf('function weekStart'), weekSrc.indexOf('const sameDay'))}\nreturn weekStart;`,
)();

test('la semana empieza en lunes', () => {
  /* Un domingo es el caso que se rompe siempre con la semana americana: con getDay()
     crudo, el 20 de septiembre de 2026 (domingo) abriria la semana que viene. */
  for (const dia of ['2026-09-14', '2026-09-17', '2026-09-20']) {
    const inicio = weekStart(new Date(`${dia}T12:00:00`));
    assert.equal(inicio.getDay(), 1, `${dia} deberia caer en la semana que empieza en lunes`);
    assert.equal(inicio.getDate(), 14, `${dia} pertenece a la semana del 14`);
  }
});

/* ── contrato entre la interfaz de preferencias y el backend ─────────────── */

test('la app no ofrece preferencias que el backend ignora', () => {
  const prefsSrc = read('prefs-ui.js');
  const edgeSrc = read('supabase/functions/mind-edit/index.ts');

  const enviadas = prefsSrc
    .slice(prefsSrc.indexOf('prefs: {'), prefsSrc.indexOf('},\n        });'))
    .match(/^\s{12}(\w+):/gm)
    .map((m) => m.trim().replace(':', ''));
  const aceptadas = [...edgeSrc.slice(edgeSrc.indexOf('action === "prefs_set"')).matchAll(/\bp\.(\w+)/g)].map((m) => m[1]);

  assert.ok(enviadas.length >= 8, 'se esperaban todas las preferencias en el payload');
  for (const clave of enviadas)
    assert.ok(aceptadas.includes(clave), `la app manda "${clave}" y mind-edit no lo lee: seria un interruptor muerto`);
  for (const clave of new Set(aceptadas))
    assert.ok(enviadas.includes(clave), `mind-edit acepta "${clave}" y la app no lo ofrece`);
});
