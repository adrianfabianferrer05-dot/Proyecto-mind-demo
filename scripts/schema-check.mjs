/* Comprueba que las migraciones del repositorio levantan el esquema que esta en
   produccion, y no uno parecido.

   Como: arranca un Postgres vacio de usar y tirar, aplica todos los ficheros de
   `supabase/migrations` en orden, saca la huella del esquema resultante y la compara
   con `supabase/schema.fingerprint.txt`, que se genero de esta misma forma y se
   verifico contra la base real (las nueve secciones coincidieron: columnas,
   constraints, indices, triggers, funciones, RLS, identidades, secuencias y
   politicas).

   Lo que esto atrapa: una migracion nueva que cambia el esquema y se olvida de
   actualizar la huella, o una baseline que deja de reproducir lo desplegado. Que es
   justo lo que habia pasado —30 migraciones aplicadas y 5 ficheros en el repo— y
   nadie se entero hasta que se miro.

   Se salta si no hay binarios de Postgres, como el typecheck se salta sin Deno. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const ESPERADA = join(ROOT, 'supabase/schema.fingerprint.txt');
const CONSULTA = readFileSync(join(ROOT, 'scripts/schema-fingerprint.sql'), 'utf8');

/* Un socket de Postgres no puede pasar de 107 caracteres contando el nombre del
   fichero, asi que el directorio tiene que ser corto. De ahi `/tmp` y no una ruta
   de trabajo: es un limite del sistema operativo, no una preferencia. El sufijo
   es el PID para que dos comprobaciones a la vez no se pisen. */
const BASE = `/tmp/smsc-${process.pid}`;

function binarios() {
  for (const dir of ['/usr/lib/postgresql', '/usr/local/pgsql']) {
    if (!existsSync(dir)) continue;
    const versiones = readdirSync(dir).sort((a, b) => Number(b) - Number(a));
    for (const v of versiones) {
      const bin = join(dir, v, 'bin');
      if (existsSync(join(bin, 'initdb')) && existsSync(join(bin, 'pg_ctl'))) return bin;
    }
  }
  return null;
}

const bin = binarios();
if (!bin) {
  console.log('comprobacion de esquema omitida · no hay Postgres instalado (en CI si se instala)');
  process.exit(0);
}

const datos = join(BASE, 'data');
const sock = join(BASE, 'sock');
const psql = (args, opts = {}) =>
  execFileSync(join(bin, 'psql'), ['-h', sock, '-p', '5433', '-U', 'postgres', ...args], { encoding: 'utf8', ...opts });

let arrancado = false;

function parar() {
  if (!arrancado) return;
  arrancado = false;
  spawnSync('su', ['postgres', '-c', `${join(bin, 'pg_ctl')} -D ${datos} -m immediate stop`], { encoding: 'utf8' });
}
/* `process.exit()` NO ejecuta el finally, asi que apagar el servidor va tambien
   colgado de la salida del proceso: uno que se quede vivo hace fallar la siguiente
   comprobacion por un motivo que no tiene nada que ver con el esquema. */
process.on('exit', () => {
  parar();
  rmSync(BASE, { recursive: true, force: true });
});

try {
  rmSync(BASE, { recursive: true, force: true });
  execFileSync('mkdir', ['-p', datos, sock]);
  /* initdb se niega a correr como root, asi que el cluster es de `postgres`. */
  const comoPostgres = process.getuid?.() === 0;
  const correr = (cmd, args) =>
    comoPostgres
      ? spawnSync('su', ['postgres', '-c', `${cmd} ${args}`], { encoding: 'utf8' })
      : spawnSync(cmd, args.split(' '), { encoding: 'utf8' });

  if (comoPostgres) {
    spawnSync('id', ['postgres'], { encoding: 'utf8' }).status === 0 || spawnSync('useradd', ['-m', 'postgres']);
    execFileSync('chown', ['-R', 'postgres', BASE]);
  }

  const init = correr(join(bin, 'initdb'), `-D ${datos} -U postgres --auth=trust`);
  if (init.status !== 0) {
    console.log(`comprobacion de esquema omitida · initdb no pudo arrancar (${(init.stderr || '').split('\n')[0]})`);
    process.exit(0);
  }
  /* Solo socket unix, sin escuchar en ningun puerto: asi dos comprobaciones
     seguidas no se pelean por el 5433 ni molestan a nada que corra en la maquina. */
  const start = correr(join(bin, 'pg_ctl'), `-D ${datos} -l ${join(BASE, 'pg.log')} -o "-p 5433 -k ${sock} -c listen_addresses=" -w start`);
  if (start.status !== 0) {
    console.log(`comprobacion de esquema omitida · el servidor no arranco (${(start.stderr || '').split('\n')[0]})`);
    process.exit(0);
  }
  arrancado = true;

  psql(['-q', '-c', 'create database verif;']);

  /* pg_net y pg_cron son de Supabase y no existen en un Postgres normal. Se anulan
     esas dos lineas: lo que se verifica es el esquema, no que Supabase traiga sus
     extensiones. El resto del fichero se aplica tal cual, sin tocar. */
  const ficheros = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  if (!ficheros.length) throw new Error('no hay migraciones que comprobar');
  for (const f of ficheros) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      .replace(/^create extension if not exists pg_net.*$/gim, '-- (sin pg_net fuera de Supabase)')
      .replace(/^create extension if not exists pg_cron.*$/gim, '-- (sin pg_cron fuera de Supabase)');
    const tmp = join(mkdtempSync(join(tmpdir(), 'sm-mig-')), f);
    writeFileSync(tmp, sql);
    try {
      psql(['-d', 'verif', '-v', 'ON_ERROR_STOP=1', '-q', '-f', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      console.error(`COMPROBACION DE ESQUEMA FALLA · ${f} no se pudo aplicar:\n${(e.stderr || e.stdout || '').toString().trim()}`);
      process.exit(1);
    }
  }

  const obtenida = psql(['-d', 'verif', '-tA', '-c', CONSULTA]).trim();

  /* `npm run schema:huella` reescribe el fichero en vez de comparar. */
  if (process.env.SM_FINGERPRINT_WRITE) {
    writeFileSync(ESPERADA, obtenida + '\n');
    console.log(`huella regenerada · ${obtenida.split('\n').length} lineas en supabase/schema.fingerprint.txt`);
    process.exit(0);
  }

  const esperada = readFileSync(ESPERADA, 'utf8').trim();

  if (obtenida === esperada) {
    const n = ficheros.length;
    console.log(`esquema ok · ${n} ${n === 1 ? 'migracion reproduce' : 'migraciones reproducen'} las ${esperada.split('\n').length} lineas de la huella`);
    process.exit(0);
  }

  const a = new Set(esperada.split('\n'));
  const b = new Set(obtenida.split('\n'));
  const faltan = [...a].filter((l) => !b.has(l));
  const sobran = [...b].filter((l) => !a.has(l));
  console.error('COMPROBACION DE ESQUEMA FALLA · lo que levantan las migraciones no es lo que dice la huella.');
  if (faltan.length) console.error(`\nfalta (${faltan.length}):\n  ` + faltan.slice(0, 25).join('\n  '));
  if (sobran.length) console.error(`\nsobra (${sobran.length}):\n  ` + sobran.slice(0, 25).join('\n  '));
  console.error('\nSi el cambio es intencionado, regenera la huella con `npm run schema:huella`.');
  process.exit(1);
} finally {
  parar();
}
