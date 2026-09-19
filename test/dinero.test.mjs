/* Dinero: que un movimiento del banco acabe en la categoría correcta.

   La parte de arriba prueba comportamiento de verdad —entra una descripción de
   Cajamar, sale una categoría— con descripciones reales, tal cual las manda el
   banco. La de abajo son contratos sobre el backend: cosas que no se pueden probar
   sin base de datos pero que sí se pueden exigir leyendo el código, como que una
   corrección tuya mande sobre una regla general o que al modelo no se le mande un
   número de tarjeta. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { CATEGORIAS, SIN_CLASIFICAR, normalizarComercio, clasificarPorRegla, claveComercio, tipoMovimiento } =
  await import('../supabase/functions/money/categorize.js');

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const edge = read('supabase/functions/money/index.ts');
const migracion = read('supabase/migrations/20260919183921_dinero_categorias.sql');
const cliente = read('money-ui.js');
/* Se mira el código, no los comentarios: explicar algo no puede hacer pasar un test. */
const codigo = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const TARJETA = 'OP.TARJ.COMPRA COMERCIO 415007******5805 ';
const clasifica = (descripcion, amount = -10) => {
  const normalized = normalizarComercio(descripcion, null);
  const out = clasificarPorRegla({ description: descripcion, amount, normalized });
  return out ? out.category : null;
};

/* ─── Nivel 1: reglas deterministas sobre descripciones reales ───────────── */

test('un supermercado es Alimentación, se llame como se llame', () => {
  for (const c of ['MERCADONA BARBASTRO 006297170', 'SIMPLY MERCADO 266384940', 'SUPERMERCADO MAS BARATO 340532803',
                   'SUP.ALTOARAG.BARBASTRO 2 340932896', 'BARBASTRO SUPERMERCADO 369112321', 'HIPER BARBASTRO 085763985',
                   'MZN SUPER 354152910', '7DAYS SUPERMERCADO 357057991', 'DIA 6493 354608291'])
    assert.equal(clasifica(TARJETA + c), 'Alimentación', c);
});

test('un restaurante, un bar o un kebab es Comer fuera', () => {
  for (const c of ['ZAVI KEBAB 354379562', 'LIAPIZZA TACO KEBAB 369313655', 'BAR TEATRO 085855146',
                   'MCDONALD S SALOU 322157033', 'CREPERIA DIMAS 048435770', 'ROCK AND GRILL 333602548',
                   'BAR RTE.BRASERIA 160367991', 'T CHAMPIONS BURGER GIRA 2 367566817'])
    assert.equal(clasifica(TARJETA + c), 'Comer fuera', c);
});

test('y "BAR" dentro de "BARBASTRO" no convierte la ciudad en un bar', () => {
  /* Sin `\b` esto es exactamente lo que pasaba: media provincia a Comer fuera. */
  assert.equal(clasifica(TARJETA + 'BARBASTRO SUPERMERCADO 369112321'), 'Alimentación');
  assert.equal(clasifica(TARJETA + 'MERCADONA BARBASTRO 006297170'), 'Alimentación');
});

test('Disney+, Netflix y compañía son Suscripciones', () => {
  for (const c of ['Disney Plus - Hoofddorp', 'DISNEY PLUS - AMSTERDAM', 'Netflix.com - Los Gatos',
                   'SpotifyES - Stockholm', 'APPLE.COM/BILL - ITUNES.COM', 'GOOGLE *Google One - g.co/HelpPay#',
                   'OPENAI *CHATGPT SUBSCR - +14158799686'])
    assert.equal(clasifica(TARJETA + c), 'Suscripciones', c);
});

test('la gasolina es Transporte', () => {
  for (const c of ['E.S. HERRERO, S.L 063193528', 'E.S BELLAVISTA 036150746', 'A.G.BENZINERA MONZON 297759052',
                   'E.S. SOMONTANO SOCIAL S.L 063224521'])
    assert.equal(clasifica(TARJETA + c), 'Transporte', c);
  assert.equal(clasifica(TARJETA + 'TAXI COSTA DORADA 097692545'), 'Transporte');
});

test('la nómina es Ingresos', () => {
  assert.equal(clasifica('NOMINA NOMINAS MARLEX PEOPLE ETT, S.L.U.', 1200), 'Ingresos');
});

