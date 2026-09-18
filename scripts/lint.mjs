/* Lint para un proyecto sin bundler: no hay TypeScript que comprobar en el cliente,
   asi que lo util es comprobar lo que de verdad se rompe aqui. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['.git', 'node_modules', 'test', 'scripts']);
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => f.slice(ROOT.length);

/* 1. Todo el JS del cliente tiene que parsear. */
for (const f of files.filter((f) => extname(f) === '.js' && !f.includes('/supabase/functions/'))) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`${rel(f)}: no parsea\n${e.stderr?.toString().split('\n').slice(0, 3).join('\n')}`);
  }
}

/* 2. Ninguna clave puede acabar en el cliente. El service_role solo vale en
      funciones de servidor (api/ en Vercel, supabase/functions en Deno). */
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|service_role|SUPABASE_SERVICE_ROLE_KEY)\b/;
for (const f of files.filter((f) => ['.js', '.html', '.css'].includes(extname(f)))) {
  if (f.includes('/api/') || f.includes('/supabase/functions/')) continue;
  const hit = readFileSync(f, 'utf8').match(SECRET);
  if (hit) problems.push(`${rel(f)}: posible secreto en el cliente (${hit[0]})`);
}

/* 3. console.log olvidados (console.warn/error si son intencionados). */
for (const f of files.filter((f) => extname(f) === '.js' || extname(f) === '.ts')) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/\bconsole\.log\(/.test(l)) problems.push(`${rel(f)}:${i + 1}: console.log olvidado`);
  });
}

/* 4. Nada puede referenciar la Edge Function `capture`, que ya no existe. */
for (const f of files.filter((f) => ['.js', '.html', '.md'].includes(extname(f)))) {
  if (f.includes('/supabase/functions/')) continue;
  if (/functions\/v1\/capture\b/.test(readFileSync(f, 'utf8')))
    problems.push(`${rel(f)}: referencia a functions/v1/capture, que ya no existe`);
}

if (problems.length) {
  console.error('LINT FALLA:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`lint ok · ${files.length} ficheros revisados`);
