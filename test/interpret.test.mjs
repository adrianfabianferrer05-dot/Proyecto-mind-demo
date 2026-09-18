/* El interprete es el corazon del producto: "hablo una cosa y decide donde va".
   Si esto se rompe, la captura entera se rompe. Fechas con `now` fijo para que
   los tests no dependan del reloj. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackParse, extractDueAt, amountFrom, normalizeAmount, KINDS } from '../supabase/functions/_shared/interpret.js';

/* Jueves 18 de septiembre de 2026, 12:00 en Madrid (10:00 UTC). */
const NOW = new Date('2026-09-18T10:00:00Z');
const parse = (s) => fallbackParse(s, NOW);

test('clasifica los ejemplos del producto', () => {
  assert.equal(parse('Me he gastado 27 euros cenando').kind, 'expense');
  assert.equal(parse('Recuérdame mañana llamar al seguro').kind, 'task');
  assert.equal(parse('Este viernes he quedado con Marcos a las 9 para cenar').kind, 'event');
  assert.equal(parse('Se me ocurre una idea para el negocio').kind, 'idea');
  assert.equal(parse('Cobrada la nómina').kind, 'income');
  assert.equal(parse('El cielo está nublado').kind, 'note');
});

test('separa deuda por cobrar de deuda por pagar, y ninguna es ingreso', () => {
  const cobrar = parse('Me deben 70€');
  assert.equal(cobrar.kind, 'debt');
  assert.equal(cobrar.debtDirection, 'receivable');
  assert.equal(cobrar.amount, 70);
  const pagar = parse('Le debo 40 a Juan');
  assert.equal(pagar.kind, 'debt');
  assert.equal(pagar.debtDirection, 'payable');
});

test('extrae importes solo cuando hay contexto de dinero', () => {
  assert.equal(parse('Gasolina 45,30€').amount, 45.3);
  assert.equal(parse('He pagado 12 de parking').amount, 12);
  /* "a las 18 50" es una hora, no 18,50 €: el bug clasico de esta app. */
  const hora = parse('Llamar al taller a las 18 50');
  assert.equal(hora.amount, null);
  assert.equal(hora.kind, 'task');
});

test('amountFrom respeta el contexto que se le pasa', () => {
  assert.equal(amountFrom('18 50', true, false), 18.5);
  assert.equal(amountFrom('18 50', true, true), null, 'con contexto horario no es dinero');
  assert.equal(amountFrom('18 50', false, false), null, 'sin contexto de dinero no es dinero');
  assert.equal(amountFrom('cuestan 1.234,56 €', true, false), 1234.56);
});

test('resuelve fechas relativas en hora de Madrid', () => {
  /* 09:00 de Madrid en septiembre es 07:00 UTC (CEST, +2). */
  assert.equal(extractDueAt('mañana a las 9', NOW), '2026-09-19T07:00:00.000Z');
  assert.equal(extractDueAt('pasado mañana a las 18:30', NOW), '2026-09-20T16:30:00.000Z');
  assert.equal(extractDueAt('hoy a las 20:00', NOW), '2026-09-18T18:00:00.000Z');
});

test('una hora que ya pasó se entiende como el dia siguiente', () => {
  /* Son las 12:00 de Madrid; "a las 9" a secas no puede ser hoy. */
  const due = new Date(extractDueAt('llamar a las 9', NOW));
  assert.ok(due.getTime() > NOW.getTime(), 'la fecha resuelta tiene que estar en el futuro');
  assert.equal(due.toISOString(), '2026-09-19T07:00:00.000Z');
});

test('entiende dias de la semana por nombre', () => {
  /* El 18/09/2026 es viernes; "el lunes" es el 21. */
  assert.equal(extractDueAt('el lunes a las 10', NOW), '2026-09-21T08:00:00.000Z');
  assert.equal(extractDueAt('el martes a las 17:30', NOW), '2026-09-22T15:30:00.000Z');
});

test('entiende fechas explicitas', () => {
  assert.equal(extractDueAt('el 24 de diciembre a las 21:00', NOW), '2026-12-24T20:00:00.000Z');
  assert.equal(extractDueAt('el 3/11 a las 8', NOW), '2026-11-03T07:00:00.000Z');
});

test('sin hora explicita no inventa una', () => {
  assert.equal(extractDueAt('mañana llamar al seguro', NOW), null);
  assert.equal(parse('Recuérdame comprar pan').dueAt, null);
});

test('siempre devuelve un tipo valido y un titulo acotado', () => {
  const largo = 'a'.repeat(400);
  const r = parse(largo);
  assert.ok(KINDS.includes(r.kind));
  assert.ok(r.title.length <= 96, `titulo de ${r.title.length} caracteres`);
});

test('no revienta con entradas degeneradas', () => {
  for (const bad of ['', '   ', '€', '0', '...', '??']) {
    const r = parse(bad);
    assert.ok(KINDS.includes(r.kind), `"${bad}" produjo ${r.kind}`);
  }
});

test('normaliza importes con separador de miles español', () => {
  /* Bug real encontrado por este test: "1.234,56 €" se guardaba como 234,56 €. */
  assert.equal(amountFrom('1.234,56 €', true, false), 1234.56);
  assert.equal(amountFrom('cuesta 2.500 €', true, false), 2500);
  assert.equal(amountFrom('999.999,99 €', true, false), 999999.99);
  assert.equal(amountFrom('1,234.56 €', true, false), 1234.56, 'tambien el formato ingles');
  assert.equal(normalizeAmount('12.34'), 12.34, 'dos decimales no son miles');
  assert.equal(normalizeAmount('1.234'), 1234, 'tres digitos tras el punto son miles');
});

test('un gasto grande no pierde los miles al guardarse', () => {
  const r = parse('He pagado 1.850,00 € de alquiler');
  assert.equal(r.kind, 'expense');
  assert.equal(r.amount, 1850);
});
