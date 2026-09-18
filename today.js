/* Resumen de Hoy. La home respondia "que tengo ahora" pero no daba el pulso del
   resto: cuanto llevas entrenado, como va el mes y cuanto queda pendiente. Son
   tres numeros, no un panel: la home no debe sobrecargarse.

   Se calcula con los mismos datos que ya usan las otras vistas, sin pedir nada
   nuevo al servidor, y cada tarjeta lleva a la vista que la explica. */
(function () {
  if (typeof state === 'undefined') return;
  const t$ = (id) => document.getElementById(id);
  const DAY = 86400000;

  function weekStart(d = new Date()) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  function figures() {
    const active = (state.captures || []).filter((c) => !c.archived_at);
    const now = new Date();

    /* El historial de gym vive en su modulo. Si aun no ha llegado, no se enseña
       un 0: un cero falso es peor que no decir nada. */
    const since = weekStart(now).getTime();
    const gymReady = typeof gymState !== 'undefined' && !!gymState.data;
    const sessions = gymReady
      ? (gymState.data.history || []).filter((h) => new Date(h.started_at).getTime() >= since).length
      : null;

    const money = active.filter(
      (c) => ['expense', 'income'].includes(c.kind) && c.amount != null &&
        new Date(c.created_at).getMonth() === now.getMonth() &&
        new Date(c.created_at).getFullYear() === now.getFullYear()
    );
    const net = money.reduce((s, c) => s + (c.kind === 'income' ? 1 : -1) * Number(c.amount), 0);

    const open = active.filter((c) => c.kind === 'task' && !c.completed_at);
    const overdue = open.filter((c) => c.due_at && new Date(c.due_at) < now).length;

    return { sessions, net, hasMoney: money.length > 0, open: open.length, overdue };
  }

  function render() {
    const host = t$('todayPulse');
    if (!host) return;
    const f = figures();
    const tiles = [
      {
        view: 'gym',
        label: 'Entrenos',
        value: f.sessions === null ? '—' : String(f.sessions),
        foot: f.sessions === null ? 'cargando' : 'esta semana',
        lit: f.sessions > 0,
      },
      {
        view: 'dinero',
        label: 'Este mes',
        value: f.hasMoney ? euro(f.net) : '—',
        foot: f.hasMoney ? (f.net >= 0 ? 'balance capturado' : 'balance capturado') : 'sin movimientos',
        lit: false,
        tone: f.hasMoney ? (f.net >= 0 ? 'positive' : 'negative') : '',
      },
      {
        view: 'archivo',
        label: 'Pendientes',
        value: String(f.open),
        foot: f.overdue ? `${f.overdue} con fecha pasada` : f.open ? 'sin retrasos' : 'nada abierto',
        lit: f.overdue > 0,
        tone: f.overdue ? 'warn' : '',
      },
    ];
    host.innerHTML = tiles
      .map(
        (t) => `<button class="pulse-tile${t.lit ? ' is-lit' : ''}" data-pulse-go="${t.view}">
        <span class="pulse-label">${t.label}</span>
        <b class="pulse-value ${t.tone || ''}">${esc(t.value)}</b>
        <span class="pulse-foot">${esc(t.foot)}</span>
      </button>`
      )
      .join('');
    host.querySelectorAll('[data-pulse-go]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.pulseGo;
        const nav = document.querySelector(`.nav button[data-view="${v}"]`);
        if (nav) nav.click();
        else go(v);
      };
    });
  }

  function install() {
    const focus = t$('focusBlock');
    if (!focus || t$('todayPulse')) return;
    const host = document.createElement('div');
    host.id = 'todayPulse';
    host.className = 'today-pulse';
    focus.after(host);

    const baseRender = window.render;
    if (typeof baseRender === 'function') {
      window.render = function () {
        const out = baseRender.apply(this, arguments);
        render();
        return out;
      };
    }
    render();
    /* Se pide una vez, en silencio, para que la cifra de entrenos sea real desde
       el primer momento en lugar de esperar a que el usuario entre al gym. */
    if (typeof loadGym === 'function' && typeof gymState !== 'undefined' && !gymState.data)
      loadGym({ quiet: true }).then(render).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
