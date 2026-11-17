'use strict';

const app = document.getElementById('app');
const dialog = document.getElementById('bout-dialog');
const dialogForm = document.getElementById('bout-form');

let T = null; // torneo: anagrafica, giornate, classifica generale
let D = null; // giornata aperta (dati completi)

const STATUS_LABEL = {
  presenze: 'Appello dei presenti',
  gironi: 'Gironi in corso',
  gironi_conclusi: 'Gironi conclusi',
  dirette: 'Dirette in corso',
  conclusa: 'Conclusa',
};

const DAY_TABS = [
  ['presenti', 'Presenti'],
  ['gironi', 'Gironi'],
  ['classifica-gironi', 'Classifica gironi'],
  ['tabellone', 'Tabellone dirette'],
  ['classifica', 'Classifica giornata'],
];

const POINTS_LEGEND = '1° 10 pt · 2° 7 pt · 3° ex aequo 5 pt · dal 4° all\'8° 3 pt · tutti gli altri presenti 1 pt';

// ---------- Utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fencerName(f) {
  if (!f) return '';
  return `${f.last_name.toUpperCase()} ${f.first_name || ''}`.trim();
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

const dayTitle = (d) => `Giornata ${d.number}`;
const medal = (rank) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[rank] || '');

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 4500 : 2200);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Errore di rete');
  return data;
}

function apply(data) {
  if (data.tournament) T = data.tournament;
  if (data.day) D = data;
}

// Esegue una modifica e ridisegna con i dati aggiornati.
async function mutate(method, url, body, okMsg) {
  try {
    apply(await api(method, url, body));
    render();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'iscritti') return { page: 'iscritti' };
  if (parts[0] === 'giornata' && parts[1]) {
    const tab = DAY_TABS.some(([k]) => k === parts[2]) ? parts[2] : null;
    return { page: 'giornata', id: Number(parts[1]), tab };
  }
  return { page: 'home' };
}

// Tab di default di una giornata: quella che corrisponde al suo stato.
function defaultTab(status) {
  return { presenze: 'presenti', gironi: 'gironi', gironi_conclusi: 'classifica-gironi', dirette: 'tabellone', conclusa: 'classifica' }[status];
}

// ---------- Render ----------

