import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const enhance=readFileSync(new URL('../gym-enhance.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('editar ejercicios sigue disponible aunque haya un entrenamiento abierto',()=>{
  assert.doesNotMatch(enhance,/!gymState\.data\|\|gymState\.data\.activeSession\)return/);
  assert.match(enhance,/const sessionActive=!!gymState\.data\.activeSession/);
  assert.match(enhance,/sessionActive[\s\S]*data-gym-extra="edit"/);
});

test('tocar una fila de ejercicio abre el formulario incluso si falta la decoracion previa',()=>{
  assert.match(enhance,/function openRowExercise\(row\)/);
  assert.match(enhance,/querySelectorAll\('\.gym-preview-row'\)/);
  assert.match(enhance,/openExerciseSheet\(dayId,id\)/);
  assert.match(enhance,/\.gym-day\[data-day-id\] \.gym-preview-row/);
});

test('durante un entrenamiento no se permite reordenar pero si editar',()=>{
  assert.match(enhance,/if\(gymState\.data\?\.activeSession\)\{toast\('Termina el entrenamiento actual antes de cambiar el orden\.'/);
  assert.match(enhance,/gymExtra==='edit'\)openExerciseSheet\(day,id\)/);
});

test('el sheet del Gym vive en el viewport y no dentro de la vista animada de iOS',()=>{
  assert.match(enhance,/function mountGymSheetAtViewport\(\)/);
  assert.match(enhance,/document\.body\.appendChild\(sheet\)/);
  assert.match(enhance,/sheet\.dataset\.viewportPortal='1'/);
  assert.match(enhance,/typeof gymClick==='function'/);
  assert.match(enhance,/typeof gymSubmit==='function'/);
  assert.match(enhance,/typeof routineEditorClick==='function'/);
  assert.match(enhance,/typeof routineEditorSubmit==='function'/);
});

test('la PWA fuerza una cache nueva e incluye todos los ficheros del editor',()=>{
  assert.match(sw,/const CACHE='segunda-mente-v37'/);
  for(const asset of ['gym-enhance.js?v=1','gym-routine-editor.js?v=1','gym-routine-editor.css?v=1'])
    assert.ok(sw.includes(asset),asset);
});