'use strict';

// Scorer della Fanum Fortunae XMas Cup: l'arbitro prende in carico un incontro
// (nessun altro può arbitrarlo), segna stoccate, colpi doppi e cartellini con il
// cronometro, e alla fine il risultato viene inviato all'app principale.

const root = document.getElementById('root');
const sheet = document.getElementById('sheet');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* niente */ } },
};
const K = { id: 'xmas-scorer-id', name: 'xmas-scorer-name', pin: 'xmas-scorer-pin', bout: 'xmas-scorer-bout' };

const HEARTBEAT_MS = 10000;
const LIST_REFRESH_MS = 5000;

const me = {
  id: store.get(K.id) || (() => {
    const id = (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
    store.set(K.id, id);
    return id;
  })(),
  name: store.get(K.name) || '',
  pin: store.get(K.pin) || '',
};

let CFG = { name: 'Fanum Fortunae XMas Cup', pinRequired: false };
let B = null; // incontro in corso (stato completo, salvato anche sul dispositivo)
let online = true;
let listData = null;
let listFilter = 'all'; // 'all' oppure il nome del girone/turno scelto

// ---------- Utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 4500 : 2200);
}

function fmtTime(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) return (Math.ceil(ms / 100) / 10).toFixed(1);
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'x-scorer-id': me.id,
        ...(me.pin ? { 'x-scorer-key': me.pin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    setOnline(false);
    const e = new Error('Nessuna connessione con il server');
    e.offline = true;
    throw e;
  }
  setOnline(true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Errore ${res.status}`);
    Object.assign(e, data, { status: res.status });
    if (res.status === 401 && data.auth === 'scorer') {
      me.pin = '';
      store.set(K.pin, null);
    }
    throw e;
  }
  return data;
}

function setOnline(v) {
  if (online === v) return;
  online = v;
  document.querySelectorAll('.net').forEach((n) => {
    n.className = `net ${v ? 'on' : 'off'}`;
    n.title = v ? 'Collegato' : 'Non collegato: i dati restano sul telefono e verranno inviati appena torna la rete';
  });
}

// Bip di fine tempo (si attiva dopo il primo tocco, come richiedono i browser).
let audio;
function beep(times = 3) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(audio.destination);
      const t0 = audio.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
      o.start(t0);
      o.stop(t0 + 0.3);
    }
  } catch { /* nessun audio */ }
  navigator.vibrate?.([300, 120, 300]);
}
document.addEventListener('pointerdown', () => {
  try { (audio ||= new (window.AudioContext || window.webkitAudioContext)()).resume(); } catch { /* niente */ }
}, { once: true });

// Schermo sempre acceso mentre si arbitra.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* non supportato */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && B && routeName() === 'bout') keepAwake(true);
});

// ---------- Navigazione ----------

function routeName() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'incontro') return 'bout';
  if (h.startsWith('giornata/')) return 'list';
  return 'days';
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  if (!me.name || (CFG.pinRequired && !me.pin)) return viewSetup();
  const r = routeName();
  if (B && r !== 'bout') {
    // C'è un incontro aperto su questo telefono: si torna lì.
    return go('#/incontro');
  }
  keepAwake(r === 'bout');
  if (r === 'bout') return B ? viewBout() : go('#/');
  if (r === 'list') return viewList();
  return viewDays();
}

window.addEventListener('hashchange', render);

function header(title, sub, back) {
  return `
    <header class="bar">
      ${back ? `<a class="ghost" href="${back}" aria-label="Indietro">‹</a>` : '<img src="../logo.svg" alt="" class="bar-logo">'}
      <div class="bar-title"><div>${title}</div>${sub ? `<small>${sub}</small>` : ''}</div>
      <span class="net ${online ? 'on' : 'off'}" title="${online ? 'Collegato' : 'Non collegato'}"></span>
      <button class="ghost" data-act="who" aria-label="Arbitro">👤</button>
    </header>`;
}

function wireHeader() {
  root.querySelector('[data-act=who]')?.addEventListener('click', () => {
    openSheet(`
      <h2>👤 ${esc(me.name)}</h2>
      <p class="muted">Questo nome compare agli altri arbitri e all'organizzazione sugli incontri che arbitri.</p>
      <button class="btn block" data-act="change">Cambia nome${CFG.pinRequired ? ' o PIN' : ''}</button>
      <button class="btn block secondary" data-act="close">Chiudi</button>`, {
      change: () => { closeSheet(); me.name = ''; viewSetup(); },
    });
  });
}

// ---------- Configurazione iniziale ----------

function viewSetup() {
  root.innerHTML = `
    <div class="setup">
      <img src="../logo.svg" alt="" class="setup-logo">
      <h1>${esc(CFG.name)}</h1>
      <p class="lead">Scorer per gli arbitri</p>
      <form id="setup" class="card">
        <label for="nm">Il tuo nome</label>
        <input id="nm" name="arbitro" autocomplete="name" maxlength="40" required value="${esc(store.get(K.name) || '')}" placeholder="es. Mario Rossi">
        ${CFG.pinRequired ? `
          <label for="pin">PIN degli arbitri</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" required placeholder="Chiedilo all'organizzazione">` : ''}
        <button class="btn block big">Inizia ad arbitrare</button>
      </form>
    </div>`;
  const form = root.querySelector('#setup');
  const nameInput = form.elements.namedItem('arbitro');
  const pinInput = form.elements.namedItem('pin');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    if (CFG.pinRequired) {
      me.pin = pinInput.value.trim();
      try {
        await api('POST', '/api/scorer/check', {});
      } catch (err) {
        return toast(err.status === 401 ? 'PIN errato' : err.message, true);
      }
      store.set(K.pin, me.pin);
    }
    me.name = name;
    store.set(K.name, name);
    go('#/');
  });
  (nameInput.value && pinInput ? pinInput : nameInput).focus();
}

// ---------- Giornate ----------

let autoOpened = false;
async function viewDays() {
  root.innerHTML = `${header('Scorer', esc(CFG.name))}<div class="content"><p class="muted center">Caricamento…</p></div>`;
  wireHeader();
  let days;
  try {
    ({ days } = await api('GET', '/api/scorer/days'));
  } catch (e) {
    root.querySelector('.content').innerHTML = `<div class="card center"><p>${esc(e.message)}</p><button class="btn" data-act="retry">Riprova</button></div>`;
    root.querySelector('[data-act=retry]').onclick = render;
    return;
  }
  if (routeName() !== 'days' || B) return;
  const active = days.filter((d) => d.todo > 0);
  // Se c'è una sola giornata con incontri da arbitrare, la apre direttamente.
  if (!autoOpened && active.length === 1) {
    autoOpened = true;
    return go(`#/giornata/${active[0].id}`);
  }
  autoOpened = true;
  const card = (d) => `
    <a class="card day ${d.todo ? '' : 'quiet'}" href="#/giornata/${d.id}">
      <div class="row"><strong>Giornata ${d.number}</strong><span class="spacer"></span><span class="pill">${d.todo ? `${d.open} da arbitrare` : statusLabel(d.status)}</span></div>
      <div class="muted small">${esc(fmtDate(d.date))}${d.location ? ` · ${esc(d.location)}` : ''}</div>
      ${d.live ? `<div class="small">📱 ${d.live} in arbitraggio</div>` : ''}
    </a>`;
  root.querySelector('.content').innerHTML = `
    <h2>Giornate</h2>
    ${days.length ? [...active, ...days.filter((d) => !d.todo).reverse()].map(card).join('')
      : '<div class="card center muted">Nessuna giornata. L\'organizzazione deve creare la giornata e generare i gironi.</div>'}
    ${days.length && !active.length ? '<p class="muted center small">Nessun incontro da arbitrare in questo momento: appena l\'organizzazione genera i gironi o il tabellone compariranno qui.</p>' : ''}`;
}

