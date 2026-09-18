/* El mapa ejercicio -> musculo decide que zona del cuerpo se ilumina. Si "curl
   femoral" cae en brazos, el panel entero miente. Se carga el fichero real del
   cliente y se evalua su tabla, para testear lo que de verdad se despliega. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../gym-body.js', import.meta.url), 'utf8');
const mapSrc = src.slice(src.indexOf('const MAP=['), src.indexOf('/* Returns the group split'));
const fnSrc = src.slice(src.indexOf('function muscleMix'), src.indexOf('/* ── Progress data'));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const muscleMix = new Function('norm', `${mapSrc}\n${fnSrc}\nreturn muscleMix;`)(norm);

const top = (name) => {
  const m = muscleMix(name);
  return m ? Object.entries(m).sort((a, b) => b[1] - a[1])[0][0] : null;
};

test('cada ejercicio cae en su grupo muscular', () => {
  const casos = {
    chest: ['Press banca', 'Press inclinado con mancuernas', 'Aperturas en polea', 'Fondos en paralelas', 'Flexiones'],
    back: ['Dominadas', 'Jalón al pecho', 'Remo con barra', 'Encogimientos de trapecio', 'Peso muerto', 'Pullover'],
    shoulders: ['Press militar', 'Elevaciones laterales', 'Press Arnold', 'Elevación frontal'],
    arms: ['Curl con barra', 'Curl martillo', 'Extensión de tríceps en polea', 'Press francés', 'Predicador'],
    core: ['Plancha', 'Crunch abdominal', 'Rueda abdominal', 'Elevación de piernas'],
    legs: ['Sentadilla', 'Prensa de piernas', 'Curl femoral', 'Extensión de cuádriceps', 'Gemelos de pie', 'Hip thrust'],
  };
  for (const [grupo, ejercicios] of Object.entries(casos))
    for (const e of ejercicios) assert.equal(top(e), grupo, `"${e}" deberia ir a ${grupo}`);
});

test('los nombres ambiguos se resuelven por orden, no por suerte', () => {
  /* "curl femoral" es pierna aunque lleve "curl"; "elevacion de piernas" es core
     aunque lleve "piernas"; la extension de cuadriceps no es triceps. */
  assert.equal(top('Curl femoral'), 'legs');
  assert.equal(top('Curl con barra'), 'arms');
  assert.equal(top('Elevación de piernas'), 'core');
  assert.equal(top('Extensión de cuádriceps'), 'legs');
  assert.equal(top('Extensión de tríceps'), 'arms');
});

test('cada regla reparte exactamente un ejercicio completo', () => {
  for (const e of ['Press banca', 'Dominadas', 'Peso muerto', 'Sentadilla', 'Press militar', 'Fondos']) {
    const suma = Object.values(muscleMix(e)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(suma - 1) < 1e-9, `"${e}" suma ${suma}, deberia sumar 1`);
  }
});

test('lo que no es un ejercicio no se clasifica', () => {
  for (const n of ['Movilidad de cadera con banda', 'Estiramientos', '', 'asdfgh'])
    assert.equal(muscleMix(n), null, `"${n}" no deberia mapear a ningun grupo`);
});
