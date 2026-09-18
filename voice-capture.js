/* Hablarle a la app de verdad.

   Antes esto era el dictado del navegador: en el iPhone depende de que Safari tenga
   ganas, corta a la primera pausa y no existe dentro de un PWA instalado. Ahora se
   graba con el micro (MediaRecorder), el audio se manda al backend y vuelve
   transcrito. La clave de OpenAI no toca el navegador en ningún momento.

   A partir del texto, el camino es el de siempre: cae en el mismo cuadro donde
   escribes, lo interpreta el mismo intérprete y lo confirma la misma confirmación.
   No hay una "vía de voz" paralela, que es como acaban existiendo dos apps dentro
   de una.

   El audio no se guarda: se graba, se envía y se suelta. Si algo falla —sin permiso,
   sin red, sin clave— se vuelve al dictado del navegador en vez de dejarte mudo. */
const VOICE_URL = 'https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/voice';
const VOICE_MAX_MS = 120000; // dos minutos; más que eso no es "soltar algo"
const VOICE_MIN_BYTES = 1200; // por debajo de esto no hay voz, hay un toque sin querer

let vReady = null; // null = todavía sin preguntar
let vRecorder = null;
let vStream = null;
let vChunks = [];
let vStopTimer = null;
let vTick = null;
let vStartedAt = 0;
let vBusy = false;

/* iOS sólo sabe de mp4/aac; el resto de navegadores prefieren webm/opus. Se pregunta
   en vez de suponer, que es la diferencia entre grabar y grabar cero bytes. */
function voiceMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}
const voiceSupported = () => !!navigator.mediaDevices?.getUserMedia && voiceMime() !== null;

/* Se pregunta al arrancar, no al tocar: en iOS el permiso del micrófono sólo se
   concede dentro del gesto del dedo, y si entre el toque y `getUserMedia` se cuela
   un `await` a la red, Safari da el gesto por gastado y no pregunta nada. */
