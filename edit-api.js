/* Cliente de las acciones directas (`mind-edit`). Un solo sitio desde el que la
   app cambia datos a mano, para que Semana, Hoy y Ajustes no tengan cada uno su
   propia forma de hablar con el backend. */
const EDIT_URL = 'https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/mind-edit';

async function editApi(action, payload = {}) {
  const token = localStorage.getItem('sm_device_token') || '';
  if (!token) throw new Error('Este iPhone necesita volver a vincularse.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(EDIT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const out = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('La sesión de este iPhone ha caducado.');
    if (!r.ok) {
      const map = {
        title_required: 'Ponle un título.',
        invalid_date: 'Esa fecha no vale.',
        invalid_kind: 'Ese tipo no existe.',
        not_found: 'Eso ya no está.',
      };
      throw new Error(map[out.error] || out.detail || 'No pude guardar el cambio.');
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* Deja el estado local igual que el servidor sin recargarlo todo: la lista es la
   misma en Hoy, Semana y Archivo, asi que basta con sustituir la fila. */
function mergeCapture(capture) {
  if (!capture || typeof state === 'undefined') return;
  const i = state.captures.findIndex((c) => c.id === capture.id);
  if (i >= 0) state.captures[i] = { ...state.captures[i], ...capture };
  else state.captures.unshift(capture);
  if (typeof writeJSON === 'function' && typeof CACHE_KEY !== 'undefined') writeJSON(CACHE_KEY, state.captures);
}

/* <input type="datetime-local"> habla en hora local sin zona; estas dos funciones
   son el puente con el ISO que guarda el servidor. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
