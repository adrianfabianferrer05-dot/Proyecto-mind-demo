/* Dinero + resumen de Hoy.
   El banco es una fuente externa con retrasos inevitables. Las capturas manuales que
   sean posteriores a la última foto real de saldo se aplican como ajuste temporal:
   así "gasté 30 €" baja el dinero disponible al instante y deja de contarse en cuanto
   Cajamar confirma una foto de saldo más nueva. */
(function () {
  if (typeof state === 'undefined' || typeof bankApi !== 'function') return;
  let bankLastAttempt = 0;

  function bankNeedsReauth(bank) {
    const err = String(bank?.connection?.sync_error || '');
    return !!bank?.needs_reauth || err === 'reauth_required' || /session is expired/i.test(err);
  }

  function bankWatermark(bank) {
    const dates = (bank?.accounts || []).map((a) => safeDate(a.last_synced_at)).filter(Boolean);
    const balance = safeDate(bank?.connection?.balance_synced_at);
    if (balance) dates.push(balance);
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  function pendingManualMoney(bank) {
    const mark = bankWatermark(bank);
    return (state.captures || []).filter((c) => {
      if (c.archived_at || !['expense', 'income'].includes(c.kind) || c.amount == null) return false;
      const d = safeDate(c.created_at);
      return !!d && (!mark || d > mark);
    });
  }

  function applyMoneyModel() {
    const bank = state.bank;
    const connected = bank?.connection?.status === 'AUTHORIZED';
    if (!connected) return;

    const accounts = bank.accounts || [];
    const tx = bank.transactions || [];
    const pending = pendingManualMoney(bank);
    const pendingIn = pending.filter((c) => c.kind === 'income').reduce((s, c) => s + Number(c.amount || 0), 0);
    const pendingOut = pending.filter((c) => c.kind === 'expense').reduce((s, c) => s + Number(c.amount || 0), 0);
    const hasBalance = accounts.some((a) => a.available_balance != null || a.current_balance != null);
    const baseBalance = accounts.reduce((s, a) => {
      const value = a.available_balance != null ? a.available_balance : a.current_balance;
      return s + (Number(value) || 0);
    }, 0);
    const effectiveBalance = baseBalance + pendingIn - pendingOut;

    const now = new Date(), month = now.getMonth(), year = now.getFullYear();
    const monthBank = tx.filter((t) => {
      const d = safeDate(t.booked_at);
      return d && d.getMonth() === month && d.getFullYear() === year;
    });
    const bankIn = monthBank.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const bankOut = Math.abs(monthBank.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0));
    const effectiveIn = bankIn + pendingIn;
    const effectiveOut = bankOut + pendingOut;
    const estimated = pending.length > 0;
    const needsReauth = bankNeedsReauth(bank);

    state.money = {
      ...(state.money || {}),
      bankConnected: true,
      hasBank: monthBank.length > 0 || pending.length > 0,
      netBank: effectiveIn - effectiveOut,
      effectiveBalance,
      estimated,
      pendingCount: pending.length,
      needsReauth,
    };

    const net = document.getElementById('moneyNet');
    const caption = document.getElementById('moneyCaption');
    const moneyIn = document.getElementById('moneyIn');
    const moneyOut = document.getElementById('moneyOut');
    if (net) net.textContent = hasBalance ? euro(effectiveBalance) : '—';
    if (caption) caption.textContent = hasBalance
      ? (estimated ? 'Saldo estimado · lo apuntado se descuenta al instante' : 'Saldo disponible en Cajamar')
      : 'Cajamar conectado · saldo pendiente';
    if (moneyIn) moneyIn.textContent = euro(effectiveIn);
    if (moneyOut) moneyOut.textContent = euro(effectiveOut);

    const bankRows = tx.map((t) => ({
      id: 'bank-' + t.id,
      kind: Number(t.amount) < 0 ? 'expense' : 'income',
      amount: Math.abs(Number(t.amount)),
      title: t.merchant || t.description || 'Movimiento bancario',
      raw_text: t.description || '',
      created_at: t.booked_at,
      category: t.account_name ? ('Banco · ' + t.account_name) : 'Banco',
      metadata: { bank: true, status: t.raw?.status || null },
    }));
    const manualRows = pending.map((c) => ({ ...c, category: c.category || 'Apuntado · pendiente de Cajamar' }));
    const ledger = [...manualRows, ...bankRows].sort((a, b) => {
      const ad = safeDate(a.created_at)?.getTime() || 0, bd = safeDate(b.created_at)?.getTime() || 0;
      return bd - ad;
    });
    const rows = document.getElementById('moneyRows');
    if (rows) rows.innerHTML = ledger.length
      ? ledger.slice(0, 30).map((c) => row(c, { archive: false })).join('')
      : '<div class="empty"><strong>Banco conectado.</strong>Todavía no he recibido movimientos desde Cajamar.</div>';

    const note = document.getElementById('bankNoteText');
    if (note) {
      if (needsReauth) note.textContent = 'Cajamar necesita una nueva autorización para volver a actualizar saldo y movimientos.';
      else {
        const synced = bank.connection?.last_synced_at || bank.connection?.balance_synced_at || null;
        note.textContent = `Cajamar conectado${synced ? ' · actualizado ' + new Date(synced).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${estimated ? ' · hay movimientos apuntados pendientes de confirmar' : ''}`;
      }
    }
    const button = document.getElementById('bankConnectInline');
    if (button) button.textContent = needsReauth ? 'Reconectar Cajamar' : (state.bankLoading ? 'Actualizando Cajamar…' : 'Actualizar Cajamar');
    const setting = document.getElementById('bankState');
    if (setting) {
      setting.textContent = needsReauth ? 'Reconectar →' : 'Cajamar ✓';
      setting.classList.toggle('ok', !needsReauth);
    }
  }

  const baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () {
      const out = baseRender.apply(this, arguments);
      applyMoneyModel();
      return out;
    };
  }

  window.loadBank = async function ({ force = false, quiet = true } = {}) {
    if (state.bankLoading) return;
    if (!force && bankNeedsReauth(state.bank)) { applyMoneyModel(); return; }
    state.bankLoading = true; bankLastAttempt = Date.now(); render();
    try {
      const out = await bankApi({ action: 'sync', force: !!force }, 'POST', force ? 45000 : 30000);
      state.bank = out.bank || null;
      render();
      if (!quiet) {
        if (bankNeedsReauth(state.bank)) toast('Cajamar necesita que vuelvas a autorizarlo');
        else if (state.bank?.sync_partial) toast('Cajamar respondió solo en parte; conservo lo último válido');
        else toast('Cajamar actualizado');
      }
    } catch (e) {
      try { const out = await bankApi(null, 'GET', 12000); state.bank = out.bank || null; } catch {}
      render();
      if (!quiet) toast('No pude actualizar Cajamar');
    } finally {
      state.bankLoading = false; render();
    }
  };

  async function openBankFixed() {
    const connected = state.bank?.connection?.status === 'AUTHORIZED';
    if (!connected) { location.href = './conectar-banco.html'; return; }
    if (bankNeedsReauth(state.bank)) {
      try {
        const out = await bankApi({ action: 'reauthorize' }, 'POST', 30000);
        if (out?.link) { location.href = out.link; return; }
      } catch (e) { toast('No pude abrir la reconexión de Cajamar'); return; }
    }
    loadBank({ force: true, quiet: false });
  }

  const inline = document.getElementById('bankConnectInline'), settings = document.getElementById('bankSettings');
  if (inline) inline.onclick = openBankFixed;
  if (settings) {
    settings.onclick = openBankFixed;
    settings.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBankFixed(); } };
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine && !bankNeedsReauth(state.bank) && Date.now() - bankLastAttempt > 5 * 60 * 1000) loadBank({ force: false, quiet: true });
  });
})();