const statusLabel = (s) => ({ presenze: 'In preparazione', gironi: 'Gironi', gironi_conclusi: 'Gironi conclusi', dirette: 'Dirette', conclusa: 'Conclusa' }[s] || s);

setInterval(() => {
  if (document.hidden || sheet.open) return;
  const r = routeName();
  if (r === 'list') refreshList();
  else if (r === 'days' && !B && me.name) viewDays();
}, LIST_REFRESH_MS);

// ---------- Elenco incontri ----------

function dayIdFromHash() {
  return Number(location.hash.split('/')[2]);
}

async function viewList() {
  const dayId = dayIdFromHash();
  if (!listData || listData.day.id !== dayId) {
    root.innerHTML = `${header('Incontri', '', '#/')}<div class="content"><p class="muted center">Caricamento…</p></div>`;
    wireHeader();
  }
  await refreshList(true);
}

async function refreshList(force = false) {
  const dayId = dayIdFromHash();
  let data;
  try {
    data = await api('GET', `/api/scorer/days/${dayId}`);
  } catch (e) {
    if (force) {
      const c = root.querySelector('.content');
      if (c) c.innerHTML = `<div class="card center"><p>${esc(e.message)}</p><a class="btn" href="#/">Torna alle giornate</a></div>`;
    }
    return;
  }
  if (routeName() !== 'list' || dayIdFromHash() !== dayId || B) return;
  const changed = JSON.stringify(data) !== JSON.stringify(listData);
  listData = data;
  if (changed || force) drawList();
}