test('un Bizum es un Bizum, aunque el importe parezca una cena', () => {
  assert.equal(clasifica('BIZUM ENVIADO : 122871718113 MOHAMED LAMINE A. 760918191548264', -18), 'Transferencias / Bizum');
  assert.equal(clasifica('BIZUM RECIBIDO : 915446571647 RUBEN DOMINGO F. P. 760915183044364', 100), 'Transferencias / Bizum');
});

test('sacar dinero del cajero es Efectivo, y no se adivina en qué se gastó después', () => {
  assert.equal(clasifica('REINTEGRO CAJERO 415007******5805 CAJAMAR CAJA RURAL 3703 C000000197', -260), 'Efectivo');
  assert.equal(clasifica('INGRESO EFECTIVO CAJERO Ingreso cajero tarj.****5805 00001977', 90), 'Efectivo');
});

test('lo que no se sabe se queda sin regla, no se inventa', () => {
  /* Estos son códigos opacos y nombres de persona: el nivel 1 tiene que decir que
     no sabe para que decida el modelo, o para que se quede sin clasificar. */
  for (const c of ['12SEP ZVYGL1FT - Barcelona', 'MMAN - Barcelona', 'ROY 340073626', 'ANTONIO 363566589'])
    assert.equal(clasifica(TARJETA + c), null, c);
});

test('toda categoría que devuelven las reglas existe en la lista', () => {
  for (const c of ['MERCADONA BARBASTRO 006297170', 'ZAVI KEBAB 354379562', 'Disney Plus - Hoofddorp',
                   'E.S BELLAVISTA 036150746', 'HOSTAL PORTO MAR 175836030', 'VODAFONE 353074826']) {
    const cat = clasifica(TARJETA + c);
    assert.ok(CATEGORIAS.includes(cat), `${c} → ${cat} no está en la lista`);
  }
});

/* ─── Normalización de comercios ─────────────────────────────────────────── */

test('el nombre del comercio se lee, y la descripción original no se toca', () => {
  const casos = [
    [TARJETA + 'MERCADONA BARBASTRO 006297170', 'Mercadona'],
    [TARJETA + 'Disney Plus - Hoofddorp', 'Disney+'],
    [TARJETA + 'SeQura - BARCELONA', 'SeQura'],
    [TARJETA + 'SumUp *Gomilandia - La Pobla de V', 'Gomilandia'],
    [TARJETA + 'Netflix.com - Los Gatos', 'Netflix'],
    [TARJETA + 'OPENAI *CHATGPT SUBSCR - +14158799686', 'OpenAI'],
    ['REINTEGRO CAJERO 415007******5805 CAJAMAR CAJA RURAL 3703 C000000197', 'Cajero'],
  ];
  for (const [desc, esperado] of casos) assert.equal(normalizarComercio(desc), esperado, desc);
});

test('del ruido bancario no queda nada: ni máscara de tarjeta ni identificadores', () => {
  for (const d of ['MERCADONA BARBASTRO 006297170', 'SUPERMERCADO MAS BARATO 340532803', 'CHAIEXOTICOS 357321991']) {
    const n = normalizarComercio(TARJETA + d);
    assert.ok(!/OP\.TARJ|COMERCIO|\*{3}|\d{6}/.test(n), `"${n}" todavía lleva ruido`);
  }
});

test('un Bizum enseña a quién, sin el identificador de la operación', () => {
  const n = normalizarComercio('BIZUM ENVIADO : 122871718113 MOHAMED LAMINE A. 760918191548264');
  assert.equal(n, 'Bizum · Mohamed Lamine A.');
  assert.ok(!/\d/.test(n), 'no debería quedar ningún número');
});

test('"SUP.ALTOARAG.BARBASTRO 2" queda en algo legible', () => {
  assert.equal(normalizarComercio(TARJETA + 'SUP.ALTOARAG.BARBASTRO 2 340932896'), 'Sup. Altoarag. Barbastro 2');
});

test('la clave de un comercio no cambia por acentos ni mayúsculas', () => {
  assert.equal(claveComercio('Nómina · Marlex'), claveComercio('NOMINA · MARLEX'));
  assert.equal(claveComercio('Crepería Dimas'), 'creperia dimas');
  assert.notEqual(claveComercio('Mercadona'), claveComercio('Lidl'));
});

