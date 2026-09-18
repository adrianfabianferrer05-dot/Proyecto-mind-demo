/* Voz. Lo que se prueba aqui es lo que decide si el boton del microfono sirve o no
   sirve en un iPhone: elegir un formato que iOS sepa grabar, y saber cuando merece
   la pena caer al dictado del navegador en vez de dejar a alguien hablando solo.

   La grabacion en si se verifica en un navegador de verdad; esto es la logica que
   puede fallar en silencio. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../voice-capture.js', import.meta.url), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));

const mimeFor = (supported) =>
  new Function('MediaRecorder', `${between('function voiceMime', 'const voiceSupported')}\nreturn voiceMime;`)(
    supported === null ? undefined : { isTypeSupported: (t) => supported.includes(t) },
  )();

const transcribeWith = ({ device = 'token-larguisimo-de-dispositivo', fetchImpl }) =>
  new Function(
    'VOICE_URL',
    'token',
    'fetch',
    `${between('async function voiceTranscribe', 'function voiceToggle')}\nreturn voiceTranscribe;`,
  )('https://ejemplo/functions/v1/voice', () => device, fetchImpl);

test('en un iPhone se graba en un formato que el iPhone sabe grabar', () => {
  /* Safari solo admite mp4/aac. Si se colase webm, MediaRecorder grabaria cero bytes
     y el boton del microfono seria decorativo. */
  assert.equal(mimeFor(['audio/mp4']), 'audio/mp4');
  assert.equal(mimeFor(['audio/webm;codecs=opus', 'audio/webm']), 'audio/webm;codecs=opus');
  assert.equal(mimeFor(['audio/mp4', 'audio/webm']), 'audio/mp4', 'mp4 primero: es el unico que vale en iOS');
  assert.equal(mimeFor([]), '', 'sin formato conocido se deja elegir al navegador');
  assert.equal(mimeFor(null), null, 'sin MediaRecorder no hay grabacion posible');
});

test('sin vincular el iPhone no se sube audio a ningun sitio', async () => {
  let llamadas = 0;
  const transcribe = transcribeWith({ device: '', fetchImpl: () => (llamadas++, Promise.resolve()) });
  await assert.rejects(() => transcribe(new Blob(['x'])), /vincularse/);
  assert.equal(llamadas, 0);
});

test('cada fallo lleva a la salida que toca', async () => {
  const casos = [
    [409, 'openai_not_connected', /OpenAI/, false],
    [413, 'audio_too_large', /trozos/, true],
    [422, 'nothing_heard', /No he entendido/, true],
    [502, 'transcription_failed', /No pude transcribirlo/, true],
  ];
  for (const [status, error, mensaje, conRespaldo] of casos) {
    const transcribe = transcribeWith({
      fetchImpl: () => Promise.resolve({ ok: false, status, json: () => Promise.resolve({ ok: false, error }) }),
    });
    const err = await transcribe(new Blob(['x'])).then(
      () => null,
      (e) => e,
    );
    assert.match(err.message, mensaje, `error ${error}`);
    /* Sin clave no tiene sentido reintentar con el dictado del navegador: no es un
       problema de audio. Con cualquier otro fallo, si. */
    assert.equal(!!err.fallback, conRespaldo, `respaldo para ${error}`);
  }
});

test('la transcripcion viaja como audio y vuelve como texto', async () => {
  let visto = null;
  const transcribe = transcribeWith({
    fetchImpl: (url, opts) => {
      visto = { url, opts };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, text: '  mañana a las nueve  ' }) });
    },
  });
  const blob = new Blob(['audio'], { type: 'audio/mp4' });
  assert.equal(await transcribe(blob), '  mañana a las nueve  '.slice(0, 4000));
  assert.equal(visto.opts.method, 'POST');
  assert.equal(visto.opts.headers['Content-Type'], 'audio/mp4', 'el tipo real del audio, no application/json');
  assert.match(visto.opts.headers.Authorization, /^Bearer /);
  assert.equal(visto.opts.body, blob, 'el audio va en crudo, sin base64 de por medio');
});

test('la clave de OpenAI no aparece por ninguna parte del cliente', () => {
  /* La regla que no se puede romper nunca: el navegador no habla con OpenAI. */
  const clientes = ['voice-capture.js', 'app.js', 'edit-api.js', 'prefs-ui.js', 'memory-ui.js', 'app-enhance.js'];
  for (const f of clientes) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/api\.openai\.com/.test(code), `${f} llama a OpenAI directamente`);
    assert.ok(!/\bsk-[A-Za-z0-9]{12}/.test(code), `${f} parece llevar una clave dentro`);
  }
});