function drawList() {
  const { day, bouts } = listData;
  const scroll = window.scrollY;
  // Tiratori impegnati in un incontro in corso: meglio non chiamarli su un'altra pedana.
  const busy = new Map();
  bouts.filter((b) => b.status === 'locked').forEach((b) => { busy.set(b.a.id, b); busy.set(b.b.id, b); });
  // Nei gironi il prossimo incontro consigliato è il primo libero nell'ordine FIE.
  const next = new Set();
  const seen = new Set();
  bouts.filter((b) => b.kind === 'pool' && b.status === 'open').forEach((b) => {
    if (!seen.has(b.group)) { seen.add(b.group); next.add(`${b.kind}${b.id}`); }
  });

  // Solo gli assalti da arbitrare: liberi, quello che sto arbitrando io e quelli
  // lasciati da un arbitro che non risponde più (si possono riprendere).
  // Quelli in corso con un altro arbitro, conclusi o in attesa dei tiratori non si vedono.
  const toReferee = (b) => b.status === 'open' || (b.status === 'locked' && (b.lock?.mine || b.lock?.stale));
  const available = bouts.filter(toReferee);
  const allGroups = [];
  for (const b of available) {
    let g = allGroups.find((x) => x.name === b.group);
    if (!g) allGroups.push((g = { name: b.group, bouts: [] }));
    g.bouts.push(b);
  }
  // Il girone scelto non ha più assalti da arbitrare: si torna a "Tutti".
  if (listFilter !== 'all' && !allGroups.some((g) => g.name === listFilter)) listFilter = 'all';
  const groups = listFilter === 'all' ? allGroups : allGroups.filter((g) => g.name === listFilter);
  const pending = bouts.filter((b) => ['open', 'locked', 'waiting'].includes(b.status)).length;

  const name = (s, extra) => (s ? `${extra ? `<span class="tag">${extra}</span>` : ''}${esc(s.name)}` : '<span class="muted">da definire</span>');
  const boutCard = (b) => {
    const mine = b.lock?.mine;
    const lockedBy = b.status === 'locked' && !mine;
    const busyNames = b.status === 'open' ? [b.a, b.b].filter((f) => f && busy.has(f.id)).map((f) => f.name) : [];
    const live = b.lock?.live;
    let action = '';
    if (b.status === 'open') action = `<button class="btn" data-claim="${b.kind}:${b.id}">Arbitra</button>`;
    else if (mine) action = `<button class="btn" data-claim="${b.kind}:${b.id}">Riprendi</button>`;
    else if (lockedBy && b.lock.stale) action = `<button class="btn secondary" data-claim="${b.kind}:${b.id}" data-takeover="1">Subentra</button>`;
    const pa = b.kind === 'pool' ? b.a?.position : b.a?.seed;
    const pb = b.kind === 'pool' ? b.b?.position : b.b?.seed;
    const res = b.result;
    return `
      <div class="card bout ${b.status} ${next.has(`${b.kind}${b.id}`) ? 'next' : ''}">
        <div class="row small muted"><span>${esc(b.label)}</span><span class="spacer"></span>
          ${next.has(`${b.kind}${b.id}`) ? '<span class="pill hot">Prossimo</span>' : ''}
          ${b.status === 'done' ? '<span class="pill ok">Concluso</span>' : ''}
          ${b.status === 'waiting' ? '<span class="pill">In attesa</span>' : ''}
          ${b.status === 'closed' ? '<span class="pill">Chiuso</span>' : ''}</div>
        <div class="vs">
          <div class="f left ${res && res.winner_id === b.a?.id ? 'win' : ''}">${name(b.a, pa)}</div>
          <div class="mid">${res ? `<strong>${res.score_a}–${res.score_b}</strong>` : live && live.score_a != null ? `<strong class="live">${live.score_a}–${live.score_b}</strong>` : 'vs'}</div>
          <div class="f right ${res && res.winner_id === b.b?.id ? 'win' : ''}">${name(b.b, pb)}</div>
        </div>
        ${lockedBy ? `<div class="small lockline ${b.lock.stale ? 'stale' : ''}">📱 ${esc(b.lock.name)}${b.lock.stale ? ' · non risponde' : ' sta arbitrando'}</div>` : ''}
        ${mine ? '<div class="small lockline mine">📱 Lo stai arbitrando tu</div>' : ''}
        ${busyNames.length ? `<div class="small warnline">⏳ ${busyNames.map(esc).join(' e ')} ${busyNames.length > 1 ? 'stanno' : 'sta'} tirando in un altro incontro</div>` : ''}
        ${action ? `<div class="actions">${action}</div>` : ''}
      </div>`;
  };

  root.innerHTML = `
    ${header(`Giornata ${day.number}`, esc(fmtDate(day.date)), '#/')}
    <div class="content">
      ${allGroups.length ? `
      <div class="filters" role="tablist" aria-label="Filtra per girone">
        <button class="chip ${listFilter === 'all' ? 'on' : ''}" data-filter="all">Tutti <span class="count">${available.length}</span></button>
        ${allGroups.map((g) => `<button class="chip ${listFilter === g.name ? 'on' : ''}" data-filter="${esc(g.name)}">${esc(g.name)} <span class="count">${g.bouts.length}</span></button>`).join('')}
      </div>` : ''}
      ${groups.length ? groups.map((g) => `<h3 class="group">${esc(g.name)}</h3>${g.bouts.map(boutCard).join('')}`).join('')
        : `<div class="card center muted">${!bouts.length ? 'Nessun incontro: l\'organizzazione non ha ancora generato i gironi.'
          : pending ? '⏳ In questo momento non ci sono assalti liberi: gli altri sono già in arbitraggio o aspettano i vincitori del turno prima. La lista si aggiorna da sola.'
          : '🎉 Tutti gli assalti di questa giornata sono conclusi.'}</div>`}
    </div>`;
  wireHeader();
  window.scrollTo(0, scroll);
  root.querySelectorAll('[data-filter]').forEach((c) => c.addEventListener('click', () => { listFilter = c.dataset.filter; drawList(); }));
  root.querySelectorAll('[data-claim]').forEach((btn) => btn.addEventListener('click', () => {
    const [kind, id] = btn.dataset.claim.split(':');
    const bout = bouts.find((x) => x.kind === kind && x.id === Number(id));
    const busyNames = [bout.a, bout.b].filter((f) => f && busy.has(f.id) && bout.status === 'open').map((f) => f.name);
    if (busyNames.length && !confirm(`${busyNames.join(' e ')} ${busyNames.length > 1 ? 'stanno' : 'sta'} tirando in un altro incontro. Vuoi arbitrare comunque questo?`)) return;
    claim(bout, !!btn.dataset.takeover);
  }));
}

