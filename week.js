/* Vista Semana. Faltaba por completo: la app podia decir que tienes hoy, pero no
   que tienes esta semana, que es justo lo que hace falta para organizarse.

   Se auto-instala igual que el modulo de Gym (crea su vista y su boton de nav) para
   no tocar app.js, y reutiliza `row()` y `bindRows()` de app.js: asi una tarea se ve
   y se comporta igual en Hoy, en Semana y en Archivo, que es la diferencia entre un
   producto y varios modulos pegados.

   Fuentes reales: capturas con `due_at` (planes, tareas, recordatorios) y el
   historial de entrenamientos del modulo de Gym. Nada inventado: un dia sin datos
   se dibuja vacio, no relleno. */
(function () {
  if (typeof state === 'undefined' || typeof row !== 'function') return;

  const DAY = 86400000;
  const LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const longDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long' });
  const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
  const w$ = (id) => document.getElementById(id);

  /* Lunes como primer dia: es lo que espera alguien en España. */
  function weekStart(d = new Date()) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  let offset = 0; // semanas respecto a la actual

  function days() {
    const start = weekStart();
    start.setDate(start.getDate() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY));
  }

  /* Que cae en cada dia: planes y tareas con fecha, mas entrenos terminados. */
  function contentFor(day) {
    const captures = (state.captures || [])
      .filter((c) => !c.archived_at && c.due_at)
      .filter((c) => sameDay(new Date(c.due_at), day))
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const sessions = (typeof gymState !== 'undefined' ? gymState.data?.history || [] : [])
      .filter((h) => h.started_at && sameDay(new Date(h.started_at), day));
    return { captures, sessions };
  }

  function sessionRow(h) {
    const vol = Number(h.volume_kg) || 0;
    const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(h.started_at));
    return `<div class="row week-gym-row" data-week-gym="1" role="button" tabindex="0" aria-label="Ver este entreno en Gym">
      <div class="row-icon gym"><svg viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg></div>
      <div class="row-copy"><div class="row-title">${esc(h.day_name_snapshot || 'Entreno')}</div>
      <div class="row-sub">${esc(time)} · ${Number(h.set_count) || 0} series</div></div>
      <div class="row-side">${vol ? esc(new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(vol)) + ' kg' : 'Gym'}</div>
    </div>`;
  }

  function render() {
    const view = w$('semana');
    if (!view) return;
    const list = days();
    const today = new Date();
    const counts = list.map((d) => {
      const { captures, sessions } = contentFor(d);
      return captures.length + sessions.length;
    });
    const total = counts.reduce((a, b) => a + b, 0);
    const first = list[0];
    const last = list[6];
    const rangeLabel =
      offset === 0 ? 'Esta semana' : offset === 1 ? 'La semana que viene' : offset === -1 ? 'La semana pasada' : `${dayMonth.format(first)} – ${dayMonth.format(last)}`;

    w$('weekRange').textContent = rangeLabel;
    w$('weekSub').textContent = total
      ? `${total} ${total === 1 ? 'cosa' : 'cosas'} entre el ${first.getDate()} y el ${last.getDate()}`
      : 'Nada apuntado en estos siete días';

    w$('weekStrip').innerHTML = list
      .map((d, i) => {
        const isToday = sameDay(d, today);
        const dots = Math.min(counts[i], 3);
        return `<button class="week-chip${isToday ? ' is-today' : ''}${counts[i] ? '' : ' is-empty'}" data-week-day="${i}" aria-label="${longDay.format(d)} ${d.getDate()}">
          <span class="week-chip-letter">${LETTER[d.getDay()]}</span>
          <span class="week-chip-num">${d.getDate()}</span>
          <span class="week-chip-dots">${'<i></i>'.repeat(dots)}</span>
        </button>`;
      })
      .join('');

    w$('weekDays').innerHTML = list
      .map((d, i) => {
        const { captures, sessions } = contentFor(d);
        const isToday = sameDay(d, today);
        const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const body =
          captures.length || sessions.length
            ? sessions.map(sessionRow).join('') + captures.map((c) => row(c, { archive: false })).join('')
            : `<button class="week-empty press" data-week-add="${i}">${past ? 'Sin nada registrado' : 'Libre'}<i>+</i></button>`;
        return `<section class="week-day${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}" id="weekDay${i}">
          <header class="week-day-head">
            <h3>${longDay.format(d)}<span>${d.getDate()}</span></h3>
            <div class="week-day-tools">
              ${isToday ? '<em>Hoy</em>' : ''}
              ${isToday ? `<button class="week-day-btn press" data-week-train="1" aria-label="Entrenar hoy"><svg viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg></button>` : ''}
              <button class="week-day-btn press" data-week-add="${i}" aria-label="Añadir algo el ${d.getDate()}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </header>
          <div class="rows">${body}</div>
        </section>`;
      })
      .join('');

    bindRows();
    view.querySelectorAll('[data-week-day]').forEach((b) => {
      b.onclick = () => {
        const el = w$('weekDay' + b.dataset.weekDay);
        if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      };
    });
  }

  function install() {
    if (w$('semana')) return;
    const app = document.querySelector('.app');
    const view = document.createElement('main');
    view.id = 'semana';
    view.className = 'view week-view';
    view.innerHTML = `
      <div class="page-head"><h1>Tu semana,<br>de un vistazo.</h1><p>Lo que tienes cerrado, lo que queda libre y lo que ya has hecho.</p></div>
      <div class="week-head">
        <div><div class="week-range" id="weekRange">Esta semana</div><div class="week-sub" id="weekSub"></div></div>
        <div class="week-nav">
          <button class="week-arrow press" data-week-move="-1" aria-label="Semana anterior"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
          <button class="week-arrow press" data-week-move="0" aria-label="Volver a esta semana"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg></button>
          <button class="week-arrow press" data-week-move="1" aria-label="Semana siguiente"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
      </div>
      <div class="week-strip" id="weekStrip"></div>
      <div class="week-days" id="weekDays"></div>`;
    app.insertBefore(view, document.getElementById('mente'));

    const nav = document.querySelector('.nav');
    const button = document.createElement('button');
    button.dataset.view = 'semana';
    button.innerHTML = `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M8 14h3"/></svg><span>Semana</span>`;
    nav.insertBefore(button, nav.querySelector('[data-view="mente"]'));
    button.onclick = () => {
      go('semana');
      /* El historial de gym vive en su propio modulo: lo pedimos si no esta cargado. */
      if (typeof loadGym === 'function' && typeof gymState !== 'undefined' && !gymState.data) loadGym({ quiet: true }).then(render).catch(() => {});
      render();
    };

    /* Todo lo que se toca en Semana pasa por aqui. Delegado, porque el contenido se
       vuelve a pintar entero en cada cambio y los oyentes uno a uno se perderian. */
    view.addEventListener('click', (e) => {
      const move = e.target.closest('[data-week-move]');
      if (move) {
        const v = Number(move.dataset.weekMove);
        offset = v === 0 ? 0 : offset + v;
        render();
        return;
      }
      const add = e.target.closest('[data-week-add]');
      if (add) {
        const day = days()[Number(add.dataset.weekAdd)];
        /* Al crear algo en un dia que no es hoy, la semana se queda donde estas. */
        if (typeof openCaptureCreator === 'function') openCaptureCreator(day);
        return;
      }
      if (e.target.closest('[data-week-train]') || e.target.closest('[data-week-gym]')) {
        if (document.getElementById('gym')) go('gym');
        else toast('El módulo de gym aún no ha cargado');
        return;
      }
      /* La casilla de completar ya la lleva `bindRows()`; abrir el editor encima
         convertiria un gesto de un toque en dos. */
      if (e.target.closest('[data-complete]')) return;
      const item = e.target.closest('.week-day .row[data-id]');
      if (item && typeof openCaptureEditor === 'function') openCaptureEditor(item.dataset.id);
    });

    /* Mismo gesto con teclado para las filas que no son botones de verdad. */
    view.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const gym = e.target.closest?.('[data-week-gym]');
      if (gym) {
        e.preventDefault();
        if (document.getElementById('gym')) go('gym');
      }
    });

    /* Cuando app.js vuelve a pintar tras guardar o sincronizar, la semana se entera. */
    const baseRender = window.render;
    if (typeof baseRender === 'function') {
      window.render = function () {
        const out = baseRender.apply(this, arguments);
        if (document.getElementById('semana')?.classList.contains('active')) render();
        return out;
      };
    }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
