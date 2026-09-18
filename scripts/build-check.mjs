/* "Build" de un sitio estatico: no hay nada que compilar, asi que lo que hay que
   verificar es que el HTML, el service worker y el manifest esten de acuerdo entre
   si. Justo esta clase de desajuste fue lo que hizo que una version nueva se viera
   igual que la vieja en el iPhone: el SW seguia sirviendo assets cacheados con una
   version que ya no coincidia. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const errors = [];
const note = [];

const html = read('index.html');
const sw = read('sw.js');

/* Todo lo que index.html referencia tiene que existir. */
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map((m) => m[1]);
const clean = (p) => p.replace(/^\.\//, '').split('?')[0];
for (const r of new Set(refs)) {
  if (!existsSync(join(ROOT, clean(r)))) errors.push(`index.html referencia ${r}, que no existe`);
}

/* El precache del SW tiene que existir y coincidir en version con el HTML. */
const assetsDecl = sw.match(/const ASSETS\s*=\s*\[([^\]]+)\]/);
if (!assetsDecl) errors.push('sw.js no declara una lista ASSETS de precache');
const assets = assetsDecl
  ? [...assetsDecl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((a) => a !== './')
  : [];
const htmlVersions = new Map();
for (const r of refs) {
  const [file, q] = r.split('?');
  htmlVersions.set(clean(file), q || null);
}
for (const a of assets) {
  const [file, q] = a.split('?');
  const f = clean(file);
  if (f !== 'index.html' && !existsSync(join(ROOT, f))) {
    errors.push(`sw.js precachea ${a}, que no existe`);
    continue;
  }
  if (htmlVersions.has(f)) {
    const want = htmlVersions.get(f);
    if ((q || null) !== want)
      errors.push(`desajuste de version en ${f}: index.html pide "${want}" y sw.js cachea "${q}"`);
  }
}

/* Ficheros que el cliente carga en cadena (no aparecen en index.html) tambien
   deben estar precacheados, o la app no arranca sin red. */
const chained = [...read('gym-weights.js').matchAll(/load\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
for (const c of chained) {
  const f = clean(c);
  if (!existsSync(join(ROOT, f))) errors.push(`gym-weights.js carga ${c}, que no existe`);
  if (!assets.some((a) => clean(a) === f)) errors.push(`${f} se carga en cadena pero sw.js no lo precachea`);
  const inSw = assets.find((a) => clean(a) === f);
  if (inSw && inSw.split('?')[1] !== c.split('?')[1])
    errors.push(`desajuste de version en ${f}: gym-weights.js pide "${c.split('?')[1]}" y sw.js cachea "${inSw.split('?')[1]}"`);
}

/* El manifest tiene que ser JSON valido y sus iconos existir. */
try {
  const man = JSON.parse(read('manifest.webmanifest'));
  for (const icon of man.icons || []) {
    if (!/^https?:/.test(icon.src) && !existsSync(join(ROOT, clean(icon.src))))
      errors.push(`manifest.webmanifest apunta a ${icon.src}, que no existe`);
  }
  if (man.display !== 'standalone') note.push(`manifest.display es "${man.display}" (standalone da apariencia nativa)`);
} catch (e) {
  errors.push(`manifest.webmanifest no es JSON valido: ${e.message}`);
}

/* El SW debe subir de version cuando cambia el precache, o nadie recibe lo nuevo. */
if (!/const CACHE\s*=\s*'[^']+'/.test(sw)) errors.push('sw.js no declara un nombre de cache versionado');

if (note.length) console.log('avisos:\n' + note.map((n) => '  · ' + n).join('\n'));
if (errors.length) {
  console.error('BUILD FALLA:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`build ok · ${refs.length} referencias y ${assets.length} assets precacheados verificados`);