async function claim(bout, takeover = false) {
  try {
    const r = await api('POST', `/api/scorer/bouts/${bout.kind}/${bout.id}/claim`, { scorer_id: me.id, scorer_name: me.name, takeover });
    startBout(r.bout, r.saved);
  } catch (e) {
    if (e.stale && !takeover && confirm(e.message)) return claim(bout, true);
    toast(e.message, true);
    refreshList(true);
  }
}

// ---------- Stato dell'incontro ----------

function newState(bout) {
  return {
    kind: bout.kind, id: bout.id, dayId: listData?.day.id ?? null,
    label: bout.label, max: bout.max, timing: bout.timing,
    a: { id: bout.a.id, name: bout.a.name, seed: bout.a.seed ?? null }, b: { id: bout.b.id, name: bout.b.name, seed: bout.b.seed ?? null },
    score: [0, 0], cards: [{ y: 0, r: 0 }, { y: 0, r: 0 }],
    period: 1, phase: 'fight', remaining: bout.timing.periodMs, running: false, endsAt: null,
    // Passività: tempo del cronometro all'ultima stoccata (o inizio periodo), cartellini P dati.
    passiveFrom: bout.timing.periodMs, pRed: false, pBlack: null,
    priority: null, winner: null, reason: null, swapped: false, history: [],
  };
}

function startBout(bout, saved) {
  B = newState(bout);
  if (saved) {
    // Riprende da dove era arrivato l'arbitro precedente.
    B.score = [saved.score_a ?? 0, saved.score_b ?? 0];
    if (Array.isArray(saved.cards) && saved.cards.length === 2) B.cards = saved.cards;
    if (saved.period) B.period = saved.period;
    if (['fight', 'break', 'draw', 'priority'].includes(saved.phase)) B.phase = saved.phase;
    if (typeof saved.remaining === 'number') B.remaining = saved.remaining;
    if (saved.priority === 0 || saved.priority === 1) B.priority = saved.priority;
    if (typeof saved.passive === 'number') B.passiveFrom = B.remaining + saved.passive;
    if (saved.pRed) B.pRed = true;
    toast(`Ripreso dal punteggio salvato: ${B.score[0]}–${B.score[1]}`);
  }
  save();
  sendLive(true);
  go('#/incontro');
}

function save() {
  if (B) store.set(K.bout, JSON.stringify(B));
  else store.set(K.bout, null);
}

const remainingNow = () => (B.running ? Math.max(0, B.endsAt - Date.now()) : B.remaining);

function stopClock() {
  if (!B.running) return;
  B.remaining = remainingNow();
  B.running = false;
  B.endsAt = null;
}

function startClock() {
  if (!['fight', 'break', 'priority'].includes(B.phase) || B.remaining <= 0) return;
  B.endsAt = Date.now() + B.remaining;
  B.running = true;
}

function snapshot() {
  const { history, ...rest } = B;
  return JSON.stringify({ ...rest, running: false, endsAt: null, remaining: remainingNow() });
}

// Ogni azione si può annullare: prima di eseguirla si salva una fotografia dello stato.
function act(fn) {
  if (!B) return;
  B.history.push(snapshot());
  if (B.history.length > 60) B.history.shift();
  fn();
  save();
  sendLive();
  render();
}

function undo() {
  if (!B?.history.length) return;
  const prev = JSON.parse(B.history.pop());
  B = { ...prev, history: B.history, swapped: B.swapped };
  save();
  sendLive();
  render();
}

const fighting = () => ['fight', 'priority'].includes(B.phase);
const tied = () => B.score[0] === B.score[1];
const nameOf = (i) => (i === 0 ? B.a.name : B.b.name);

function endBout(winner, reason) {
  stopClock();
  B.phase = 'ended';
  B.winner = winner;
  B.reason = reason;
}

function checkEnd(scorer) {
  if (B.phase === 'priority') return endBout(scorer, 'priority-touch');
  if (B.score[scorer] >= B.max) endBout(scorer, 'touches');
}

