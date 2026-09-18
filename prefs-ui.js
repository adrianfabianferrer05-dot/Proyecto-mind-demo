/* Cuándo avisarte. Hasta ahora los avisos salían siempre que hubiera una fecha; esto
   es el mando que faltaba.

   No es una pantalla decorativa: lo que se marca aquí viaja a `notification_preferences`
   y lo aplica un trigger en la propia cola de avisos, así que vale para todo lo que
   entre en ella, venga de donde venga. Si apagas los avisos, no es que la app deje de
   enseñarlos: es que no se encolan.

   Sólo se enseña lo que existe de verdad. No hay interruptor de "gym" porque hoy
   ningún entreno genera avisos, y un interruptor que no apaga nada es mentira. */
(function () {
  if (typeof editApi !== 'function') return;

  const p$ = (id) => document.getElementById(id);
  const LEADS = [[0, 'A la hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes']];
  const HOURS = Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]);

  let prefs = null;
  let saveTimer = null;
  let loaded = false;

  const options = (list, value) =>
    list.map(([v, label]) => `<option value="${v}"${Number(v) === Number(value) ? ' selected' : ''}>${label}</option>`).join('');

  function summary() {
    const el = p$('prefsState');
    if (!el) return;
    if (!prefs) return void (el.textContent = 'Ajustar →');
    if (!prefs.enabled) return void (el.textContent = 'Apagados');
    const bits = [];
    if (prefs.lead_minutes > 0) bits.push(`${prefs.lead_minutes} min antes`);
    if (prefs.quiet_enabled) bits.push(`silencio ${String(prefs.quiet_from_hour).padStart(2, '0')}–${String(prefs.quiet_to_hour).padStart(2, '0')}`);
    el.textContent = bits.length ? bits.join(' · ') : 'Activos';
  }

  function paint() {
    if (!prefs) return;
    const toggle = (id, on) => {
      const b = p$(id);
      if (!b) return;
      b.classList.toggle('is-on', !!on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    toggle('prefEnabled', prefs.enabled);
    toggle('prefTasks', prefs.tasks);
    toggle('prefEvents', prefs.events);
    toggle('prefReminders', prefs.reminders);
    toggle('prefQuiet', prefs.quiet_enabled);
    p$('prefLead').value = String(prefs.lead_minutes ?? 0);
    p$('prefQuietFrom').value = String(prefs.quiet_from_hour ?? 23);
    p$('prefQuietTo').value = String(prefs.quiet_to_hour ?? 8);
    /* Con los avisos apagados, el resto de mandos no decide nada: se atenúan en vez
       de fingir que siguen mandando. */
    p$('prefsBody').classList.toggle('is-off', !prefs.enabled);
    p$('prefQuietHours').hidden = !prefs.quiet_enabled;
    summary();
  }

  function commit() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const note = p$('prefsSaved');
      note.textContent = 'Guardando…';
      try {
        const out = await editApi('prefs_set', {
          prefs: {
            enabled: prefs.enabled,
            tasks: prefs.tasks,
            events: prefs.events,
            reminders: prefs.reminders,
            leadMinutes: prefs.lead_minutes,
            quietEnabled: prefs.quiet_enabled,
            quietFromHour: prefs.quiet_from_hour,
            quietToHour: prefs.quiet_to_hour,
          },
        });
        prefs = out.prefs || prefs;
        paint();
        note.textContent = 'Guardado';
      } catch (e) {
        note.textContent = 'No pude guardarlo';
        toast(e.message);
      }
    }, 450);
  }

  async function load({ force = false } = {}) {
    if (loaded && !force) return prefs;
    const out = await editApi('prefs_get');
    prefs = out.prefs || { enabled: true, tasks: true, events: true, reminders: true, lead_minutes: 0, quiet_enabled: true, quiet_from_hour: 23, quiet_to_hour: 8 };
    loaded = true;
    return prefs;
  }

  async function open() {
    const sheet = p$('prefsSheet');
    sheet.classList.add('show');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    p$('prefsSaved').textContent = '';
    try {
      await load({ force: true });
      p$('prefsBody').hidden = false;
      p$('prefsLoading').hidden = true;
      paint();
    } catch (e) {
      p$('prefsLoading').hidden = false;
      p$('prefsLoading').textContent = e.message;
    }
  }

  function close() {
    const sheet = p$('prefsSheet');
    sheet.classList.remove('show');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
  }

  function install() {
    if (p$('prefsSheet')) return;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'prefsSheet';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="prefsHead">
      <div class="grabber"></div>
      <h2 class="sheet-title" id="prefsHead">Cuándo avisarte</h2>
      <div class="edit-note" id="prefsLoading">Cargando…</div>
      <div id="prefsBody" hidden>
        <div class="edit-row">
          <div class="setting-copy"><span>Avisos</span><em>Nada se encola si esto está apagado</em></div>
          <button type="button" class="edit-toggle press" id="prefEnabled" role="switch" aria-checked="true" aria-label="Avisos"><i></i></button>
        </div>
        <div class="edit-row">
          <div class="setting-copy"><span>Tareas</span><em>Lo que tienes que hacer</em></div>
          <button type="button" class="edit-toggle press" id="prefTasks" role="switch" aria-checked="true" aria-label="Avisar de tareas"><i></i></button>
        </div>
        <div class="edit-row">
          <div class="setting-copy"><span>Planes</span><em>Citas y quedadas</em></div>
          <button type="button" class="edit-toggle press" id="prefEvents" role="switch" aria-checked="true" aria-label="Avisar de planes"><i></i></button>
        </div>
        <div class="edit-row">
          <div class="setting-copy"><span>Lo demás</span><em>Notas, ideas, dinero y pendientes con fecha</em></div>
          <button type="button" class="edit-toggle press" id="prefReminders" role="switch" aria-checked="true" aria-label="Avisar del resto"><i></i></button>
        </div>
        <div class="edit-row">
          <div class="setting-copy"><span>Antelación</span><em>Cuánto antes quieres saberlo</em></div>
          <select class="edit-select" id="prefLead" aria-label="Antelación">${options(LEADS, 0)}</select>
        </div>
        <div class="edit-row">
          <div class="setting-copy"><span>Silencio nocturno</span><em>Los avisos de esa franja se corren, no se pierden</em></div>
          <button type="button" class="edit-toggle press" id="prefQuiet" role="switch" aria-checked="true" aria-label="Silencio nocturno"><i></i></button>
        </div>
        <div class="edit-row" id="prefQuietHours">
          <div class="setting-copy"><span>Franja</span><em>Hora de Madrid</em></div>
          <div class="edit-range"><select class="edit-select" id="prefQuietFrom" aria-label="Desde">${options(HOURS, 23)}</select><span>–</span><select class="edit-select" id="prefQuietTo" aria-label="Hasta">${options(HOURS, 8)}</select></div>
        </div>
        <div class="edit-note" id="prefsSaved" role="status" aria-live="polite"></div>
      </div>
      <button type="button" class="sheet-close press" id="prefsClose">Cerrar</button>
    </div>`;
    document.body.appendChild(sheet);

    const flip = (id, key) => {
      p$(id).onclick = () => {
        if (!prefs) return;
        prefs[key] = !prefs[key];
        paint();
        commit();
      };
    };
    flip('prefEnabled', 'enabled');
    flip('prefTasks', 'tasks');
    flip('prefEvents', 'events');
    flip('prefReminders', 'reminders');
    flip('prefQuiet', 'quiet_enabled');

    const pick = (id, key) => {
      p$(id).onchange = () => {
        if (!prefs) return;
        prefs[key] = Number(p$(id).value);
        paint();
        commit();
      };
    };
    pick('prefLead', 'lead_minutes');
    pick('prefQuietFrom', 'quiet_from_hour');
    pick('prefQuietTo', 'quiet_to_hour');

    p$('prefsClose').onclick = close;
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheet.classList.contains('show')) close();
    });

    const entry = p$('prefsSettings');
    if (entry) {
      entry.onclick = open;
      entry.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      };
    }
    /* El resumen del ajuste se lee sin abrir nada, pero sin bloquear el arranque. */
    setTimeout(() => load().then(summary).catch(() => {}), 2400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
