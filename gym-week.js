/* Qué entrenamiento toca cada día de la semana.

   Se configura aquí, dentro de Gym, porque aquí viven la rutina y sus días. Semana
   sólo lo lee: si la asignación se guardara en los dos sitios acabarían discrepando
   sobre qué tocaba el martes, que es exactamente el tipo de fallo que no se nota
   hasta que ya no te fías de la app.

   El descanso es una elección, no un hueco: los siete días existen siempre y un día
   sin entrenamiento significa descansar. Lo que no existe todavía —una semana recién
   estrenada, con los siete sin asignar— se distingue de "todo descanso" contando
   cuántos hay puestos, y así Semana puede invitar a configurarla en vez de enseñar
   siete descansos que nadie eligió. */
const GYM_WEEK_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const GYM_WEEK_NAME = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/* Se enseña empezando en lunes, que es como se piensa una semana en España, aunque
   por dentro el número de día sea el de JavaScript (0 = domingo). */
const GYM_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* Lo que Semana necesita saber, resuelto en un solo sitio. */
function gymScheduleMap(data) {
  return new Map((data?.schedule || []).map((s) => [Number(s.weekday), s.day_id || null]));
}
function gymScheduleIsSet(data) {
  return (data?.schedule || []).some((s) => s.day_id);
}

(function () {
  if (typeof gymState === 'undefined' || typeof gymApi !== 'function') return;
  const w$ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function rows() {
    const d = gymState.data;
    const days = d?.days || [];
    const map = gymScheduleMap(d);
    return GYM_WEEK_ORDER.map((wd) => {
      const chosen = map.get(wd) || '';
      const options = [`<option value=""${chosen ? '' : ' selected'}>Descanso</option>`]
        .concat(days.map((day) => `<option value="${esc(day.id)}"${day.id === chosen ? ' selected' : ''}>${esc(day.name)}</option>`))
        .join('');
      return `<div class="gym-week-row${chosen ? ' is-training' : ''}">
        <span class="gym-week-when"><b>${GYM_WEEK_LETTER[wd]}</b>${GYM_WEEK_NAME[wd]}</span>
        <select class="gym-week-pick" data-weekday="${wd}" aria-label="Entrenamiento del ${GYM_WEEK_NAME[wd].toLowerCase()}">${options}</select>
      </div>`;
    }).join('');
  }

  function paint() {
    const host = w$('gymWeekRows');
    if (!host) return;
    host.innerHTML = rows();
    const puestos = (gymState.data?.schedule || []).filter((s) => s.day_id).length;
    const note = w$('gymWeekNote');
    if (note)
      note.textContent = puestos
        ? `${puestos} ${puestos === 1 ? 'día' : 'días'} de entreno a la semana. Lo verás en Semana.`
        : 'Sin asignar. Elige qué toca cada día y Semana lo sabrá.';
  }

  async function choose(select) {
    const weekday = Number(select.dataset.weekday);
    const dayId = select.value || null;
    select.disabled = true;
    try {
      gymState.data = await gymApi('POST', { action: 'set_schedule', weekday, dayId });
      paint();
    } catch (e) {
      toast(e.message || 'No pude guardar la rutina semanal');
      paint();
    } finally {
      select.disabled = false;
    }
  }

  /* La sección se cuelga del panel de rutina cada vez que se repinta: `renderGym()`
     reconstruye su HTML entero, así que no vale con crearla una vez. */
  function install() {
    const d = gymState.data;
    if (!d || d.activeSession || gymState.tab !== 'routine') return;
    if (!(d.days || []).length) return; // sin días que asignar no hay nada que elegir
    const panel = document.querySelector('#gymContent .gym-panel');
    if (!panel || panel.querySelector('.gym-week')) return;

    const section = document.createElement('div');
    section.className = 'gym-section gym-week';
    section.innerHTML = `<div class="gym-section-head"><h2>Tu semana</h2></div>
      <p class="gym-week-note" id="gymWeekNote"></p>
      <div class="gym-week-rows" id="gymWeekRows"></div>`;
    const history = panel.querySelector('.gym-section:last-child');
    panel.insertBefore(section, history && history.querySelector('.gym-history') ? history : null);
    paint();
    section.addEventListener('change', (e) => {
      const pick = e.target.closest('.gym-week-pick');
      if (pick) choose(pick);
    });
  }

  /* Se engancha a `renderRoutine` y no a `renderGym` por un motivo concreto:
     `gym-nav.js` no envuelve `renderGym`, lo sustituye, así que cualquier capa
     colgada de ahí se queda sin ejecutar y no avisa. `renderRoutine` sí lo llaman
     todos, y además es el sitio correcto: esta sección es parte del panel de rutina. */
  const baseRoutine = window.renderRoutine;
  if (typeof baseRoutine === 'function') {
    window.renderRoutine = function () {
      const out = baseRoutine.apply(this, arguments);
      install();
      return out;
    };
  }
  install();

  /* Puerta de entrada desde Semana: abrir Gym en un día concreto de la rutina. */
  window.openGymDay = (dayId) => {
    const nav = document.querySelector('.nav button[data-view="gym"]');
    if (nav) nav.click();
    else if (typeof go === 'function') go('gym');
    gymState.tab = 'routine';
    if (typeof renderGym === 'function' && gymState.data) renderGym();

    const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let intentos = 0;
    /* Gym puede estar aún cargando su rutina cuando llega el toque desde Semana, así
       que se espera a que la tarjeta exista en vez de fallar en silencio. */
    const buscar = () => {
      const card = document.querySelector(`.gym-day[data-day-id="${CSS.escape(dayId)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'center' });
        card.classList.add('is-target');
        setTimeout(() => card.classList.remove('is-target'), 2400);
        return;
      }
      if (++intentos < 12) setTimeout(buscar, 250);
    };
    setTimeout(buscar, 120);
  };
})();

/* El editor estructural se mantiene en su propio fichero para que la lógica semanal
   siga siendo pequeña. Se carga aquí porque gym-week.js ya forma parte del bundle
   estable de Gym y así una PWA instalada recibe el editor sin duplicar gym.js. */
(function loadRoutineEditor(){
  if(document.querySelector('script[data-gym-routine-editor]'))return;
  const css=document.createElement('link');css.rel='stylesheet';css.href='gym-routine-editor.css?v=1';css.dataset.gymRoutineEditor='1';document.head.appendChild(css);
  const script=document.createElement('script');script.src='gym-routine-editor.js?v=1';script.dataset.gymRoutineEditor='1';document.body.appendChild(script);
})();