async function voiceCheck() {
  const t = token();
  if (!t || !voiceSupported()) return (vReady = false);
  try {
    const r = await fetch(VOICE_URL, { method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${t}` } });
    vReady = !!(await r.json().catch(() => ({}))).ready;
  } catch {
    vReady = false;
  }
  return vReady;
}

function voiceStage(mode) {
  const stage = $('captureStage');
  stage.classList.toggle('listening', mode === 'rec');
  stage.classList.toggle('thinking', mode === 'work');
  if (mode === 'idle') {
    $('voiceHint').textContent = voiceSupported() && vReady !== false ? 'Toca el núcleo y habla' : 'Toca el núcleo para dictar';
    $('composerStatus').textContent = $('captureText').value.trim() ? 'Listo para guardar' : 'Una entrada. Sin elegir carpetas.';
  }
}

function voiceClock() {
  const s = Math.floor((Date.now() - vStartedAt) / 1000);
  $('voiceHint').textContent = `Te escucho · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · toca para parar`;
}

function voiceRelease() {
  clearTimeout(vStopTimer);
  clearInterval(vTick);
  vStopTimer = vTick = null;
  /* Soltar el micro no es opcional: si no, el iPhone deja el punto naranja encendido
     y parece que la app te sigue escuchando. Porque te seguiría escuchando. */
  vStream?.getTracks().forEach((t) => t.stop());
  vStream = null;
  vRecorder = null;
}

async function voiceStart() {
  if (!navigator.onLine) {
    toast('La transcripción necesita conexión');
    return;
  }
  try {
    vStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    /* NotAllowedError es un "no" explícito; el resto suele ser que no hay micro. */
    toast(e?.name === 'NotAllowedError' ? 'Necesito permiso para el micrófono' : 'No pude abrir el micrófono');
    if (typeof voice === 'function') voice();
    return;
  }
  const mime = voiceMime();
  try {
    vRecorder = new MediaRecorder(vStream, mime ? { mimeType: mime } : undefined);
  } catch {
    vRecorder = new MediaRecorder(vStream);
  }
  vChunks = [];
  vRecorder.ondataavailable = (e) => {
    if (e.data?.size) vChunks.push(e.data);
  };
  vRecorder.onstop = voiceFinish;
  vRecorder.start();
  vStartedAt = Date.now();
  voiceStage('rec');
  voiceClock();
  vTick = setInterval(voiceClock, 1000);
  vStopTimer = setTimeout(voiceStop, VOICE_MAX_MS);
  if ('vibrate' in navigator) navigator.vibrate?.(12);
}

function voiceStop() {
  if (vRecorder?.state === 'recording') vRecorder.stop();
}

async function voiceFinish() {
  const type = vRecorder?.mimeType || voiceMime() || 'audio/mp4';
  const blob = new Blob(vChunks, { type });
  vChunks = [];
  voiceRelease();

  if (blob.size < VOICE_MIN_BYTES) {
    voiceStage('idle');
    toast('No te he oído. Inténtalo otra vez');
    return;
  }

  voiceStage('work');
  $('voiceHint').textContent = 'Pasándolo a texto…';
  $('composerStatus').textContent = 'Transcribiendo…';
  vBusy = true;
  try {
    const text = await voiceTranscribe(blob);
    const box = $('captureText');
    box.value = box.value.trim() ? `${box.value.trim()} ${text}` : text;
    $('captureSend').disabled = !box.value.trim();
    voiceStage('idle');
    $('composerStatus').textContent = 'Te he oído así. Revísalo y suéltalo';
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
  } catch (e) {
    voiceStage('idle');
    toast(e.message);
    /* Si el backend no puede transcribir, al menos que el dictado del navegador lo
       intente: mejor un texto aproximado que un botón que no hace nada. */
    if (e.fallback && typeof voice === 'function') setTimeout(voice, 400);
  } finally {
    vBusy = false;
  }
}

async function voiceTranscribe(blob) {
  const t = token();
  if (!t) throw new Error('Este iPhone necesita volver a vincularse');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(VOICE_URL, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': blob.type || 'audio/mp4' },
      body: blob,
    });
    const out = await r.json().catch(() => ({}));
    if (r.ok && out.text) return String(out.text).slice(0, 4000);
    const map = {
      openai_not_connected: 'Conecta tu clave de OpenAI en Ajustes para transcribir',
      audio_too_large: 'Ha salido demasiado largo. Cuéntamelo en trozos',
      nothing_heard: 'No he entendido nada. Inténtalo otra vez',
      empty_audio: 'No se ha grabado nada',
    };
    const err = new Error(map[out.error] || 'No pude transcribirlo ahora');
    err.fallback = out.error !== 'openai_not_connected';
    throw err;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('La transcripción ha tardado demasiado');
      err.fallback = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function voiceToggle() {
  if (vBusy) return;
  if (vRecorder?.state === 'recording') return voiceStop();
  /* Sin MediaRecorder, o sin clave con la que transcribir, queda el dictado del
     navegador; y si tampoco, el teclado del iPhone. Siempre hay una salida.
     `vReady === null` es "aún no ha contestado": se graba igual y, si no había
     clave, la respuesta del backend nos lo dirá. */
  if (!voiceSupported() || vReady === false) {
    if (typeof voice === 'function') voice();
    else $('captureText').focus({ preventScroll: true });
    return;
  }
  voiceStart();
}

/* app.js ya ha enganchado sus manejadores al cargarse; aquí se sustituyen los dos
   que abren el micro, y sólo esos. */
(function () {
  if (typeof $ !== 'function' || !$('voiceOrb')) return;
  $('voiceOrb').onclick = voiceToggle;
  $('quickVoice').onclick = () => {
    go('mente');
    setTimeout(voiceToggle, 180);
  };
  voiceStage('idle');
  setTimeout(() => voiceCheck().then(() => voiceStage('idle')).catch(() => {}), 1400);
  /* Salir de la app con el micro abierto sería una grabación fantasma. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) voiceStop();
  });
  window.addEventListener('pagehide', voiceRelease);
})();
