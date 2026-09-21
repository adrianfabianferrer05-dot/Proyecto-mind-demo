import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(f)=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
const ui=read('gym-routine-editor.js');
const loader=read('gym-week.js');
const edge=read('supabase/functions/gym-layout/index.ts');

test('el editor permite editar, mover y reordenar ejercicios y días',()=>{
  for(const action of ['edit-exercise','add-exercise','exercise-up','exercise-down','day-up','day-down'])
    assert.match(ui,new RegExp(`data-routine-action=\\"${action}\\"|a==='${action}'`),action);
  assert.match(ui,/data-routine-move=/,'cada ejercicio tiene selector de día');
  assert.match(ui,/action:'move_exercise'/,'mover usa el endpoint estructural');
  assert.match(ui,/action:'reorder_exercises'/,'orden de ejercicios se persiste');
  assert.match(ui,/action:'reorder_days'/,'orden de días se persiste');
});

test('editar un ejercicio mantiene sus campos de entrenamiento',()=>{
  for(const name of ['name','dayId','sets','rest','repMin','repMax','increment','notes'])
    assert.match(ui,new RegExp(`name=\\"${name}\\"`),name);
  assert.match(ui,/action:'save_exercise'/);
});

test('mover un ejercicio conserva el mismo ID y por tanto su historial',()=>{
  assert.match(edge,/update public\.gym_exercises set day_id=/,'mover actualiza el ejercicio existente');
  assert.doesNotMatch(edge,/move_exercise[\s\S]{0,1400}insert into public\.gym_exercises/,'mover no crea un ejercicio nuevo');
  assert.doesNotMatch(edge,/move_exercise[\s\S]{0,1400}delete from public\.gym_exercises/,'mover no borra el ejercicio original');
});

test('la estructura queda bloqueada mientras hay entrenamiento activo',()=>{
  assert.match(edge,/finished_at is null/);
  assert.match(edge,/active_session_locked/);
  assert.match(ui,/Termina el entrenamiento actual antes de cambiar la estructura de la rutina/);
});

test('reordenar valida que se envía el conjunto completo sin duplicados',()=>{
  assert.match(edge,/new Set\(ordered\)\.size!==ordered\.length/);
  assert.match(edge,/invalid_exercise_order/);
  assert.match(edge,/invalid_day_order/);
});

test('Gym carga el editor estructural desde su bundle estable',()=>{
  assert.match(loader,/gym-routine-editor\.js\?v=1/);
  assert.match(loader,/gym-routine-editor\.css\?v=1/);
});