test('el tipo de movimiento se reconoce por el prefijo del banco', () => {
  assert.equal(tipoMovimiento('BIZUM ENVIADO : 1 X 2'), 'bizum_enviado');
  assert.equal(tipoMovimiento('REINTEGRO CAJERO 4150'), 'cajero');
  assert.equal(tipoMovimiento('NOMINA NOMINAS X'), 'nomina');
  assert.equal(tipoMovimiento('S/ORD.TRANSFERENCIA X'), 'transferencia');
  assert.equal(tipoMovimiento(TARJETA + 'X'), 'tarjeta');
});

/* ─── Contratos del backend ──────────────────────────────────────────────── */

test('una corrección tuya manda sobre una regla general', () => {
  /* Si "creper" → Comer fuera ganara a tu corrección, la memoria no serviría de
     nada. En el código eso se ve en que la regla aprendida se consulta ANTES de
     llamar a clasificarPorRegla. */
  const fn = codigo(edge).slice(codigo(edge).indexOf('async function clasificarLocal'), codigo(edge).indexOf('async function movimientosPorClave'));
  const posAprendida = fn.indexOf('aprendidas.get(clave)');
  const posRegla = fn.indexOf('clasificarPorRegla(');
  assert.ok(posAprendida > -1 && posRegla > -1, 'faltan los dos niveles');
  assert.ok(posAprendida < posRegla, 'la regla aprendida tiene que consultarse antes que la determinista');
  assert.ok(/if \(aprendida\) \{[\s\S]*?\} else \{/.test(fn), 'la determinista solo se usa si no hay regla aprendida');
});

test('una corrección manual no la pisa ni el modelo ni otra regla', () => {
  assert.match(codigo(edge), /source <> 'manual'/, 'el modelo tiene que respetar las reglas manuales');
  assert.match(codigo(edge), /classification_source !== "manual"/, 'aplicar una regla no puede pisar correcciones una a una');
});

test('la categoría que entra siempre existe: ni el modelo ni tú podéis inventarse una', () => {
  assert.match(codigo(edge), /!set\.has\(categoria\)\) return json\(\{ ok: false, error: "invalid_category" \}/);
  assert.match(codigo(edge), /!validas\.includes\(categoria\)\) continue/);
  assert.match(codigo(edge), /enum: validas/, 'el esquema del modelo tiene que limitar las categorías');
});

test('baja confianza no se clasifica: se queda en blanco', () => {
  assert.match(codigo(edge), /confianza < CONFIANZA_MINIMA \|\| categoria === SIN_CLASIFICAR\) continue/);
  const min = Number(codigo(edge).match(/CONFIANZA_MINIMA = ([\d.]+)/)[1]);
  assert.ok(min >= 0.5 && min <= 0.9, `umbral de confianza raro: ${min}`);
});

test('al modelo solo se le manda comercio, importe y si entra o sale', () => {
  const fn = edge.slice(edge.indexOf('const lista = lote'), edge.indexOf('let out: any = null'));
  assert.match(fn, /c\.comercio/);
  assert.match(fn, /c\.importe/);
  assert.match(fn, /c\.entra/);
  /* Lo que NO puede salir de aquí. `description` lleva la máscara de la tarjeta. */
  for (const prohibido of ['description', 'raw', 'iban', 'token', 'provider_transaction_id', 'bank_account_id'])
    assert.ok(!fn.includes(prohibido), `el prompt no puede llevar ${prohibido}`);
});

test('el modelo clasifica comercios, no movimientos: una llamada vale para todos', () => {
  /* Es lo que hace que 401 movimientos cuesten dos llamadas y no 401. */
  assert.match(codigo(edge), /LOTE_IA = \d+/);
  assert.match(codigo(edge), /MAX_LOTES = \d+/, 'tiene que haber un techo de coste');
  assert.match(codigo(edge), /if \(yaConocidos\.has\(clave\)\) continue/, 'no se pregunta por lo que ya tiene regla');
  assert.match(codigo(edge), /pendientes = filas\.filter\(\(f: any\) => f\.category === null\)/, 'no se reclasifica lo ya clasificado');
});