function touch(i) {
  if (!fighting()) return;
  navigator.vibrate?.(40);
  act(() => {
    stopClock();
    B.score[i]++;
    resetPassivity();
    checkEnd(i);
  });
}

// Colpo doppio (solo spada): una stoccata a testa. Sul pari all'ultima stoccata
// (es. 4–4 nei gironi, 14–14 nelle dirette) e nel minuto di priorità è annullato.
function double() {
  if (!fighting()) return;
  if (tied() && (B.score[0] === B.max - 1 || B.phase === 'priority')) {
    return toast(B.phase === 'priority' ? 'Colpo doppio annullato: nel minuto di priorità non vale' : `Colpo doppio annullato: sul ${B.score[0]}–${B.score[1]} non vale`, true);
  }
  navigator.vibrate?.([40, 60, 40]);
  act(() => {
    stopClock();
    B.score[0]++;
    B.score[1]++;
    resetPassivity();
    if (B.score[0] >= B.max) endBout(0, 'touches');
    else if (B.score[1] >= B.max) endBout(1, 'touches');
  });
}

// Se durante il sorteggio della priorità il punteggio non è più pari (correzione o
// cartellino), l'incontro è finito a tempo scaduto con il vincitore in vantaggio.
function settleDraw() {
  if (B.phase === 'draw' && !tied()) endBout(B.score[0] > B.score[1] ? 0 : 1, 'time');
}

function minus(i) {
  if (B.phase === 'ended' || B.score[i] === 0) return;
  act(() => {
    B.score[i]--;
    settleDraw();
  });
}

// Cartellini: il giallo è un avvertimento, il secondo giallo diventa rosso;
// ogni rosso dà una stoccata all'avversario.
function card(i, kind) {
  if (B.phase === 'ended') return;
  act(() => {
    stopClock();
    const c = B.cards[i];
    if (kind === 'yellow' && !c.y && !c.r) {
      c.y = 1;
      return;
    }
    c.r++;
    B.score[1 - i]++;
    resetPassivity();
    checkEnd(1 - i);
    settleDraw();
  });
}

// ---------- Passività (solo nelle dirette) ----------
// Dopo 1 minuto di combattimento senza stoccate: cartellino rosso P a entrambi e una
// stoccata a testa. Al minuto successivo senza stoccate: cartellino nero P e sconfitta
// con il punteggio attuale per chi è in svantaggio o, a parità, per chi era peggio
// piazzato dopo i gironi. Il conteggio riparte a ogni stoccata e a ogni nuovo periodo.
const passivityOn = () => !!B.timing.passivityMs && B.phase === 'fight';
const passiveElapsed = () => Math.max(0, B.passiveFrom - remainingNow());

function resetPassivity() {
  B.passiveFrom = B.remaining;
}

function passivity() {
  act(() => {
    stopClock();
    resetPassivity();
    if (!B.pRed) {
      B.pRed = true;
      // Sul pari a un passo dalla fine (es. 14–14) le due stoccate si annullano a vicenda.
      if (!(tied() && B.score[0] === B.max - 1)) {
        B.score[0]++;
        B.score[1]++;
      }
      if (B.score[0] >= B.max) endBout(0, 'touches');
      else if (B.score[1] >= B.max) endBout(1, 'touches');
      return;
    }
    let loser;
    if (B.score[0] !== B.score[1]) loser = B.score[0] < B.score[1] ? 0 : 1;
    else loser = (B.a.seed ?? 0) > (B.b.seed ?? 0) ? 0 : 1; // testa di serie più bassa = peggio piazzato
    B.pBlack = loser;
    endBout(1 - loser, 'passivity');
  });
  beep(2);
  navigator.vibrate?.([200, 100, 200]);
  toast(B.phase === 'ended' && B.reason === 'passivity' ? `Cartellino nero per passività a ${nameOf(B.pBlack)}` : 'Passività: cartellino rosso P a entrambi, una stoccata a testa');
}

function passiveText() {
  if (!B.timing.passivityMs || B.phase !== 'fight') return '';
  const left = Math.max(0, B.timing.passivityMs - passiveElapsed());
  return `${B.pRed ? 'Prossima passività: <strong>nero P</strong>' : 'Passività'} tra ${fmtTime(left)}`;
}

function toggleClock() {
  if (!B || B.phase === 'ended' || B.phase === 'draw') return;
  // Tempo a zero (es. dopo "Annulla" sullo scadere): toccando si passa alla fase successiva.
  if (!B.running && B.remaining <= 0) return timeUp();
  if (B.running) stopClock(); else startClock();
  save();
  sendLive();
  render();
}

