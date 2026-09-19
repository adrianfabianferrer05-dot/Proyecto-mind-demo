/* La hoja de edición directa: una sola para cambiar algo que ya existe y para
   crear una tarea o un plan desde cero con la fecha ya puesta.

   Aquí no interpreta nadie nada. En `mente` escribes en tu idioma y el intérprete
   decide; aquí los campos los has decidido tú, así que va a `mind-edit`, que no
   tiene modelo ni ambigüedad. Son dos caminos distintos porque son dos cosas
   distintas, no dos copias del mismo parser.

   Completar y archivar siguen siendo `complete()` y `archiveItem()` de app.js: desde
   Semana, desde Hoy o desde Archivo es literalmente la misma operación, con la misma
   marcha atrás si falla la red. */
(function () {
  if (typeof state === 'undefined' || typeof editApi !== 'function') return;

  const AGENDA = [['task', 'Tarea'], ['event', 'Plan'], ['note', 'Nota'], ['idea', 'Idea']];
  const MONEY = { expense: 'Gasto', income: 'Ingreso', debt: 'Pendiente' };
  const u$ = (id) => document.getElementById(id);

  let editing = null; // captura en edición; null cuando se está creando
  let chosen = 'task';
  let armed = false; // borrar pedido una vez, esperando la confirmación
  let disarmTimer = null;

  function disarmDelete() {
    clearTimeout(disarmTimer);
    armed = false;
    const b = u$('editDelete');
    if (!b) return;
    b.classList.remove('is-armed');
    b.textContent = 'Borrar';
  }

  /* Las 9:00 son la hora por defecto de cualquier día. Sólo se mueve cuando el día
     elegido es hoy y las nueve ya han pasado: entonces la siguiente hora en punto,
     porque nadie quiere un aviso que nace caducado. Si el día es pasado se respeta,
     que apuntar algo de ayer es tan legítimo como apuntar algo de mañana —el aviso
     sencillamente no se encola, de eso ya se encarga el backend. */
  function defaultFor(day) {
    const now = new Date();
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
    if (d.toDateString() !== now.toDateString() || d > now) return d;
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    /* A última hora de la noche la siguiente en punto ya sería mañana: ahí vale más
       "ahora" que mandarte sin avisar al día siguiente. */
    return next.toDateString() === now.toDateString() ? next : now;
  }

  function renderKinds() {
    const box = u$('editKinds');
    if (!box) return;
    const list = AGENDA.slice();
    /* Si lo que editas es dinero, su tipo se enseña y se puede mantener; el importe
       se cambia por "Corregir", que es quien sabe de importes. */
    if (MONEY[chosen]) list.push([chosen, MONEY[chosen]]);
    box.innerHTML = list
      .map(([k, label]) => `<button type="button" class="edit-kind press${k === chosen ? ' is-on' : ''}" data-kind="${k}" aria-pressed="${k === chosen}">${label}</button>`)
      .join('');
    u$('editMoneyNote').hidden = !MONEY[chosen];
  }

  function fill({ capture, day }) {
    editing = capture || null;
    chosen = capture ? capture.kind : 'task';
    u$('editHead').textContent = capture ? 'Editar' : 'Añadir';
    u$('editTitle').value = capture ? capture.title || capture.raw_text || '' : '';
    u$('editDue').value = capture
      ? toLocalInput(capture.due_at)
      : toLocalInput(defaultFor(day || new Date()).toISOString());
    renderKinds();

    const isTask = chosen === 'task' && !!capture;
    u$('editDoneRow').hidden = !isTask;
    setDone(!!capture?.completed_at);
    u$('editRemove').hidden = !capture;
    disarmDelete();
    u$('editSave').textContent = capture ? 'Guardar' : 'Añadir';
  }

  function setDone(on) {
    const b = u$('editDone');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function open(opts) {
    fill(opts);
    const sheet = u$('editSheet');
    sheet.classList.add('show');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    setTimeout(() => u$('editTitle').focus({ preventScroll: true }), 260);
  }

  function close() {
    const sheet = u$('editSheet');
    sheet.classList.remove('show');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    disarmDelete();
    editing = null;
  }

  async function save() {
    const title = u$('editTitle').value.trim();
    if (!title) return toast('Ponle un nombre');
    const dueAt = fromLocalInput(u$('editDue').value);
    const btn = u$('editSave');
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Guardando…';
    try {
      const out = editing
        ? await editApi('capture_update', { id: editing.id, title, kind: chosen, dueAt })
        : await editApi('capture_create', { title, kind: chosen, dueAt });
      mergeCapture(out.capture);
      render();
      close();
      toast(editing ? 'Guardado' : 'Añadido');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  }

  function install() {
    if (u$('editSheet')) return;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'editSheet';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="editHead">
      <div class="grabber"></div>
      <h2 class="sheet-title" id="editHead">Editar</h2>
      <label class="edit-label" for="editTitle">Qué es</label>
      <input class="edit-input" id="editTitle" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="Llamar al taller">
      <div class="edit-label">Tipo</div>
      <div class="edit-kinds" id="editKinds" role="group" aria-label="Tipo"></div>
      <p class="edit-note" id="editMoneyNote" hidden>El importe se cambia desde “Corregir”, contándolo con tus palabras.</p>
      <label class="edit-label" for="editDue">Cuándo</label>
      <input class="edit-input" id="editDue" type="datetime-local">
      <div class="edit-quick">
        <button type="button" class="edit-chip press" data-quick="today">Hoy</button>
        <button type="button" class="edit-chip press" data-quick="tomorrow">Mañana</button>
        <button type="button" class="edit-chip press" data-quick="next">+1 día</button>
        <button type="button" class="edit-chip press" data-quick="clear">Sin fecha</button>
      </div>
      <div class="edit-row" id="editDoneRow" hidden>
        <div class="setting-copy"><span>Completada</span><em>Se guarda al momento</em></div>
        <button type="button" class="edit-toggle press" id="editDone" role="switch" aria-checked="false" aria-label="Completada"><i></i></button>
      </div>
      <div class="edit-actions">
        <button type="button" class="cancel press" id="editCancel">Cancelar</button>
        <button type="button" class="save press" id="editSave">Guardar</button>
      </div>
      <div class="edit-remove" id="editRemove">
        <button type="button" class="edit-archive press" id="editArchive">Archivar</button>
        <button type="button" class="edit-delete press" id="editDelete">Borrar</button>
      </div>
      <button type="button" class="sheet-close press" id="editClose">Cerrar</button>
    </div>`;
    document.body.appendChild(sheet);

    u$('editKinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      chosen = b.dataset.kind;
      renderKinds();
      u$('editDoneRow').hidden = !(chosen === 'task' && editing);
    });

    sheet.querySelector('.edit-quick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick]');
      if (!b) return;
      const field = u$('editDue');
      if (b.dataset.quick === 'clear') return void (field.value = '');
      const base = field.value ? new Date(field.value) : new Date();
      const d = new Date();
      if (b.dataset.quick === 'today') d.setTime(defaultFor(new Date()).getTime());
      else if (b.dataset.quick === 'tomorrow') {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        d.setTime(new Date(t.getFullYear(), t.getMonth(), t.getDate(), 9, 0, 0, 0).getTime());
      } else {
        /* "+1 día" mueve lo que ya hay, conservando la hora: es justo lo que quieres
           cuando algo se te ha ido de las manos y lo empujas al día siguiente. */
        d.setTime(base.getTime());
        d.setDate(d.getDate() + 1);
      }
      field.value = toLocalInput(d.toISOString());
    });

    u$('editDone').onclick = () => {
      if (!editing) return;
      const next = !editing.completed_at;
      setDone(next);
      complete(editing.id);
    };
    u$('editDelete').onclick = async () => {
    if (!editing) return;
    /* Borrar no tiene vuelta atras, asi que pide un segundo toque en vez de una
       ventana de confirmacion que se acepta sin leer. */
    if (!armed) {
      armed = true;
      const b = u$('editDelete');
      b.classList.add('is-armed');
      b.textContent = 'Toca otra vez para borrarlo';
      disarmTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    const id = editing.id;
    disarmDelete();
    try {
      await editApi('capture_delete', { id });
      dropCapture(id);
      render();
      close();
      toast('Borrado');
    } catch (e) {
      toast(e.message);
    }
  };
  u$('editArchive').onclick = () => {
      if (!editing) return;
      archiveItem(editing.id);
      close();
    };
    u$('editSave').onclick = save;
    u$('editCancel').onclick = close;
    u$('editClose').onclick = close;
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) close();
    });
    u$('editTitle').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheet.classList.contains('show')) close();
    });
  }

  /* Puertas de entrada para el resto de la app. */
  window.openCaptureEditor = (target) => {
    /* Admite un id (lo normal) o el registro entero: un recuerdo archivado ya no
       esta en la lista de la app, y aun asi se tiene que poder abrir y borrar. */
    const c = typeof target === 'string' ? state.captures.find((x) => x.id === target) : target;
    if (!c) return;
    if (c.metadata?.pending) return toast('Esto aún no se ha sincronizado');
    open({ capture: c });
  };
  window.openCaptureCreator = (day) => open({ day: day instanceof Date ? day : new Date() });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