/* Resumen de Hoy. */
(function () {
  if (typeof state === 'undefined') return;
  const t$ = (id) => document.getElementById(id);

  function weekStart(d = new Date()) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  function figures() {
    const active = (state.captures || []).filter((c) => !c.archived_at);
    const now = new Date();
    const since = weekStart(now).getTime();
    const gymReady = typeof gymState !== 'undefined' && !!gymState.data;
    const sessions = gymReady ? (gymState.data.history || []).filter((h) => new Date(h.started_at).getTime() >= since).length : null;
    const m = state.money || {};
    const usaBanco = !!m.bankConnected && !!m.hasBank;
    const net = usaBanco ? m.netBank : m.netCaptured || 0;
    const hasMoney = usaBanco || !!m.hasCaptured;
    const open = active.filter((c) => c.kind === 'task' && !c.completed_at);
    const overdue = open.filter((c) => c.due_at && new Date(c.due_at) < now).length;
    return { sessions, net, hasMoney, usaBanco, estimated: !!m.estimated, open: open.length, overdue };
  }

  function renderPulse() {
    const host = t$('todayPulse'); if (!host) return;
    const f = figures();
    const tiles = [
      { view: 'gym', label: 'Entrenos', value: f.sessions === null ? '—' : String(f.sessions), foot: f.sessions === null ? 'cargando' : 'esta semana', lit: f.sessions > 0 },
      { view: 'dinero', label: 'Este mes', value: f.hasMoney ? euro(f.net) : '—', foot: f.hasMoney ? (f.usaBanco ? (f.estimated ? 'banco + apuntado' : 'en el banco') : 'balance capturado') : 'sin movimientos', lit: false, tone: f.hasMoney ? (f.net >= 0 ? 'positive' : 'negative') : '' },
      { view: 'archivo', label: 'Pendientes', value: String(f.open), foot: f.overdue ? `${f.overdue} con fecha pasada` : f.open ? 'sin retrasos' : 'nada abierto', lit: f.overdue > 0, tone: f.overdue ? 'warn' : '' },
    ];
    host.innerHTML = tiles.map((t) => `<button class="pulse-tile${t.lit ? ' is-lit' : ''}" data-pulse-go="${t.view}"><span class="pulse-label">${t.label}</span><b class="pulse-value ${t.tone || ''}">${esc(t.value)}</b><span class="pulse-foot">${esc(t.foot)}</span></button>`).join('');
    host.querySelectorAll('[data-pulse-go]').forEach((b) => { b.onclick = () => { const v = b.dataset.pulseGo; const nav = document.querySelector(`.nav button[data-view="${v}"]`); if (nav) nav.click(); else go(v); }; });
  }

  function install() {
    const focus = t$('focusBlock'); if (!focus || t$('todayPulse')) return;
    const host = document.createElement('div'); host.id = 'todayPulse'; host.className = 'today-pulse'; focus.after(host);
    const base = window.render;
    if (typeof base === 'function') window.render = function () { const out = base.apply(this, arguments); renderPulse(); return out; };
    renderPulse();
    if (typeof loadGym === 'function' && typeof gymState !== 'undefined' && !gymState.data) loadGym({ quiet: true }).then(renderPulse).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();