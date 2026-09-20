import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const css = await readFile(new URL('app-polish.css', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

test('el pulido usa tipografia del sistema y no descarga fuentes externas', () => {
  assert.match(css, /-apple-system/);
  assert.match(css, /SF Pro Display/);
  assert.doesNotMatch(css, /fonts\.googleapis|@font-face/i);
});

test('la navegacion flotante respeta el safe area del iPhone', () => {
  assert.match(css, /\.nav\s*\{/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /backdrop-filter/);
});

test('el movimiento tiene alternativa para reduced motion', () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /animation:none!important/);
});

test('el service worker fuerza una cache nueva para el pulido', () => {
  assert.match(sw, /segunda-mente-v33/);
  assert.match(sw, /app-polish\.css\?v=7/);
});