function timeUp() {
  act(() => {
    B.running = false;
    B.endsAt = null;
    B.remaining = 0;
    if (B.phase === 'break') {
      B.period++;
      B.phase = 'fight';
      B.remaining = B.timing.periodMs;
      B.passiveFrom = B.remaining; // ogni periodo il conteggio riparte da zero
    } else if (B.phase === 'priority') {
      endBout(B.priority, 'priority-time');
    } else if (B.period < B.timing.periods) {
      // Fine periodo nelle dirette: un minuto di pausa che parte da solo.
      B.phase = 'break';
      B.remaining = B.timing.breakMs;
      startClock();
    } else if (!tied()) {
      endBout(B.score[0] > B.score[1] ? 0 : 1, 'time');
    } else {
      B.phase = 'draw'; // parità allo scadere: si sorteggia la priorità
    }
  });
  beep();
}

function skipBreak() {
  act(() => {
    stopClock();
    B.period++;
    B.phase = 'fight';
    B.remaining = B.timing.periodMs;
    B.passiveFrom = B.remaining;
  });
}

function drawPriority() {
  act(() => {
    B.priority = Math.random() < 0.5 ? 0 : 1;
    B.phase = 'priority';
    B.remaining = B.timing.priorityMs;
  });
  toast(`Priorità a ${nameOf(B.priority)}`);
}

setInterval(() => {
  if (!B || !B.running) return;
  const ms = remainingNow();
  if (ms <= 0) return timeUp();
  if (passivityOn() && passiveElapsed() >= B.timing.passivityMs) return passivity();
  const t = root.querySelector('.clock .time');
  if (t) t.textContent = fmtTime(ms);
  const pv = root.querySelector('.passive');
  if (pv) {
    pv.innerHTML = passiveText();
    pv.classList.toggle('soon', B.timing.passivityMs - passiveElapsed() <= 15000);
  }
}, 100);

// ---------- Collegamento con il server ----------

function liveState() {
  return {
    fa: B.a.id, fb: B.b.id, score_a: B.score[0], score_b: B.score[1], cards: B.cards,
    period: B.period, phase: B.phase, remaining: Math.round(remainingNow()), priority: B.priority, running: B.running,
    passive: Math.round(passiveElapsed()), pRed: B.pRed,
  };
}

let liveTimer;
function sendLive(now = false) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(heartbeat, now ? 0 : 600);
}

async function heartbeat() {
  if (!B) return;
  const cur = B;
  try {
    await api('POST', `/api/scorer/bouts/${cur.kind}/${cur.id}/heartbeat`, { scorer_id: me.id, live: liveState() });
  } catch (e) {
    if (cur !== B) return;
    if (e.lost || e.status === 404) lostBout(e.message);
    else if (e.status === 401) render();
  }
}
setInterval(() => { if (B) heartbeat(); }, HEARTBEAT_MS);
window.addEventListener('online', () => { if (B) heartbeat(); });

function lostBout(msg) {
  B = null;
  save();
  keepAwake(false);
  openSheet(`
    <h2>⚠️ Incontro non più tuo</h2>
    <p>${esc(msg)}</p>
    <button class="btn block" data-act="close">Torna all'elenco</button>`, {}, () => go(listHash()));
}

const listHash = () => (listData ? `#/giornata/${listData.day.id}` : '#/');

async function submitResult() {
  const tie = tied();
  if (tie && B.winner == null) return toast('Punteggio in parità: indica chi ha vinto alla priorità', true);
  const body = {
    scorer_id: me.id,
    score_a: B.score[0],
    score_b: B.score[1],
    winner_id: tie ? (B.winner === 0 ? B.a.id : B.b.id) : null,
  };
  const btn = root.querySelector('[data-act=submit]');
  if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }
  try {
    await api('POST', `/api/scorer/bouts/${B.kind}/${B.id}/result`, body);
    const dayHash = B.dayId ? `#/giornata/${B.dayId}` : listHash();
    B = null;
    save();
    keepAwake(false);
    toast('✅ Risultato inviato');
    listData = null;
    go(dayHash);
  } catch (e) {
    if (e.lost || e.status === 404) return lostBout(e.message);
    toast(e.offline ? 'Nessuna connessione: il risultato è salvato sul telefono, riprova appena torna la rete' : e.message, true);
    render();
  }
}

async function releaseBout() {
  if (!confirm('Lasciare l\'incontro? Il punteggio resta salvato e un altro arbitro potrà riprenderlo da qui.')) return;
  stopClock();
  try {
    await api('POST', `/api/scorer/bouts/${B.kind}/${B.id}/release`, { scorer_id: me.id, live: liveState() });
  } catch (e) {
    if (e.offline) return toast('Nessuna connessione: impossibile lasciare l\'incontro adesso', true);
  }
  const back = B.dayId ? `#/giornata/${B.dayId}` : listHash();
  B = null;
  save();
  keepAwake(false);
  go(back);
}

// ---------- Schermata di arbitraggio ----------

function phaseLabel() {
  if (B.phase === 'break') return 'Pausa · 1 minuto';
  if (B.phase === 'priority') return `Minuto di priorità · ${esc(nameOf(B.priority))}`;
  if (B.phase === 'draw') return 'Parità allo scadere';
  if (!B.running && B.remaining <= 0) return 'Tempo scaduto · tocca per proseguire';
  return B.running ? 'Tocca per fermare' : 'Tocca per avviare';
}

