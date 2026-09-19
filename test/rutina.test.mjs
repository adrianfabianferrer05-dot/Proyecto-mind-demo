/* Rutina semanal: qué entrenamiento toca cada día.

   Lo que se prueba aquí es la regla que decide lo que lees en Semana. Si se equivoca,
   la app te dice que hoy descansas cuando te tocaba pierna, o te marca como pendiente
   algo que ya hiciste. No es cosmético: es la única razón para abrir esa pantalla. */
process.env.TZ = 'Europe/Madrid';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const weekSrc = read('week.js');
const planState = new Function(
  `${weekSrc.slice(weekSrc.indexOf('function planState'), weekSrc.indexOf('/* Que cae en cada dia'))}\nreturn planState;`,
)();

const gymSrc = read('gym-week.js');
const horario = new Function(
  `${gymSrc.slice(gymSrc.indexOf('function gymScheduleMap'), gymSrc.indexOf('(function () {'))}\nreturn { gymScheduleMap, gymScheduleIsSet };`,
)();

const HOY = new Date('2026-09-19T10:00:00');
const dia = (n) => {
  const d = new Date(HOY);
  d.setDate(d.getDate() + n);
  return d;
};

test('los cuatro estados de un dia de entreno', () => {
  const base = { today: HOY, configured: true };
  assert.equal(planState({ ...base, day: HOY, assignedId: 'd1', done: false }), 'programado', 'hoy y sin hacer: te toca');
  assert.equal(planState({ ...base, day: dia(2), assignedId: 'd1', done: false }), 'programado', 'mas adelante: te toca');
  assert.equal(planState({ ...base, day: dia(-2), assignedId: 'd1', done: false }), 'pendiente', 'ya paso y no se hizo');
  assert.equal(planState({ ...base, day: dia(-2), assignedId: 'd1', done: true }), 'realizado', 'ya paso y se hizo');
  assert.equal(planState({ ...base, day: HOY, assignedId: null, done: false }), 'descanso', 'sin asignar es descanso');
});

test('entrenar un dia de descanso cuenta como realizado', () => {
  /* Si un sabado de descanso te da por entrenar, la semana tiene que reflejarlo:
     el historial manda sobre el plan, no al reves. */
  assert.equal(
    planState({ today: HOY, configured: true, day: HOY, assignedId: null, done: true }),
    'realizado',
  );
});

test('una semana sin configurar no inventa descansos', () => {
  /* Siete "descanso" que nadie eligio pareceria una rutina decidida, y no lo es. */
  assert.equal(planState({ today: HOY, configured: false, day: HOY, assignedId: null, done: false }), 'sin-rutina');
  assert.equal(planState({ today: HOY, configured: false, day: dia(-3), assignedId: null, done: false }), 'sin-rutina');
  assert.equal(
    planState({ today: HOY, configured: false, day: dia(-3), assignedId: null, done: true }),
    'realizado',
    'lo entrenado se ve aunque no haya rutina',
  );
});

test('hoy nunca se marca como pendiente', () => {
  /* El fallo clasico: comparar con la hora y no con el dia, y a las 10 de la manana
     tu entreno de las 19 ya aparece como "no lo hiciste". */
  for (const hora of [0, 8, 13, 23]) {
    const day = new Date(HOY);
    day.setHours(hora, 30, 0, 0);
    assert.equal(
      planState({ today: HOY, configured: true, day, assignedId: 'd1', done: false }),
      'programado',
      `a las ${hora}:30 todavia te toca`,
    );
  }
});

test('el horario se lee por numero de dia de JavaScript', () => {
  const data = {
    schedule: [
      { weekday: 0, day_id: null },
      { weekday: 1, day_id: 'lunes-id' },
      { weekday: 2, day_id: null },
      { weekday: 3, day_id: 'miercoles-id' },
      { weekday: 4, day_id: null },
      { weekday: 5, day_id: null },
      { weekday: 6, day_id: null },
    ],
  };
  const map = horario.gymScheduleMap(data);
  assert.equal(map.get(1), 'lunes-id');
  assert.equal(map.get(3), 'miercoles-id');
  assert.equal(map.get(0) ?? null, null, 'el domingo es 0, no 7');
  assert.equal(horario.gymScheduleIsSet(data), true);
});

test('sin datos de gym no se rompe ni se inventa nada', () => {
  for (const vacio of [null, undefined, {}, { schedule: [] }]) {
    assert.equal(horario.gymScheduleMap(vacio).size, 0);
    assert.equal(horario.gymScheduleIsSet(vacio), false);
  }
  assert.equal(horario.gymScheduleIsSet({ schedule: [{ weekday: 1, day_id: null }] }), false, 'todo a nulo es "sin configurar"');
});

test('la app y el backend se ponen de acuerdo en las acciones de gym', () => {
  /* Un nombre de accion mal escrito en el cliente no falla al compilar: falla el dia
     que lo tocas. Se cruzan las que manda la app con las que entiende la funcion. */
  const edge = read('supabase/functions/gym/index.ts');
  const acepta = new Set([...edge.matchAll(/action\s*===\s*"([a-z_]+)"/g)].map((m) => m[1]));

  const clientes = ['gym.js', 'gym-week.js', 'gym-weights-core.js', 'gym-enhance.js'];
  const manda = new Set();
  for (const f of clientes)
    for (const m of read(f).matchAll(/action\s*:\s*'([a-z_]+)'/g)) manda.add(m[1]);

  assert.ok(manda.has('set_schedule'), 'el selector semanal tiene que estar mandando set_schedule');
  for (const a of manda) assert.ok(acepta.has(a), `la app manda "${a}" y la funcion gym no lo entiende`);
});
