/* Typecheck del backend. Las Edge Functions son TypeScript sobre Deno y hasta
   ahora nadie las comprobaba: el repo no traia configuracion de Deno, asi que ni
   siquiera se podian resolver los paquetes npm. */
import { execFileSync } from 'node:child_process';
const FUNCS = ['bank', 'bank-balance', 'bank-callback', 'bank-config', 'mind', 'mind-config', 'push'];
const cwd = new URL('../supabase/functions/', import.meta.url).pathname;

try {
  execFileSync('deno', ['--version'], { stdio: 'pipe' });
} catch {
  console.log('typecheck omitido · deno no esta instalado (en CI si se instala)');
  process.exit(0);
}

let failed = 0;
for (const f of FUNCS) {
  try {
    execFileSync('deno', ['check', '--no-lock', '--quiet', `${f}/index.ts`], { cwd, stdio: 'pipe' });
    console.log(`  ${f}: ok`);
  } catch (e) {
    failed++;
    console.error(`  ${f}: FALLA\n${(e.stderr || e.stdout || '').toString().split('\n').slice(0, 6).join('\n')}`);
  }
}
if (failed) process.exit(1);
console.log(`typecheck ok · ${FUNCS.length} edge functions`);