async function render() {
  const route = parseRoute();
  document.querySelectorAll('.mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === route.page));
  try {
    if (!T) apply(await api('GET', '/api/tournament'));
    if (route.page === 'giornata' && (!D || D.day.id !== route.id)) apply(await api('GET', `/api/days/${route.id}`));
  } catch (e) {
    app.innerHTML = `<div class="panel empty"><p>${esc(e.message)}</p><p><a href="#/">Torna alla classifica</a></p></div>`;
    return;
  }
  if (route.page === 'iscritti') return viewRoster(app);
  if (route.page === 'giornata') return viewDay(app, route.tab || defaultTab(D.day.status));
  return viewHome(app);
}

// ---------- Home: classifica generale + giornate ----------

function viewHome(el) {
  const lb = T.leaderboard;
  const days = T.days;
  const done = days.filter((d) => d.status === 'conclusa');
  const today = new Date().toISOString().slice(0, 10);
  const ranked = lb.filter((r) => r.presences > 0);
  const top = ranked.filter((r) => r.total > 0 && r.rank <= 3);

  const cell = (r, d) => {
    const x = r.results[d.id];
    if (!x) return '<td class="num muted">–</td>';
    if (x.pending) return '<td class="num muted" title="Giornata in corso">⏳</td>';
    return `<td class="num" title="${x.place}° classificato"><span class="pts p${x.points}">${x.points}</span></td>`;
  };

  el.innerHTML = `
    <section class="panel leaderboard">
      <div class="row">
        <div>
          <h1>🎄 Classifica generale</h1>
          <div class="muted small">${done.length} ${done.length === 1 ? 'giornata conclusa' : 'giornate concluse'} su ${days.length} · ${POINTS_LEGEND}</div>
        </div>
      </div>
      ${top.length ? `<div class="podium mini">${[2, 1, 3].map((p) => {
        const who = top.filter((r) => r.rank === p);
        if (!who.length) return '';
        return `<div class="step p${p}">${who.map((r) => `<div class="who">${esc(fencerName(r))}<div class="club">${esc(r.club)}</div></div>`).join('')}
          <div class="block"><span>${medal(p)}</span><small>${who[0].total} pt</small></div></div>`;
      }).join('')}</div>` : ''}
      ${lb.length ? `
      <div class="table-wrap"><table class="lb">
        <thead><tr><th class="num">Pos</th><th>Tiratore</th><th>Società</th>
          ${days.map((d) => `<th class="num"><a href="#/giornata/${d.id}" title="${esc(fmtDate(d.date))}">G${d.number}</a></th>`).join('')}
          <th class="num">Pres.</th><th class="num">Punti</th></tr></thead>
        <tbody>${lb.map((r) => `
          <tr class="${r.presences ? '' : 'out'} ${r.total && r.rank <= 3 ? `top top${r.rank}` : ''}">
            <td class="num"><strong>${r.presences ? r.rank : ''}</strong> ${r.total ? medal(r.rank) : ''}</td>
            <td>${esc(fencerName(r))}</td><td class="muted">${esc(r.club)}</td>
            ${days.map((d) => cell(r, d)).join('')}
            <td class="num">${r.presences}</td>
            <td class="num total">${r.total}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">A parità di punti conta il miglior rendimento: più vittorie di giornata, poi più secondi posti, poi più terzi, e così via. ⏳ = giornata in corso, – = assente.</p>`
      : `<div class="empty"><img src="logo.svg" alt=""><p>Nessun iscritto al torneo. <a href="#/iscritti">Inserisci l'elenco degli iscritti</a> per cominciare.</p></div>`}
    </section>

    <section class="panel">
      <div class="row">
        <h2>🎁 Giornate</h2>
        <span class="spacer"></span>
        <form id="new-day" class="row">
          <input type="date" name="date" value="${today}" aria-label="Data della giornata" style="width:auto">
          <input name="location" placeholder="Luogo (facoltativo)" aria-label="Luogo" style="width:200px">
          <button class="btn" ${T.fencers.length < 2 ? 'disabled title="Servono almeno 2 iscritti"' : ''}>＋ Nuova giornata</button>
        </form>
      </div>
      ${days.length ? `<div class="day-grid">${days.map((d) => `
        <a class="day-card" href="#/giornata/${d.id}">
          <div class="row"><strong class="day-title">${dayTitle(d)}</strong><span class="spacer"></span><span class="badge ${d.status}">${STATUS_LABEL[d.status]}</span></div>
          <div class="muted small">${esc(fmtDate(d.date)) || 'Data da definire'}${d.location ? ` · ${esc(d.location)}` : ''}</div>
          <div class="small">${d.present} presenti</div>
          ${d.podium ? `<div class="day-podium small">${d.podium.map((r) => `<div>${medal(r.place)} ${esc(fencerName(r))}</div>`).join('')}</div>` : ''}
        </a>`).join('')}</div>`
      : '<div class="empty"><p>Nessuna giornata ancora. Crea la prima giornata, seleziona i presenti e genera i gironi.</p></div>'}
    </section>`;

  el.querySelector('#new-day').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      apply(await api('POST', '/api/days', formData(e.target)));
      toast('Giornata creata: seleziona i presenti');
      location.hash = `#/giornata/${D.day.id}/presenti`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Anagrafica iscritti ----------

function viewRoster(el) {
  const fencers = T.fencers;
  el.innerHTML = `
    <div class="grid grid-fencers">
      <section class="panel">
        <h2>🎅 Iscritti al torneo (${fencers.length})</h2>
        <p class="muted small">Elenco unico di tutti gli iscritti alla XMas Cup. In ogni giornata si scelgono i presenti tra questi nomi. Chi ha già tirato in una giornata non può essere eliminato, ma nome e società si possono sempre correggere.</p>
        ${fencers.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Cognome</th><th>Nome</th><th>Società</th><th class="num">Presenze</th><th></th></tr></thead>
          <tbody>${fencers.map((f, i) => `
            <tr data-id="${f.id}">
              <td class="muted">${i + 1}</td>
              <td><input name="last_name" value="${esc(f.last_name)}" aria-label="Cognome"></td>
              <td><input name="first_name" value="${esc(f.first_name)}" aria-label="Nome"></td>
              <td><input name="club" value="${esc(f.club)}" aria-label="Società"></td>
              <td class="num">${f.presences}</td>
              <td class="row" style="flex-wrap:nowrap">
                <button class="btn secondary small" data-act="save" title="Salva">💾</button>
                ${f.locked ? '' : '<button class="btn danger small" data-act="del" title="Elimina">✕</button>'}
              </td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty"><img src="logo.svg" alt=""><p>Nessun iscritto. Aggiungine qualcuno o importa un elenco.</p></div>'}
      </section>
      <div>
        <section class="panel">
          <h2>Aggiungi iscritto</h2>
          <form id="add-fencer">
            <div class="fields">
              <div class="field"><label for="af-l">Cognome</label><input id="af-l" name="last_name" required></div>
              <div class="field"><label for="af-f">Nome</label><input id="af-f" name="first_name"></div>
            </div>
            <div class="field"><label for="af-c">Società / Sala</label><input id="af-c" name="club" list="clubs"></div>
            ${clubList()}
            <button class="btn">Aggiungi</button>
          </form>
        </section>
        <section class="panel">
          <h2>Importa elenco</h2>
          <p class="muted small">Una riga per tiratore: <code>Cognome; Nome; Società</code> (vanno bene anche virgole o tabulazioni, quindi puoi incollare da Excel).</p>
          <form id="bulk-fencers">
            <textarea name="bulk" placeholder="Rossi; Mario; Scherma Fano&#10;Bianchi; Giulia; Fanum Fortunae"></textarea>
            <div style="margin-top:10px"><button class="btn secondary">Importa</button></div>
          </form>
        </section>
      </div>
    </div>`;

  el.querySelector('#add-fencer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await mutate('POST', '/api/fencers', formData(e.target), 'Iscritto aggiunto')) document.getElementById('af-l')?.focus();
  });
  el.querySelector('#bulk-fencers').addEventListener('submit', (e) => {
    e.preventDefault();
    mutate('POST', '/api/fencers', formData(e.target), 'Elenco importato');
  });
  el.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const save = async () => {
      const body = Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.name, i.value]));
      if (await mutate('PUT', `/api/fencers/${id}`, body, 'Salvato')) D = null; // i nomi compaiono anche nelle giornate
    };
    tr.querySelector('[data-act=save]').addEventListener('click', save);
    tr.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
    tr.querySelector('[data-act=del]')?.addEventListener('click', async () => {
      if (confirm('Eliminare questo iscritto dal torneo?') && await mutate('DELETE', `/api/fencers/${id}`, null, 'Eliminato')) D = null;
    });
  });
}

function clubList() {
  return `<datalist id="clubs">${[...new Set(T.fencers.map((f) => f.club).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
}

// ---------- Giornata ----------

function viewDay(el, tab) {
  const d = D.day;
  const view = {
    presenti: viewPresence,
    gironi: viewPools,
    'classifica-gironi': viewPoolRanking,
    tabellone: viewBracket,
    classifica: viewDayFinal,
  }[tab];

  el.innerHTML = `
    <div class="row">
      <a href="#/" class="muted small">← Classifica generale</a>
    </div>
    <div class="row day-head">
      <h1>${dayTitle(d)}</h1>
      <span class="badge ${d.status}">${STATUS_LABEL[d.status]}</span>
      <span class="muted">${esc(fmtDate(d.date))}${d.location ? ` · ${esc(d.location)}` : ''} · ${D.fencers.length} presenti</span>
      <span class="spacer"></span>
      <button class="btn secondary small" id="edit-day">✏️ Modifica</button>
      <button class="btn danger small" id="del-day">Elimina giornata</button>
    </div>
    <nav class="tabs">${DAY_TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/giornata/${d.id}/${k}">${l}</a>`).join('')}</nav>
    <div id="view"></div>`;

  el.querySelector('#edit-day').addEventListener('click', () => openDayDialog());
  el.querySelector('#del-day').addEventListener('click', async () => {
    if (!confirm(`Eliminare la ${dayTitle(d)} con presenti, gironi, dirette e punti assegnati?`)) return;
    try {
      apply(await api('DELETE', `/api/days/${d.id}`));
      D = null;
      toast('Giornata eliminata');
      location.hash = '#/';
    } catch (e) {
      toast(e.message, true);
    }
  });
  view(document.getElementById('view'));
}

function openDayDialog() {
  const d = D.day;
  dialogForm.innerHTML = `
    <h2>${dayTitle(d)}</h2>
    <div class="field"><label for="dy-d">Data</label><input id="dy-d" type="date" name="date" value="${esc(d.date)}"></div>
    <div class="field"><label for="dy-l">Luogo</label><input id="dy-l" name="location" value="${esc(d.location)}"></div>
    <div class="row" style="margin-top:16px"><span class="spacer"></span>
      <button type="button" class="btn secondary" data-act="cancel">Annulla</button>
      <button type="submit" class="btn">Salva</button></div>`;
  dialogForm.querySelector('[data-act=cancel]').onclick = () => dialog.close();
  dialogForm.onsubmit = async (e) => {
    e.preventDefault();
    if (await mutate('PUT', `/api/days/${d.id}`, formData(dialogForm), 'Giornata aggiornata')) dialog.close();
  };
  dialog.showModal();
}

// Stessa regola del server: gironi da massimo 7, dimensioni che differiscono al più di 1.
function poolSplitText(n) {
  if (n < 2) return 'Servono almeno 2 presenti per formare i gironi.';
  const count = Math.ceil(n / 7);
  const base = Math.floor(n / count);
  const big = n % count;
  const part = (k, size) => `${k} ${k === 1 ? 'girone' : 'gironi'} da ${size}`;
  const parts = [];
  if (count - big) parts.push(part(count - big, base));
  if (big) parts.push(part(big, base + 1));
  return `Con ${n} presenti: ${parts.join(' e ')}.`;
}

// ---------- Presenti ----------

function viewPresence(el) {
  const locked = D.pools.length > 0;
  const present = new Set(D.fencers.map((f) => f.id));
  const roster = T.fencers;

  el.innerHTML = `
    <div class="grid grid-fencers">
      <section class="panel">
        <div class="row">
          <div><h2>Chi è presente oggi?</h2>
            <div class="muted small" id="split"></div></div>
          <span class="spacer"></span>
          <strong class="present-count" id="count"></strong>
        </div>
        ${locked ? '<p class="muted small">🔒 Gironi già generati: per cambiare i presenti elimina prima i gironi.</p>' : ''}
        ${roster.length ? `
        <div class="row" style="margin:12px 0">
          <input type="search" id="filter" placeholder="🔍 Cerca per nome o società" style="flex:1 1 220px">
          ${locked ? '' : `<button class="btn secondary small" id="all">Tutti</button>
          <button class="btn secondary small" id="none">Nessuno</button>`}
        </div>
        <div class="presence-list">${roster.map((f) => `
          <label class="presence ${present.has(f.id) ? 'on' : ''}" data-q="${esc(`${f.last_name} ${f.first_name} ${f.club}`.toLowerCase())}">
            <input type="checkbox" value="${f.id}" ${present.has(f.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span class="nm">${esc(fencerName(f))}</span>
            <span class="muted small">${esc(f.club)}</span>
          </label>`).join('')}</div>
        ${locked ? '' : `<div class="row" style="margin-top:14px"><span class="muted small" id="dirty"></span><span class="spacer"></span>
          <button class="btn" id="save-presence">💾 Salva presenti</button>
          <button class="btn secondary" id="save-go">Salva e genera i gironi 🎲</button></div>`}`
        : '<div class="empty"><p>Nessun iscritto al torneo. <a href="#/iscritti">Inserisci prima l\'elenco degli iscritti</a>.</p></div>'}
      </section>
      <section class="panel">
        <h2>Nuovo iscritto</h2>
        <p class="muted small">Si è presentato qualcuno che non era in elenco? Aggiungilo al torneo: verrà segnato subito come presente.</p>
        <form id="add-present">
          <div class="field"><label for="ap-l">Cognome</label><input id="ap-l" name="last_name" required ${locked ? 'disabled' : ''}></div>
          <div class="field"><label for="ap-f">Nome</label><input id="ap-f" name="first_name" ${locked ? 'disabled' : ''}></div>
          <div class="field"><label for="ap-c">Società / Sala</label><input id="ap-c" name="club" list="clubs" ${locked ? 'disabled' : ''}></div>
          ${clubList()}
          <button class="btn" ${locked ? 'disabled' : ''}>Aggiungi e segna presente</button>
        </form>
      </section>
    </div>`;

  const boxes = [...el.querySelectorAll('.presence input')];
  const selected = () => boxes.filter((b) => b.checked).map((b) => Number(b.value));
  const refresh = () => {
    const n = selected().length;
    el.querySelector('#count').textContent = `${n} / ${roster.length}`;
    el.querySelector('#split').textContent = poolSplitText(n);
    boxes.forEach((b) => b.closest('.presence').classList.toggle('on', b.checked));
    const changed = n !== present.size || selected().some((id) => !present.has(id));
    const dirty = el.querySelector('#dirty');
    if (dirty) dirty.textContent = changed ? '● Modifiche non salvate' : '';
  };
  boxes.forEach((b) => b.addEventListener('change', refresh));
  refresh();

  el.querySelector('#filter')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.presence').forEach((l) => { l.hidden = q && !l.dataset.q.includes(q); });
  });
  const setAll = (v) => { boxes.forEach((b) => { if (!b.closest('.presence').hidden) b.checked = v; }); refresh(); };
  el.querySelector('#all')?.addEventListener('click', () => setAll(true));
  el.querySelector('#none')?.addEventListener('click', () => setAll(false));

  const save = () => mutate('PUT', `/api/days/${D.day.id}/presence`, { fencer_ids: selected() }, 'Presenti salvati');
  el.querySelector('#save-presence')?.addEventListener('click', save);
  el.querySelector('#save-go')?.addEventListener('click', async () => {
    try {
      apply(await api('PUT', `/api/days/${D.day.id}/presence`, { fencer_ids: selected() }));
      apply(await api('POST', `/api/days/${D.day.id}/pools`, {}));
      toast('Gironi generati');
      location.hash = `#/giornata/${D.day.id}/gironi`;
    } catch (e) {
      toast(e.message, true);
      render();
    }
  });

  el.querySelector('#add-present').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Salva anche le spunte correnti, così non si perdono.
    try {
      apply(await api('PUT', `/api/days/${D.day.id}/presence`, { fencer_ids: selected() }));
    } catch (err) {
      return toast(err.message, true);
    }
    if (await mutate('POST', '/api/fencers', { ...formData(e.target), day_id: D.day.id }, 'Iscritto aggiunto e segnato presente')) {
      document.getElementById('ap-l')?.focus();
    }
  });
}

// ---------- Gironi ----------

function viewPools(el) {
  const hasBracket = D.bracket.length > 0;
  const n = D.fencers.length;
  const anyResult = D.pools.some((p) => p.bouts.some((b) => b.winner_id != null));

  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div style="flex: 1 1 420px">
          <h2>Gironi</h2>
          <div class="muted small">Solo i presenti della giornata. Gironi da massimo 7 tiratori, con al più un tiratore di differenza tra un girone e l'altro. Assalti a ${D.day.pool_touches} stoccate. La composizione è casuale e separa il più possibile chi è della stessa società.</div>
        </div>
        <span class="spacer"></span>
        ${hasBracket ? '<span class="muted small">🔒 Tabellone generato: elimina il tabellone per modificare i gironi.</span>' : `
          <button class="btn" id="gen-pools" ${n < 2 ? 'disabled' : ''}>🎲 ${D.pools.length ? 'Rigenera gironi' : 'Genera gironi casuali'}</button>
          ${D.pools.length ? '<button class="btn danger" id="del-pools">Elimina gironi</button>' : ''}`}
      </div>
    </section>
    ${D.pools.length ? `<div class="pool-grid">${D.pools.map((p) => poolCard(p, hasBracket)).join('')}</div>`
      : `<div class="panel empty"><img src="logo.svg" alt=""><p>${n < 2 ? `Servono almeno 2 presenti: <a href="#/giornata/${D.day.id}/presenti">seleziona i presenti</a>.` : `${poolSplitText(n)}<br>Nessun girone ancora: premi “Genera gironi casuali”.`}</p></div>`}
    ${D.poolsDone && !hasBracket ? `<section class="panel row"><span>✅ Tutti gli assalti dei gironi sono conclusi.</span><span class="spacer"></span><a class="btn" href="#/giornata/${D.day.id}/classifica-gironi">Vai alla classifica</a></section>` : ''}`;

  el.querySelector('#gen-pools')?.addEventListener('click', () => {
    if (anyResult && !confirm('Rigenerando i gironi perderai tutti i risultati già inseriti. Continuare?')) return;
    mutate('POST', `/api/days/${D.day.id}/pools`, {}, 'Gironi generati');
  });
  el.querySelector('#del-pools')?.addEventListener('click', () => {
    if (confirm('Eliminare tutti i gironi e i relativi risultati?')) mutate('DELETE', `/api/days/${D.day.id}/pools`, null, 'Gironi eliminati');
  });

  el.querySelectorAll('.bout[data-id]').forEach((row) => wirePoolBout(row));
}

function poolCard(p, locked) {
  const ms = p.members;
  const byId = new Map(ms.map((m) => [m.id, m]));
  const cell = (a, b) => {
    if (a.id === b.id) return '<td class="self"></td>';
    const bout = p.bouts.find((x) => (x.fencer_a === a.id && x.fencer_b === b.id) || (x.fencer_a === b.id && x.fencer_b === a.id));
    if (!bout || bout.winner_id == null) return '<td></td>';
    const mine = bout.fencer_a === a.id ? bout.score_a : bout.score_b;
    // Vittoria a stoccate piene: solo V; vittoria a tempo: V + stoccate; sconfitta: solo le stoccate date.
    if (bout.winner_id !== a.id) return `<td class="d">${mine}</td>`;
    return `<td class="v">V${mine < D.day.pool_touches ? mine : ''}</td>`;
  };
  return `
    <section class="panel">
      <div class="row"><h3>Girone ${p.number}</h3><span class="spacer"></span>
        ${p.done ? '<span class="badge ok">Concluso</span>' : `<span class="muted small">${p.bouts.filter((b) => b.winner_id != null).length}/${p.bouts.length} assalti</span>`}</div>
      <div class="pool-body">
      <div class="table-wrap"><table class="matrix">
        <thead><tr><th></th><th>Tiratore</th>${ms.map((m) => `<th>${m.position}</th>`).join('')}<th>V</th><th>Ind</th><th>TS</th><th>Pos</th></tr></thead>
        <tbody>${ms.map((a) => `
          <tr><th>${a.position}</th>
            <td class="name">${esc(fencerName(a))}<div class="muted small">${esc(a.club)}</div></td>
            ${ms.map((b) => cell(a, b)).join('')}
            <td>${a.v}</td><td>${a.ind > 0 ? '+' : ''}${a.ind}</td><td>${a.ts}</td><td class="pos">${a.m ? a.pool_rank : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="bouts">${p.bouts.map((b) => poolBoutRow(b, byId, locked)).join('')}</div>
      </div>
    </section>`;
}

function poolBoutRow(b, byId, locked) {
  const A = byId.get(b.fencer_a);
  const B = byId.get(b.fencer_b);
  const done = b.winner_id != null;
  const tied = done && b.score_a === b.score_b;
  const max = D.day.pool_touches;
  return `
    <div class="bout ${done ? 'done' : ''}" data-id="${b.id}">
      <span class="n">${b.bout_order}</span>
      <span class="fa ${b.winner_id === A.id ? 'win' : ''}">${A.position}. ${esc(fencerName(A))}</span>
      <input type="number" min="0" max="${max}" inputmode="numeric" name="sa" value="${b.score_a ?? ''}" aria-label="Stoccate ${esc(fencerName(A))}" ${locked ? 'disabled' : ''}>
      <span class="muted">–</span>
      <input type="number" min="0" max="${max}" inputmode="numeric" name="sb" value="${b.score_b ?? ''}" aria-label="Stoccate ${esc(fencerName(B))}" ${locked ? 'disabled' : ''}>
      <span class="${b.winner_id === B.id ? 'win' : ''}">${esc(fencerName(B))} .${B.position}</span>
      <span class="row actions" style="flex-wrap:nowrap">${locked ? '' : `
        <button class="btn small icon" data-act="save" title="Salva risultato">✓</button>
        ${done ? '<button class="btn danger small icon" data-act="clear" title="Cancella risultato">✕</button>' : ''}`}
      </span>
      <div class="prio" ${tied ? '' : 'hidden'}>
        <label class="small">Parità: vincitore alla priorità
          <select name="winner" ${locked ? 'disabled' : ''}>
            <option value="">— scegli —</option>
            <option value="${A.id}" ${tied && b.winner_id === A.id ? 'selected' : ''}>${esc(fencerName(A))}</option>
            <option value="${B.id}" ${tied && b.winner_id === B.id ? 'selected' : ''}>${esc(fencerName(B))}</option>
          </select>
        </label>
      </div>
    </div>`;
}

function wirePoolBout(row) {
  const sa = row.querySelector('[name=sa]');
  const sb = row.querySelector('[name=sb]');
  const prio = row.querySelector('.prio');
  const sel = row.querySelector('[name=winner]');
  const max = D.day.pool_touches;
  const togglePrio = () => { prio.hidden = !(sa.value !== '' && sa.value === sb.value); };
  // Non si possono scrivere più stoccate del limite del girone.
  const clamp = (i) => {
    if (i.value !== '' && Number(i.value) > max) i.value = max;
    if (i.value !== '' && Number(i.value) < 0) i.value = 0;
  };
  [sa, sb].forEach((i) => i.addEventListener('input', () => { clamp(i); togglePrio(); }));
  const save = () => {
    if (sa.value === '' || sb.value === '') return toast('Inserisci entrambi i punteggi', true);
    mutate('PUT', `/api/pool-bouts/${row.dataset.id}`, {
      score_a: Number(sa.value), score_b: Number(sb.value), winner_id: sel.value ? Number(sel.value) : null,
    }, 'Risultato salvato');
  };
  row.querySelector('[data-act=save]')?.addEventListener('click', save);
  [sa, sb].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
  row.querySelector('[data-act=clear]')?.addEventListener('click', () =>
    mutate('PUT', `/api/pool-bouts/${row.dataset.id}`, { score_a: null, score_b: null }, 'Risultato cancellato'));
}

// ---------- Classifica gironi ----------

function viewPoolRanking(el) {
  if (!D.pools.length) {
    el.innerHTML = `<div class="panel empty"><p>Genera prima i gironi.</p></div>`;
    return;
  }
  const hasBracket = D.bracket.length > 0;
  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div>
          <h2>Classifica dopo i gironi</h2>
          <div class="muted small">Ordinata per V/M (vittorie/assalti), poi indice (TS−TR), poi stoccate date. Tutti i presenti passano alle dirette.</div>
        </div>
        <span class="spacer"></span>
        ${hasBracket ? `<a class="btn secondary" href="#/giornata/${D.day.id}/tabellone">Vai al tabellone</a>`
          : `<button class="btn" id="gen-bracket" ${D.poolsDone ? '' : 'disabled'} title="${D.poolsDone ? '' : 'Completa prima tutti gli assalti'}">🗡️ Genera tabellone dirette</button>`}
      </div>
      ${D.poolsDone ? '' : '<p class="muted small">⏳ Classifica provvisoria: ci sono ancora assalti da disputare.</p>'}
      <div class="table-wrap"><table>
        <thead><tr><th class="num">Pos</th><th>Tiratore</th><th>Società</th><th class="num">V</th><th class="num">M</th><th class="num">V/M</th><th class="num">TS</th><th class="num">TR</th><th class="num">Ind</th></tr></thead>
        <tbody>${D.ranking.map((r) => `
          <tr class="${r.qualified ? '' : 'out'}">
            <td class="num"><strong>${r.rank}</strong></td>
            <td>${esc(fencerName(r))}</td><td class="muted">${esc(r.club)}</td>
            <td class="num">${r.v}</td><td class="num">${r.m}</td><td class="num">${r.vm.toFixed(3)}</td>
            <td class="num">${r.ts}</td><td class="num">${r.tr}</td><td class="num">${r.ind > 0 ? '+' : ''}${r.ind}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  el.querySelector('#gen-bracket')?.addEventListener('click', async () => {
    if (await mutate('POST', `/api/days/${D.day.id}/bracket`, {}, 'Tabellone generato')) {
      location.hash = `#/giornata/${D.day.id}/tabellone`;
    }
  });
}

// ---------- Tabellone ----------

function viewBracket(el) {
  if (!D.bracket.length) {
    el.innerHTML = `<div class="panel empty"><img src="logo.svg" alt="">
      <p>Il tabellone non è ancora stato generato.<br>${D.poolsDone ? `Vai alla <a href="#/giornata/${D.day.id}/classifica-gironi">classifica dei gironi</a> per generarlo.` : 'Completa prima tutti gli assalti dei gironi.'}</p></div>`;
    return;
  }
  const byId = new Map(D.fencers.map((f) => [f.id, f]));
  const final = D.bracket.find((r) => r.round === 2)?.bouts[0];
  const champ = final?.winner_id ? byId.get(final.winner_id) : null;

  const side = (b, who) => {
    const fid = b[`fencer_${who}`];
    const f = byId.get(fid);
    const score = b[`score_${who}`];
    const cls = b.winner_id == null || fid == null ? '' : b.winner_id === fid ? 'winner' : 'loser';
    return `<div class="side ${cls}">
      <span class="seed">${f ? b[`seed_${who}`] ?? '' : ''}</span>
      <span class="nm">${f ? esc(fencerName(f)) : b.is_bye ? '<span class="bye">esente</span>' : '<span class="tbd">da definire</span>'}</span>
      <span class="score">${score ?? ''}</span>
    </div>`;
  };

  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div><h2>Tabellone delle dirette</h2>
          <div class="muted small">Assalti a ${D.day.de_touches} stoccate. Clicca un assalto per inserire o correggere il risultato.</div></div>
        <span class="spacer"></span>
        <button class="btn danger" id="del-bracket">Elimina tabellone</button>
      </div>
      ${champ ? `<div class="champion"><div class="trophy">🏆</div><h1>${esc(fencerName(champ))}</h1><div class="muted">${esc(champ.club)}</div>
        <p><a class="btn" href="#/giornata/${D.day.id}/classifica">Classifica e punti della giornata</a></p></div>` : ''}
      <div class="bracket">${D.bracket.map((r) => `
        <div class="round"><h3>${esc(r.label)}</h3>
          <div class="round-bouts">${r.bouts.map((b) => {
            const playable = !b.is_bye && b.fencer_a != null && b.fencer_b != null;
            return `<div class="de ${playable ? '' : 'locked'}" ${playable ? `data-id="${b.id}" tabindex="0" role="button"` : ''}>${side(b, 'a')}${side(b, 'b')}</div>`;
          }).join('')}</div>
        </div>`).join('')}</div>
    </section>`;

  el.querySelector('#del-bracket').addEventListener('click', () => {
    if (confirm('Eliminare il tabellone e tutti i risultati delle dirette?')) mutate('DELETE', `/api/days/${D.day.id}/bracket`, null, 'Tabellone eliminato');
  });
  el.querySelectorAll('.de[data-id]').forEach((node) => {
    const open = () => openDeDialog(Number(node.dataset.id), byId);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function openDeDialog(id, byId) {
  const b = D.bracket.flatMap((r) => r.bouts).find((x) => x.id === id);
  const A = byId.get(b.fencer_a);
  const B = byId.get(b.fencer_b);
  const tied = b.winner_id != null && b.score_a === b.score_b;
  dialogForm.innerHTML = `
    <h2>${esc(D.bracket.find((r) => r.round === b.round).label)}</h2>
    <p class="muted small">Assalto a ${D.day.de_touches} stoccate</p>
    <div class="score-row"><label for="dd-a">(${b.seed_a}) ${esc(fencerName(A))}</label><input id="dd-a" type="number" min="0" name="sa" value="${b.score_a ?? ''}" required></div>
    <div class="score-row"><label for="dd-b">(${b.seed_b}) ${esc(fencerName(B))}</label><input id="dd-b" type="number" min="0" name="sb" value="${b.score_b ?? ''}" required></div>
    <div class="field prio" ${tied ? '' : 'hidden'}>
      <label for="dd-w">Parità: vincitore alla priorità</label>
      <select id="dd-w" name="winner">
        <option value="">— scegli —</option>
        <option value="${A.id}" ${tied && b.winner_id === A.id ? 'selected' : ''}>${esc(fencerName(A))}</option>
        <option value="${B.id}" ${tied && b.winner_id === B.id ? 'selected' : ''}>${esc(fencerName(B))}</option>
      </select>
    </div>
    <div class="row" style="margin-top:16px">
      ${b.winner_id != null ? '<button type="button" class="btn danger" data-act="clear">Cancella risultato</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn secondary" data-act="cancel">Annulla</button>
      <button type="submit" class="btn">Salva</button>
    </div>`;
  const sa = dialogForm.querySelector('[name=sa]');
  const sb = dialogForm.querySelector('[name=sb]');
  const prio = dialogForm.querySelector('.prio');
  const togglePrio = () => { prio.hidden = !(sa.value !== '' && sa.value === sb.value); };
  sa.addEventListener('input', togglePrio);
  sb.addEventListener('input', togglePrio);
  dialogForm.querySelector('[data-act=cancel]').onclick = () => dialog.close();
  const clear = dialogForm.querySelector('[data-act=clear]');
  if (clear) clear.onclick = async () => {
    if (await mutate('PUT', `/api/de-bouts/${id}`, { score_a: null, score_b: null }, 'Risultato cancellato')) dialog.close();
  };
  dialogForm.onsubmit = async (e) => {
    e.preventDefault();
    const w = dialogForm.querySelector('[name=winner]').value;
    const ok = await mutate('PUT', `/api/de-bouts/${id}`, {
      score_a: Number(sa.value), score_b: Number(sb.value), winner_id: w ? Number(w) : null,
    }, 'Risultato salvato');
    if (ok) dialog.close();
  };
  dialog.showModal();
  sa.focus();
  sa.select();
}

// ---------- Classifica della giornata ----------

function viewDayFinal(el) {
  const fr = D.finalRanking;
  if (!fr) {
    el.innerHTML = `<div class="panel empty"><img src="logo.svg" alt=""><p>La classifica della giornata e i punti saranno disponibili al termine della finale.</p><p class="small">${POINTS_LEGEND}</p></div>`;
    return;
  }
  const at = (p) => fr.filter((r) => r.place === p);
  const step = (cls, p, list) => `
    <div class="step ${cls}">
      ${list.map((r) => `<div class="who">${esc(fencerName(r))}<div class="club">${esc(r.club)}</div></div>`).join('')}
      <div class="block"><span>${p}</span><small>+${list[0]?.points ?? ''} pt</small></div>
    </div>`;
  el.innerHTML = `
    <section class="panel">
      <h2>Classifica della ${dayTitle(D.day)}</h2>
      <p class="muted small">${POINTS_LEGEND}</p>
      <div class="podium">${step('p2', 2, at(2))}${step('p1', 1, at(1))}${step('p3', 3, at(3))}</div>
      <div class="table-wrap"><table>
        <thead><tr><th class="num">Pos</th><th>Tiratore</th><th>Società</th><th class="num">Testa di serie</th><th class="num">Punti</th></tr></thead>
        <tbody>${fr.map((r) => `<tr><td class="num"><strong>${r.place}</strong> ${medal(r.place)}</td><td>${esc(fencerName(r))}</td><td class="muted">${esc(r.club)}</td>
          <td class="num">${D.ranking.findIndex((x) => x.id === r.id) + 1}</td>
          <td class="num"><span class="pts p${r.points}">+${r.points}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="row" style="margin-top:14px">
        <button class="btn secondary" onclick="window.print()">🖨️ Stampa</button>
        <a class="btn" href="#/">🏆 Classifica generale</a>
      </div>
    </section>`;
}

window.addEventListener('hashchange', render);
render();
