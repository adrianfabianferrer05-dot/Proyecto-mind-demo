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

/* 4. El navegador no habla con la puerta del Atajo. `capture` se autentica con el
      token del Atajo, no con el del dispositivo: si la PWA la llamara, el token
      acabaria en el cliente. La regla decia antes que esa funcion "ya no existe",
      y era falso: es la puerta canonica del Atajo desde el 17 de septiembre. */
const CLIENTE = files.filter(
  (f) => ['.js', '.html'].includes(extname(f)) && !f.includes('/supabase/functions/') && !f.includes('/api/') && !f.includes('/scripts/') && !f.includes('/test/'),
);
for (const f of CLIENTE) {
  if (/functions\/v1\/capture\b/.test(readFileSync(f, 'utf8')))
    problems.push(`${rel(f)}: el cliente no debe llamar a functions/v1/capture (es la puerta del Atajo, con otro token)`);
}

/* 5. Un parametro que puede llegar nulo necesita decir de que tipo es, pero solo
      donde Postgres no tenga de donde deducirlo. En un `insert ... values (...)` o
      en un `set columna = ...` lo deduce de la columna y no hay problema; en un
      `case when $1 is not null`, en un `coalesce($1, ...)` o en una comparacion
      suelta, no hay columna de la que tirar y responde "could not determine data
      type of parameter $N" tirando la consulta entera. Paso de verdad en la
      reconciliacion de Dinero: la rama "la captura no traia categoria" no se habia
      ejecutado nunca, asi que el fallo aparecio directamente en produccion. */
const EDGE = files.filter((f) => f.includes('/supabase/functions/') && extname(f) === '.ts');
const AMBIGUO = /\$\{[^{}]*\|\|\s*null\s*\}(?!\s*::)/g;
for (const f of EDGE) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(AMBIGUO)) {
    const antes = src.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const despues = src.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase();
    const sinContexto = /case\s+when\s*$|coalesce\(\s*$/.test(antes) || /^\s*is\s+(not\s+)?null/.test(despues);
    if (!sinContexto) continue;
    const linea = src.slice(0, m.index).split('\n').length;
    problems.push(`${rel(f)}:${linea}: parametro que puede ser null donde Postgres no puede deducir el tipo (${m[0].slice(0, 40)}): anade ::text, ::uuid o lo que toque`);
  }
}

if (problems.length) {
  console.error('LINT FALLA:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`lint ok · ${files.length} ficheros revisados`);
