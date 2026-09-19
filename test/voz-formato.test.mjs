/* El contrato de formatos entre el micrófono y OpenAI.

   Es el punto donde la voz se rompe en silencio: el navegador graba en el formato
   que le da la gana, el backend le pone un nombre de fichero, y OpenAI valida la
   extensión ANTES de mirar el contenido. Si la extensión no está en su lista, el
   audio se rechaza aunque sea perfecto, y el usuario sólo ve "no pude transcribirlo".

   Esto cruza las tres piezas —lo que MediaRecorder puede llegar a decir, lo que el
   cliente manda y lo que el backend traduce— para que no haya que descubrirlo
   grabando. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* Lista que acepta el endpoint de transcripción de OpenAI. */
const OPENAI = new Set(['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']);

/* Lo que devuelven de verdad los MediaRecorder que nos importan, con y sin codecs.
   iOS Safari es el caso que manda: es un PWA de iPhone. */
const REALES = [
  'audio/mp4', // iOS Safari (AAC en MP4) y Safari de escritorio
  'audio/mp4;codecs=mp4a.40.2', // iOS Safari, forma larga
  'audio/mp4; codecs="mp4a.40.2"', // con espacio y comillas, como lo escriben algunos
  'audio/mp4;codecs=opus', // Chromium reciente
  'audio/webm;codecs=opus', // Chrome, Edge
  'audio/webm', // Chrome sin codecs
  'audio/ogg;codecs=opus', // Firefox
  'audio/ogg', // Firefox sin codecs
  'audio/wav', // grabadores antiguos
  'audio/aac', // algún Android
  'audio/mpeg',
  'AUDIO/MP4', // las cabeceras no distinguen mayusculas
];

const edge = read('supabase/functions/voice/index.ts');

/* Se leen del código real, no se copian: si alguien cambia el mapa, esto lo ve. */
const EXT = Object.fromEntries(
  [...edge.slice(edge.indexOf('const EXT'), edge.indexOf('const sql')).matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const POR_DEFECTO = edge.match(/EXT\[type\]\s*\|\|\s*"([a-z0-9]+)"/)[1];

/* El mismo recorte que hace la funcion con la cabecera. */
const normalizar = (t) => t.split(';')[0].trim().toLowerCase();

test('el mapa de formatos no esta vacio ni se ha quedado a medias', () => {
  assert.ok(Object.keys(EXT).length >= 10, `solo se leyeron ${Object.keys(EXT).length} formatos del codigo`);
  assert.ok(OPENAI.has(POR_DEFECTO), `el formato por defecto "${POR_DEFECTO}" no lo acepta OpenAI`);
});

test('todo lo que puede grabar un navegador acaba en una extension que OpenAI acepta', () => {
  for (const mime of REALES) {
    const tipo = normalizar(mime);
    const ext = EXT[tipo] || POR_DEFECTO;
    assert.ok(OPENAI.has(ext), `"${mime}" acabaria como .${ext}, que OpenAI rechaza`);
  }
});

test('lo que graba un iPhone acaba en m4a, que es lo que espera OpenAI de un MP4 de audio', () => {
  for (const mime of ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4; codecs="mp4a.40.2"', 'AUDIO/MP4']) {
    assert.equal(EXT[normalizar(mime)], 'm4a', `${mime} deberia ir a m4a`);
  }
});

test('ninguna entrada del mapa apunta a una extension que OpenAI rechace', () => {
  for (const [mime, ext] of Object.entries(EXT)) {
    assert.ok(OPENAI.has(ext), `el mapa manda "${mime}" a .${ext}, que no esta en la lista de OpenAI`);
  }
});

test('la funcion acepta cualquier audio y nada que no lo sea', () => {
  /* El filtro es `startsWith("audio/")` sobre el tipo ya recortado. */
  assert.ok(/type\.startsWith\("audio\/"\)/.test(edge), 'el filtro de tipo ha cambiado de forma');
  for (const mime of REALES) assert.ok(normalizar(mime).startsWith('audio/'), `${mime} no pasaria el filtro`);
  for (const malo of ['application/json', 'text/plain', 'video/mp4', '']) {
    assert.ok(!normalizar(malo).startsWith('audio/'), `${malo} no deberia pasar el filtro`);
  }
});

test('el cliente pide los formatos en el orden que sirve en un iPhone', () => {
  const cliente = read('voice-capture.js');
  const bloque = cliente.match(/for \(const t of \[([^\]]+)\]/);
  assert.ok(bloque, 'no encuentro la lista de formatos candidatos en voice-capture.js');
  const lista = bloque[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));

  assert.equal(lista[0], 'audio/mp4', 'mp4 tiene que ir primero: es el unico que Safari sabe grabar');
  assert.ok(lista.some((t) => t.startsWith('audio/webm')), 'webm tiene que estar para Chrome y Firefox');
  /* Cada candidato del cliente tiene que ser uno que el backend sepa traducir. */
  for (const t of lista) {
    const ext = EXT[normalizar(t)] || POR_DEFECTO;
    assert.ok(OPENAI.has(ext), `el cliente podria grabar "${t}" y acabaria como .${ext}`);
  }
});

test('el cliente manda el audio con su tipo real y nunca vacio', () => {
  const cliente = read('voice-capture.js');
  assert.ok(/'Content-Type': blob\.type \|\| 'audio\/mp4'/.test(cliente),
    'la cabecera tiene que llevar el tipo del blob, con mp4 de reserva si viene vacio');
  assert.ok(/body: blob/.test(cliente), 'el audio va en crudo, sin base64 ni multipart');
});