function viewBout() {
  if (B.phase === 'ended') return viewEnd();
  const order = B.swapped ? [1, 0] : [0, 1];
  const periods = B.timing.periods > 1 ? `Periodo ${Math.min(B.period, B.timing.periods)}/${B.timing.periods} · ` : '';
  const side = (i, pos) => {
    const f = i === 0 ? B.a : B.b;
    const c = B.cards[i];
    return `
      <section class="fencer ${pos} ${B.priority === i ? 'has-priority' : ''}">
        <div class="fname">${esc(f.name)}${B.priority === i ? ' <span class="prio-badge" title="Priorità">P</span>' : ''}</div>
        <div class="cards-shown">${c.y ? '<span class="cardi yellow"></span>' : ''}${'<span class="cardi red"></span>'.repeat(c.r)}${B.pRed ? '<span class="cardi red p" title="Rosso per passività">P</span>' : ''}</div>
        <div class="score">${B.score[i]}</div>
        <button class="hit" data-act="touch" data-i="${i}" ${fighting() ? '' : 'disabled'} aria-label="Stoccata a ${esc(f.name)}">+1</button>
        <div class="mini">
          <button data-act="minus" data-i="${i}" aria-label="Togli una stoccata">−1</button>
          <button data-act="yellow" data-i="${i}" aria-label="Cartellino giallo"><span class="cardi yellow"></span></button>
          <button data-act="red" data-i="${i}" aria-label="Cartellino rosso"><span class="cardi red"></span></button>
        </div>
      </section>`;
  };
  root.innerHTML = `
    <div class="bout-screen phase-${B.phase}">
      <header class="bar">
        <button class="ghost" data-act="menu" aria-label="Menu">☰</button>
        <div class="bar-title"><div>${esc(B.label)}</div><small>${periods}a ${B.max} stoccate</small></div>
        <span class="net ${online ? 'on' : 'off'}"></span>
        <button class="ghost" data-act="swap" aria-label="Inverti lati" title="Inverti lati">⇄</button>
      </header>
      <div class="clock-wrap">
        <button class="clock ${B.running ? 'running' : ''}" data-act="clock" ${B.phase === 'draw' ? 'disabled' : ''}>
          <span class="time">${fmtTime(remainingNow())}</span>
          <span class="phase-label">${phaseLabel()}</span>
        </button>
        ${passivityOn() ? `<div class="passive ${B.timing.passivityMs - passiveElapsed() <= 15000 ? 'soon' : ''}">${passiveText()}</div>` : ''}
        ${B.phase === 'break' ? '<button class="btn secondary" data-act="skip-break">Salta la pausa</button>' : ''}
        ${B.phase === 'draw' ? '<button class="btn big" data-act="draw">🎲 Sorteggia la priorità</button>' : ''}
      </div>
      <div class="fencers">${side(order[0], 'left')}${side(order[1], 'right')}</div>
      <div class="controls">
        <button class="btn secondary" data-act="undo" ${B.history.length ? '' : 'disabled'}>↶ Annulla</button>
        <button class="btn double" data-act="double" ${fighting() ? '' : 'disabled'}>⚔️ Colpo doppio</button>
      </div>
    </div>`;

  const on = (act, fn) => root.querySelectorAll(`[data-act=${act}]`).forEach((el) => el.addEventListener('click', () => fn(Number(el.dataset.i))));
  on('touch', touch);
  on('minus', minus);
  on('yellow', (i) => card(i, 'yellow'));
  on('red', (i) => card(i, 'red'));
  on('double', double);
  on('undo', undo);
  on('clock', toggleClock);
  on('skip-break', skipBreak);
  on('draw', drawPriority);
  on('swap', () => { B.swapped = !B.swapped; save(); render(); });
  on('menu', openMenu);
}

function openMenu() {
  openSheet(`
    <h2>${esc(B.label)}</h2>
    <button class="btn block secondary" data-act="time">⏱️ Correggi il tempo</button>
    <button class="btn block secondary" data-act="finish">🏁 Termina l'incontro adesso</button>
    <button class="btn block secondary" data-act="release">🚪 Lascia l'incontro a un altro arbitro</button>
    <button class="btn block" data-act="close">Chiudi</button>
    <p class="muted small">Tasti rapidi su computer: ← e → stoccata a sinistra/destra, D colpo doppio, Spazio cronometro, Z annulla.</p>`, {
    time: () => {
      closeSheet();
      stopClock();
      const v = prompt('Tempo rimanente (minuti:secondi)', fmtTime(B.remaining).includes(':') ? fmtTime(B.remaining) : `0:${String(Math.ceil(B.remaining / 1000)).padStart(2, '0')}`);
      const m = v && v.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
      if (!m) return render();
      act(() => {
        B.remaining = (m[2] == null ? Number(m[1]) : Number(m[1]) * 60 + Number(m[2])) * 1000;
        B.passiveFrom = B.remaining;
      });
    },
    finish: () => {
      closeSheet();
      if (!confirm('Terminare l\'incontro con il punteggio attuale? (es. abbandono o tempo cronometrato altrove)')) return;
      act(() => endBout(tied() ? B.priority : (B.score[0] > B.score[1] ? 0 : 1), 'manual'));
    },
    release: () => { closeSheet(); releaseBout(); },
  });
}