test('la reconciliación no empareja nada dudoso', () => {
  const fn = codigo(edge).slice(codigo(edge).indexOf('async function reconciliar'), codigo(edge).indexOf('function mesValido'));
  assert.match(fn, /posibles\.length !== 1/, 'con más de un candidato no se une');
  assert.match(fn, /otros\.length/, 'y si el movimiento le encaja a más de un gasto, tampoco');
  assert.match(fn, /not in \('Transferencias \/ Bizum', 'Efectivo'\)/, 'un Bizum o un cajero no se emparejan solos');
  assert.match(fn, /interval '3 days'/, 'la ventana de fechas tiene que estar acotada');
  assert.match(fn, /abs\(abs\(t\.amount\) - g\.amount\) < 0\.005/, 'el importe tiene que coincidir exacto');
});

test('un gasto apuntado solo puede emparejarse con un movimiento, y una regla por comercio', () => {
  assert.match(migracion, /create unique index if not exists bank_transactions_reconciled_uidx/);
  assert.match(migracion, /match_value text not null unique/, 'no puede haber dos reglas para el mismo comercio');
  assert.match(migracion, /merchant_normalized text not null unique/, 'ni dos suscripciones del mismo comercio');
});

test('la migración añade, no destruye', () => {
  assert.ok(!/drop\s+(table|column)/i.test(migracion), 'no puede borrar nada');
  assert.ok(!/delete\s+from|truncate/i.test(migracion), 'no puede borrar datos');
  assert.ok(!/update\s+public\.bank_transactions/i.test(migracion), 'no puede tocar movimientos existentes');
  assert.match(migracion, /add column if not exists merchant_normalized/);
});

test('la deduplicación bancaria sigue en pie', () => {
  /* Lo que evita que una reconexión duplique el histórico. */
  const bank = codigo(read('supabase/functions/bank/index.ts'));
  assert.match(bank, /on conflict\(bank_account_id,provider_transaction_id\) do update/);
});

test('el banco se refresca en minutos, no en horas', () => {
  const bank = read('supabase/functions/bank/index.ts');
  const ms = eval(bank.match(/const FRESH_MS=([\d*e]+);/)[1]);
  assert.ok(ms >= 10 * 60e3 && ms <= 40 * 60e3, `ventana de frescura fuera de rango: ${ms} ms`);
  const app = read('app.js');
  const appMs = eval(app.match(/const BANK_FRESH_MS=([\d*e]+);/)[1]);
  assert.ok(appMs >= 10 * 60e3 && appMs <= 40 * 60e3, `la app usa una ventana rara: ${appMs} ms`);
  assert.match(app, /lastBankRefresh>BANK_FRESH_MS\)loadBank/, 'al volver a la app tiene que mirar el banco');
});

test('la comparación con el mes anterior sale de los mismos datos, no de otra cuenta', () => {
  const fn = codigo(edge).slice(codigo(edge).indexOf('async function resumen'), codigo(edge).indexOf('Deno.serve'));
  assert.match(fn, /porCategoria\(mes\)/);
  assert.match(fn, /porCategoria\(anterior\)/);
  assert.match(fn, /diferencia: Math\.round\(\(gastado - antes\)/);
  assert.match(fn, /porcentaje: totalGastado > 0/, 'el porcentaje se calcula sobre el gasto del mes');
});

test('una suscripción detectada no se llama suscripción confirmada', () => {
  assert.match(migracion, /status\s+text not null default 'possible'/);
  assert.match(cliente, /Posible suscripción mensual/);
  assert.match(codigo(edge), /having count\(distinct date_trunc\('month'/, 'hace falta verla en varios meses');
});

/* ─── Contrato entre la app y la función ─────────────────────────────────── */

test('todo lo que pide la app existe en la función, y al revés', () => {
  const pedidas = new Set([...codigo(cliente).matchAll(/moneyApi\('([a-z_]+)'/g)].map((m) => m[1]));
  const aceptadas = new Set([...codigo(edge).matchAll(/action === "([a-z_]+)"/g)].map((m) => m[1]));
  for (const a of pedidas) assert.ok(aceptadas.has(a), `la app pide "${a}" y la función no lo acepta`);
  assert.ok(pedidas.size >= 5, `solo se leyeron ${pedidas.size} acciones del cliente`);
});

test('la app no guarda ni enseña la clave de nadie', () => {
  assert.ok(!/sk-|api[_-]?key|OPENAI/i.test(codigo(cliente)), 'el cliente no puede saber nada de claves');
  assert.match(codigo(cliente), /Authorization: `Bearer \$\{t\}`/, 'usa el token del dispositivo, como el resto');
});
