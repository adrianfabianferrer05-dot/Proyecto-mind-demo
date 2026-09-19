/* Dinero, por categorías.

   Se instala solo dentro de la vista Dinero, como el resto de módulos: se cuelga de
   `render` en vez de tocarlo, para que app.js no tenga que saber que esto existe.

   Lo que se enseña son dos preguntas y sus respuestas: en qué se va el dinero, y si
   este mes va distinto del anterior. Nada de paneles de empresa. Cada categoría es
   una fila tocable; dentro están sus movimientos; y cada movimiento se puede cambiar
   de categoría en dos toques, que es lo único que hace que un clasificador
   automático sirva de algo a largo plazo. */
(function () {
  'use strict';
  const MONEY_URL = 'https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/money';
  const TOKEN = 'sm_device_token';

  const el = (id) => document.getElementById(id);
  const money = (n) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, useGrouping: 'always' })
      .format(Number(n) || 0);
  const limpio = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombreMes = (m) => { const [y, n] = String(m).split('-').map(Number); return `${MESES[(n || 1) - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
  const mesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const diaCorto = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

  const estado = { mes: mesDe(new Date()), datos: null, categorias: [], cargando: false, pedidoIA: false, abierta: null };

  async function moneyApi(action, extra = {}) {
    const t = localStorage.getItem(TOKEN) || '';
    if (!t) throw new Error('no_session');
    const r = await fetch(MONEY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out.ok === false) throw new Error(out.detail || out.error || 'money_failed');
    return out;
  }

  /* ─── Armazón ─────────────────────────────────────────────────────────── */
  function instalar() {
    const vista = el('dinero');
    if (!vista || el('moneyCats')) return;
    const movimientos = vista.querySelector('.section');
    const seccion = document.createElement('section');
    seccion.className = 'section money-cats-section';
    seccion.innerHTML = `
      <div class="section-head">
        <h2>En qué se va</h2>
        <div class="money-month">
          <button class="money-month-btn press" id="moneyPrev" aria-label="Mes anterior">‹</button>
          <span id="moneyMonthLabel">—</span>
          <button class="money-month-btn press" id="moneyNext" aria-label="Mes siguiente">›</button>
        </div>
      </div>
      <div id="moneyInsight" class="money-insight"></div>
      <div id="moneyCats" class="money-cats"></div>
      <div id="moneySubs" class="money-subs"></div>`;
    if (movimientos) vista.insertBefore(seccion, movimientos);
    else vista.appendChild(seccion);

    el('moneyPrev').onclick = () => mover(-1);
    el('moneyNext').onclick = () => mover(1);
    seccion.addEventListener('click', (e) => {
      const fila = e.target.closest('[data-cat]');
      if (fila) return abrirCategoria(fila.dataset.cat);
      const sub = e.target.closest('[data-sub]');
      if (sub) return marcarSuscripcion(sub.dataset.sub, sub.dataset.estado);
    });
    hoja();
  }

  function mover(delta) {
    const [y, m] = estado.mes.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const siguiente = d.toISOString().slice(0, 7);
    if (siguiente > mesDe(new Date())) return; // el futuro no tiene gastos
    estado.mes = siguiente;
    cargar();
  }

  /* ─── Datos ───────────────────────────────────────────────────────────── */
  async function cargar({ conIA = false } = {}) {
    if (estado.cargando || !localStorage.getItem(TOKEN)) return;
    estado.cargando = true;
    pintar();
    try {
      estado.datos = await moneyApi('summary', { month: estado.mes });
      if (!estado.categorias.length) estado.categorias = (await moneyApi('categories')).categories || [];
      pintar();
      /* Si queda algo sin clasificar, se le pide al modelo una sola vez por sesión.
         Las reglas ya han corrido en el servidor; esto es solo para la cola larga. */
      if (conIA !== false && !estado.pedidoIA && estado.datos.sin_clasificar > 0) {
        estado.pedidoIA = true;
        moneyApi('classify').then(() => cargar({ conIA: false })).catch(() => {});
      }
    } catch (e) {
      if (String(e.message) !== 'no_session') pintar(e);
    } finally {
      estado.cargando = false;
      pintar();
    }
  }

  /* ─── Pintado ─────────────────────────────────────────────────────────── */
  function lineaInsight(d) {
    if (!d) return '';
    const lineas = [];
    const top = (d.categorias || []).filter((c) => c.gastado > 0).slice(0, 3);
    if (top.length) lineas.push(`Este mes llevas ${money(d.total_gastado)} · sobre todo en ${top.map((c) => c.categoria.toLowerCase()).join(', ')}.`);
    if (d.gastado_mes_anterior > 0) {
      const dif = d.diferencia_total;
      lineas.push(Math.abs(dif) < 1
        ? `Prácticamente igual que en ${nombreMes(d.mes_anterior)}.`
        : `${dif > 0 ? 'Son' : 'Son'} ${money(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'} que en ${nombreMes(d.mes_anterior)}.`);
    }
    if (d.sin_clasificar > 0) lineas.push(`${d.sin_clasificar} movimiento${d.sin_clasificar === 1 ? '' : 's'} sin clasificar.`);
    return lineas.map((l) => `<p>${limpio(l)}</p>`).join('');
  }

  function filaCategoria(c, maximo) {
    const ancho = maximo > 0 ? Math.max(2, Math.round((c.gastado / maximo) * 100)) : 0;
    const dif = c.diferencia;
    const chip = c.anterior === 0 && c.gastado === 0 ? ''
      : Math.abs(dif) < 1 ? '<i class="money-delta igual">igual</i>'
      : `<i class="money-delta ${dif > 0 ? 'sube' : 'baja'}">${dif > 0 ? '+' : '−'}${money(Math.abs(dif))}</i>`;
    return `<button class="money-cat press" data-cat="${limpio(c.categoria)}">
      <div class="money-cat-top"><span class="money-cat-name">${limpio(c.categoria)}</span><b>${money(c.gastado)}</b></div>
      <div class="money-cat-bar"><i style="width:${ancho}%"></i></div>
      <div class="money-cat-foot"><span>${c.porcentaje}% · ${c.movimientos} mov.</span>${chip}</div>
    </button>`;
  }

  function pintar(error) {
    const cats = el('moneyCats');
    if (!cats) return;
    el('moneyMonthLabel').textContent = nombreMes(estado.mes);
    el('moneyNext').disabled = estado.mes >= mesDe(new Date());
    const d = estado.datos;
    el('moneyInsight').innerHTML = error
      ? '<p>No pude traer las categorías ahora mismo.</p>'
      : estado.cargando && !d ? '<p>Ordenando los movimientos…</p>' : lineaInsight(d);

    if (!d) { cats.innerHTML = estado.cargando ? '<div class="skeleton"></div><div class="skeleton"></div>' : ''; return; }
    const gastos = (d.categorias || []).filter((c) => c.gastado > 0);
    const maximo = gastos.length ? gastos[0].gastado : 0;
    cats.innerHTML = gastos.length
      ? gastos.map((c) => filaCategoria(c, maximo)).join('')
      : '<div class="empty"><strong>Sin gastos este mes.</strong>Cuando Cajamar traiga movimientos aparecerán repartidos aquí.</div>';

    const subs = (d.suscripciones || []).filter((s) => s.status !== 'ignored');
    el('moneySubs').innerHTML = subs.length
      ? `<div class="money-subs-head">Cargos que se repiten</div>` + subs.map((s) => `
        <div class="money-sub">
          <div class="money-sub-copy"><b>${limpio(s.comercio)}</b><span>${s.status === 'confirmed' ? 'Suscripción' : 'Posible suscripción mensual'} · ${money(s.amount)} · ${s.months} meses</span></div>
          ${s.status === 'confirmed' ? '' : `<button class="money-sub-btn press" data-sub="${limpio(s.comercio)}" data-estado="confirmed">Sí</button>`}
          <button class="money-sub-btn press" data-sub="${limpio(s.comercio)}" data-estado="ignored">${s.status === 'confirmed' ? 'Quitar' : 'No'}</button>
        </div>`).join('')
      : '';
  }

  async function marcarSuscripcion(comercio, status) {
    try {
      await moneyApi('subscription', { merchant: comercio, status });
      estado.datos.suscripciones = estado.datos.suscripciones.map((s) => (s.comercio === comercio ? { ...s, status } : s));
      pintar();
    } catch { if (window.toast) window.toast('No pude guardarlo'); }
  }

  /* ─── Hoja de movimientos ─────────────────────────────────────────────── */
  function hoja() {
    if (el('moneySheet')) return;
    const h = document.createElement('div');
    h.id = 'moneySheet';
    h.className = 'sheet';
    h.setAttribute('aria-hidden', 'true');
    /* Mismo armazón que las otras hojas de la app (`sheet-panel`, `grabber`,
       `sheet-close`): así hereda la animación de cajón y se siente igual. */
    h.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="moneySheetTitle">
      <div class="grabber"></div>
      <h2 class="sheet-title" id="moneySheetTitle">Categoría</h2>
      <div class="money-sheet-sub" id="moneySheetSub"></div>
      <div class="money-tx" id="moneyTx"></div>
      <div class="money-learn" id="moneyLearn" hidden></div>
      <div class="money-picker" id="moneyPicker" hidden></div>
      <button type="button" class="sheet-close press" id="moneySheetClose">Cerrar</button>
    </div>`;
    document.body.appendChild(h);
    el('moneySheetClose').onclick = cerrar;
    h.onclick = (e) => { if (e.target === h) cerrar(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && h.classList.contains('show')) cerrar(); });
    el('moneyTx').addEventListener('click', (e) => {
      const fila = e.target.closest('[data-tx]');
      if (fila) abrirSelector(fila.dataset.tx, fila.dataset.merchant || '');
    });
  }

  function cerrar() {
    const h = el('moneySheet');
    h.classList.remove('show');
    h.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    el('moneyPicker').hidden = true;
    el('moneyLearn').hidden = true;
    estado.abierta = null;
  }

  async function abrirCategoria(categoria) {
    estado.abierta = categoria;
    const h = el('moneySheet');
    el('moneySheetTitle').textContent = categoria;
    el('moneyTx').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    el('moneySheetSub').textContent = nombreMes(estado.mes);
    el('moneyPicker').hidden = true;
    el('moneyLearn').hidden = true;
    h.classList.add('show');
    h.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    try {
      const out = await moneyApi('transactions', { category: categoria, month: estado.mes });
      pintarMovimientos(out.transactions || []);
    } catch { el('moneyTx').innerHTML = '<div class="empty">No pude traer los movimientos.</div>'; }
  }

  function pintarMovimientos(lista) {
    el('moneyTx').innerHTML = lista.length
      ? lista.map((t) => {
          const importe = Number(t.amount);
          const fecha = t.booked_at ? diaCorto.format(new Date(t.booked_at)) : '';
          const marca = t.reconciled_capture_id ? '<i class="money-tag">ya apuntado</i>' : '';
          return `<button class="money-tx-row press" data-tx="${limpio(t.id)}" data-merchant="${limpio(t.merchant_normalized || '')}">
            <div class="money-tx-copy"><b>${limpio(t.merchant_normalized || t.description || 'Movimiento')}</b><span>${limpio(fecha)}${marca}</span></div>
            <div class="money-tx-amount ${importe < 0 ? 'negative' : 'positive'}">${importe < 0 ? '−' : '+'}${money(Math.abs(importe))}</div>
          </button>`;
        }).join('')
      : '<div class="empty">Nada en esta categoría este mes.</div>';
  }

  /* Cambiar de categoría: una rejilla de botones grandes, sin menús anidados. */
  function abrirSelector(id, comercio) {
    const p = el('moneyPicker');
    el('moneyLearn').hidden = true;
    p.innerHTML = `<div class="money-picker-head">${limpio(comercio || 'Este movimiento')} va a…</div>
      <div class="money-picker-grid">${estado.categorias
        .filter((c) => c !== 'Sin clasificar')
        .map((c) => `<button class="money-chip press" data-set="${limpio(c)}">${limpio(c)}</button>`)
        .join('')}</div>`;
    p.hidden = false;
    p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    p.querySelectorAll('[data-set]').forEach((b) => {
      b.onclick = () => aplicar(id, b.dataset.set, comercio);
    });
  }

  async function aplicar(id, categoria, comercio) {
    el('moneyPicker').hidden = true;
    try {
      await moneyApi('set_category', { id, category: categoria });
      if (window.toast) window.toast(`Ahora es ${categoria}`);
      /* Y aquí la pregunta discreta: una línea, dos botones, sin modal encima. */
      if (comercio) {
        const l = el('moneyLearn');
        l.innerHTML = `<span>¿Todo lo de ${limpio(comercio)} a ${limpio(categoria)}?</span>
          <button class="money-learn-btn press" id="moneyLearnYes">Sí</button>
          <button class="money-learn-btn press" id="moneyLearnNo">Ahora no</button>`;
        l.hidden = false;
        el('moneyLearnNo').onclick = () => { l.hidden = true; refrescar(); };
        el('moneyLearnYes').onclick = async () => {
          l.hidden = true;
          try {
            const out = await moneyApi('set_category', { id, category: categoria, learn: true });
            if (window.toast) window.toast(out.also_updated ? `Hecho · ${out.also_updated} movimiento${out.also_updated === 1 ? '' : 's'} más` : 'Lo recordaré');
          } catch { if (window.toast) window.toast('No pude guardar la regla'); }
          refrescar();
        };
      } else refrescar();
    } catch { if (window.toast) window.toast('No pude cambiar la categoría'); }
  }

  async function refrescar() {
    await cargar({ conIA: false });
    if (estado.abierta) {
      try {
        const out = await moneyApi('transactions', { category: estado.abierta, month: estado.mes });
        pintarMovimientos(out.transactions || []);
      } catch {}
    }
  }

  /* ─── Enganche ────────────────────────────────────────────────────────── */
  const base = window.render;
  if (typeof base === 'function') {
    window.render = function () {
      const out = base.apply(this, arguments);
      instalar();
      return out;
    };
  }
  document.addEventListener('DOMContentLoaded', instalar);
  instalar();
  /* La primera carga espera un poco: el token y la vista ya están, pero no tiene
     sentido competir con la carga de capturas por el mismo segundo. */
  setTimeout(() => cargar(), 900);
  window.moneyReload = () => cargar({ conIA: false });
})();