const REASON = {
  touches: (w) => `${esc(nameOf(w))} arriva a ${B.max} stoccate`,
  time: (w) => `Tempo scaduto: vince ${esc(nameOf(w))} in vantaggio`,
  'priority-touch': (w) => `Stoccata nel minuto di priorità: vince ${esc(nameOf(w))}`,
  'priority-time': (w) => `Fine del minuto di priorità: vince ${esc(nameOf(w))} che aveva la priorità`,
  manual: () => 'Incontro terminato dall\'arbitro',
  passivity: (w) => `Cartellino nero per passività a ${esc(nameOf(1 - w))}${tied() ? ' (a parità perde chi era peggio piazzato dopo i gironi)' : ''}: vince ${esc(nameOf(w))}`,
};

function viewEnd() {
  const tie = tied();
  const order = B.swapped ? [1, 0] : [0, 1];
  const f = (i) => (i === 0 ? B.a : B.b);
  root.innerHTML = `
    <div class="end-screen">
      <header class="bar">
        <span></span>
        <div class="bar-title"><div>Fine incontro</div><small>${esc(B.label)}</small></div>
        <span class="net ${online ? 'on' : 'off'}"></span>
        <span></span>
      </header>
      <div class="content">
        <div class="final">
          ${order.map((i, k) => `
            <div class="final-side ${k === 0 ? 'left' : 'right'} ${B.winner === i ? 'win' : ''}">
              <div class="fname">${esc(f(i).name)}</div>
              ${B.pRed || B.pBlack === i ? `<div class="cards-shown">${B.pRed ? '<span class="cardi red p" title="Rosso per passività">P</span>' : ''}${B.pBlack === i ? '<span class="cardi black p" title="Nero per passività">P</span>' : ''}</div>` : ''}
              <div class="score">${B.score[i]}</div>
              ${B.winner === i ? '<div class="crown">🏆 Vince</div>' : ''}
            </div>`).join('')}
        </div>
        ${B.winner != null ? `<p class="center">${REASON[B.reason]?.(B.winner) ?? ''}</p>` : ''}
        ${tie ? `
          <div class="card">
            <p><strong>Punteggio in parità:</strong> chi ha vinto alla priorità?</p>
            <div class="pick">${order.map((i) => `<button class="chip ${B.winner === i ? 'on' : ''}" data-win="${i}">${esc(f(i).name)}</button>`).join('')}</div>
          </div>` : ''}
        <button class="btn block big" data-act="submit" ${tie && B.winner == null ? 'disabled' : ''}>✅ Conferma e invia il risultato</button>
        <button class="btn block secondary" data-act="undo">↶ Annulla l'ultima azione e torna all'incontro</button>
        <p class="muted small center">Il risultato verrà inserito in automatico nell'app dell'organizzazione.</p>
      </div>
    </div>`;
  root.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => {
    B.winner = Number(b.dataset.win);
    save();
    render();
  }));
  root.querySelector('[data-act=submit]').addEventListener('click', submitResult);
  root.querySelector('[data-act=undo]').addEventListener('click', undo);
}

// Tasti rapidi per chi arbitra da computer.
document.addEventListener('keydown', (e) => {
  if (!B || routeName() !== 'bout' || sheet.open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const left = B.swapped ? 1 : 0;
  const map = {
    ArrowLeft: () => touch(left), a: () => touch(left),
    ArrowRight: () => touch(1 - left), l: () => touch(1 - left),
    d: double, z: undo, Backspace: undo,
    ' ': toggleClock,
  };
  const fn = map[e.key];
  if (fn) {
    e.preventDefault();
    fn();
  }
});

// ---------- Finestra in basso ----------

function openSheet(html, actions = {}, onClose) {
  const body = sheet.querySelector('.sheet-body');
  body.innerHTML = html;
  body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const fn = actions[b.dataset.act];
    if (fn) fn(); else closeSheet();
  }));
  sheet.onclose = () => onClose?.();
  sheet.showModal();
}

function closeSheet() {
  sheet.onclose = null;
  sheet.close();
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

// ---------- Avvio ----------

async function boot() {
  try {
    CFG = await api('GET', '/api/scorer/config');
  } catch { /* offline: si usano i valori di default */ }
  const saved = store.get(K.bout);
  if (saved) {
    try {
      B = JSON.parse(saved);
      B.history ||= [];
    } catch {
      B = null;
    }
  }
  if (B) {
    // Pagina ricaricata durante un incontro: conferma che l'incontro è ancora nostro.
    try {
      await api('POST', `/api/scorer/bouts/${B.kind}/${B.id}/claim`, { scorer_id: me.id, scorer_name: me.name || 'Arbitro' });
    } catch (e) {
      if (!e.offline && e.status !== 401) {
        render();
        return lostBout(e.message);
      }
    }
  }
  render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
