/* Una sola puerta de captura.

   Durante un tiempo hubo dos: `/api/capture` en Vercel y la Edge Function `capture`
   en Supabase. Aunque acabaran compartiendo `interpret.js`, seguían siendo dos
   implementaciones, y las dos implementaciones de lo mismo siempre terminan
   divergiendo: una guardaba `version: 3` y la otra `version: 6`, una sabía del
   modelo y la otra no.

   Esto vigila que no vuelvan a aparecer. No prohíbe crear endpoints nuevos:
   prohíbe crear un segundo sitio que escriba capturas sin que alguien lo decida a
   conciencia y actualice esta lista. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const IGNORAR = new Set(['node_modules', '.git', 'docs', 'test', '.github']);

function ficheros(dir = ROOT, salida = []) {
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) ficheros(ruta, salida);
    else if (/\.(js|mjs|ts)$/.test(nombre)) salida.push(relative(ROOT, ruta));
  }
  return salida;
}

const todos = ficheros();
const leer = (f) => readFileSync(join(ROOT, f), 'utf8');
/* Se mira el codigo, no lo que dicen los comentarios: explicar por que algo ya no
   se usa no puede hacer fallar la comprobacion de que ya no se usa. */
const codigo = (f) =>
  leer(f)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^\s*(--|#).*$/gm, '');

test('solo tres sitios escriben capturas, y son los tres que deben', () => {
  const escritores = todos
    .filter((f) => {
      const src = codigo(f);
      return /insert\s+into\s+public\.mind_captures/i.test(src) || /rest\/v1\/mind_captures/.test(src);
    })
    .sort();

  /* mind      : lo que sueltas en la app, interpretado
     mind-edit : lo que creas a mano, con los campos ya decididos
     capture   : el Atajo del iPhone */
  assert.deepEqual(escritores, [
    'supabase/functions/capture/index.ts',
    'supabase/functions/mind-edit/index.ts',
    'supabase/functions/mind/index.ts',
  ]);
});

test('la puerta antigua de Vercel no tiene logica propia', () => {
  const proxy = codigo('api/capture.js');
  assert.ok(/functions\/v1\/capture/.test(proxy), 'tiene que reenviar a la Edge Function');
  assert.ok(!/interpret\.js/.test(proxy), 'no puede volver a interpretar por su cuenta');
  assert.ok(!/SERVICE_ROLE/.test(proxy), 'no puede volver a necesitar la service role key');
  assert.ok(!/mind_captures/.test(proxy), 'no puede volver a escribir en la base');
  assert.ok(!/fallbackParse|amountFrom|extractDueAt/.test(proxy), 'no puede traerse trozos del interprete');
});

test('la clave de servicio no aparece en ninguna parte del proyecto', () => {
  /* Bypasea RLS entera. Si vuelve a hacer falta en algun sitio, que sea una
     decision consciente y no el residuo de un endpoint que ya no se usa. */
  const usa = /(process\.env|Deno\.env\.get\()[.\s('"]*SUPABASE_SERVICE_ROLE_KEY/;
  const conClave = todos.filter((f) => usa.test(codigo(f)));
  assert.deepEqual(conClave, [], `estos ficheros la piden: ${conClave.join(', ')}`);
});

test('el interprete solo se importa desde donde toca', () => {
  const importadores = todos.filter((f) => /from\s+['"].*interpret\.js['"]/.test(codigo(f))).sort();
  assert.deepEqual(importadores, [
    'supabase/functions/capture/index.ts',
    'supabase/functions/mind/index.ts',
  ]);
});
