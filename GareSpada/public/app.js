'use strict';

const app = document.getElementById('app');
const dialog = document.getElementById('bout-dialog');
const dialogForm = document.getElementById('bout-form');
let current = null; // dati completi della competizione aperta

const STATUS_LABEL = {
  iscrizioni: 'Iscrizioni aperte',
  gironi: 'Gironi in corso',
  gironi_conclusi: 'Gironi conclusi',
  dirette: 'Dirette in corso',
  conclusa: 'Conclusa',
};

const TABS = [
  ['partecipanti', 'Partecipanti'],
  ['gironi', 'Gironi'],
  ['classifica-gironi', 'Classifica gironi'],
  ['tabellone', 'Tabellone dirette'],
  ['classifica', 'Classifica finale'],
  ['impostazioni', 'Impostazioni'],
];

// ---------- Utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fencerName(f) {
  if (!f) return '';
  return `${f.last_name.toUpperCase()} ${f.first_name || ''}`.trim();
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, g] = d.split('-');
  return g ? `${g}/${m}/${y}` : d;
}

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

// Esegue una modifica e ridisegna la competizione con i dati aggiornati.
async function mutate(method, url, body, okMsg) {
  try {
    const data = await api(method, url, body);
    if (data.competition) current = data;
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

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'c' && parts[1]) return { id: Number(parts[1]), tab: parts[2] || 'partecipanti' };
  return { id: null };
}

// ---------- Home ----------

async function renderHome() {
  let list = [];
  try {
    list = await api('GET', '/api/competitions');
  } catch (e) {
    toast(e.message, true);
  }
  app.innerHTML = `
    <div class="grid grid-2">
      <section class="panel">
        <h1>Nuova competizione</h1>
        <form id="new-comp">
          <div class="field"><label for="nc-name">Nome</label>
            <input id="nc-name" name="name" required placeholder="Es. Spada della Notte delle Streghe"></div>
          <div class="fields">
            <div class="field"><label for="nc-date">Data</label><input id="nc-date" type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div class="field"><label for="nc-loc">Luogo</label><input id="nc-loc" name="location" placeholder="Palestra, città"></div>
          </div>
          ${settingsFields({ pool_max_size: 7, pool_touches: 5, de_touches: 15, qualify_percent: 100 })}
          <button class="btn" type="submit">🎃 Crea competizione</button>
        </form>
      </section>
      <section class="panel">
        <h2>Competizioni</h2>
        ${list.length ? `<div class="cards">${list.map((c) => `
          <a class="comp-card" href="#/c/${c.id}">
            <h3>${esc(c.name)}</h3>
            <div class="muted small">${esc(fmtDate(c.date))}${c.location ? ` · ${esc(c.location)}` : ''}</div>
            <div class="row" style="margin-top:10px">
              <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
              <span class="muted small">${c.fencer_count} tiratori</span>
            </div>
          </a>`).join('')}</div>`
        : `<div class="empty"><img src="mosciolino.svg" alt=""><p>Nessuna competizione ancora.<br>Il mosciolino aspetta i suoi spadisti…</p></div>`}
      </section>
    </div>`;

  document.getElementById('new-comp').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('POST', '/api/competitions', formData(e.target));
      location.hash = `#/c/${data.competition.id}/partecipanti`;
      toast('Competizione creata');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function settingsFields(c) {
  return `
    <div class="fields">
      <div class="field"><label for="sf-ps">Max tiratori per girone</label>
        <input id="sf-ps" type="number" min="3" max="12" name="pool_max_size" value="${c.pool_max_size}"></div>
      <div class="field"><label for="sf-pt">Stoccate gironi</label>
        <input id="sf-pt" type="number" min="1" max="15" name="pool_touches" value="${c.pool_touches}"></div>
      <div class="field"><label for="sf-dt">Stoccate dirette</label>
        <input id="sf-dt" type="number" min="1" max="45" name="de_touches" value="${c.de_touches}"></div>
      <div class="field"><label for="sf-q">% qualificati alle dirette</label>
        <input id="sf-q" type="number" min="1" max="100" name="qualify_percent" value="${c.qualify_percent}"></div>
    </div>`;
}

// ---------- Competizione ----------

async function loadCompetition(id) {
  try {
    current = await api('GET', `/api/competitions/${id}`);
  } catch (e) {
    current = null;
    app.innerHTML = `<div class="panel empty"><p>${esc(e.message)}</p><a href="#/">Torna alle competizioni</a></div>`;
    return;
  }
  render();
}

function render() {
  const r = route();
  if (!r.id) return renderHome();
  if (!current || current.competition.id !== r.id) return loadCompetition(r.id);
  const c = current.competition;
  const view = {
    partecipanti: viewFencers,
    gironi: viewPools,
    'classifica-gironi': viewPoolRanking,
    tabellone: viewBracket,
    classifica: viewFinal,
    impostazioni: viewSettings,
  }[r.tab] || viewFencers;

  app.innerHTML = `
    <a href="#/" class="small">← Tutte le competizioni</a>
    <div class="comp-head" style="margin-top:10px">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="muted">${esc(fmtDate(c.date))}${c.location ? ` · ${esc(c.location)}` : ''} · ${current.fencers.length} tiratori</div>
      </div>
      <span class="spacer"></span>
      <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
    </div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a class="tab ${k === r.tab ? 'active' : ''}" href="#/c/${c.id}/${k}">${l}</a>`).join('')}</nav>
    <div id="view"></div>`;
  view(document.getElementById('view'));
}

// ---------- Partecipanti ----------

function viewFencers(el) {
  const locked = current.pools.length > 0;
  const cid = current.competition.id;
  el.innerHTML = `
    <div class="grid grid-2">
      <section class="panel">
        <h2>Iscritti (${current.fencers.length})</h2>
        ${locked ? '<p class="muted small">🔒 Gironi già generati: puoi correggere nomi e società, ma per aggiungere o togliere tiratori elimina prima i gironi.</p>' : ''}
        ${current.fencers.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Cognome</th><th>Nome</th><th>Società</th><th></th></tr></thead>
          <tbody>${current.fencers.map((f, i) => `
            <tr data-id="${f.id}">
              <td class="muted">${i + 1}</td>
              <td><input name="last_name" value="${esc(f.last_name)}" aria-label="Cognome"></td>
              <td><input name="first_name" value="${esc(f.first_name)}" aria-label="Nome"></td>
              <td><input name="club" value="${esc(f.club)}" aria-label="Società"></td>
              <td class="row" style="flex-wrap:nowrap">
                <button class="btn secondary small" data-act="save" title="Salva">💾</button>
                ${locked ? '' : '<button class="btn danger small" data-act="del" title="Elimina">✕</button>'}
              </td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty"><p>Nessun partecipante. Aggiungine qualcuno!</p></div>'}
      </section>
      <div>
        <section class="panel">
          <h2>Aggiungi partecipante</h2>
          <form id="add-fencer">
            <div class="fields">
              <div class="field"><label for="af-l">Cognome</label><input id="af-l" name="last_name" required ${locked ? 'disabled' : ''}></div>
              <div class="field"><label for="af-f">Nome</label><input id="af-f" name="first_name" ${locked ? 'disabled' : ''}></div>
            </div>
            <div class="field"><label for="af-c">Società / Sala</label><input id="af-c" name="club" list="clubs" ${locked ? 'disabled' : ''}></div>
            <datalist id="clubs">${[...new Set(current.fencers.map((f) => f.club).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
            <button class="btn" ${locked ? 'disabled' : ''}>Aggiungi</button>
          </form>
        </section>
        <section class="panel">
          <h2>Importa elenco</h2>
          <p class="muted small">Una riga per tiratore: <code>Cognome; Nome; Società</code> (vanno bene anche virgole o tabulazioni, quindi puoi incollare da Excel).</p>
          <form id="bulk-fencers">
            <textarea name="bulk" placeholder="Rossi; Mario; Club Scherma Ancona&#10;Bianchi; Giulia; Fanum Fortunae" ${locked ? 'disabled' : ''}></textarea>
            <div style="margin-top:10px"><button class="btn secondary" ${locked ? 'disabled' : ''}>Importa</button></div>
          </form>
        </section>
      </div>
    </div>`;

  el.querySelector('#add-fencer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await mutate('POST', `/api/competitions/${cid}/fencers`, formData(e.target), 'Partecipante aggiunto')) {
      document.getElementById('af-l')?.focus();
    }
  });
  el.querySelector('#bulk-fencers').addEventListener('submit', (e) => {
    e.preventDefault();
    mutate('POST', `/api/competitions/${cid}/fencers`, formData(e.target), 'Elenco importato');
  });
  el.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const save = () => {
      const body = Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.name, i.value]));
      mutate('PUT', `/api/fencers/${id}`, body, 'Salvato');
    };
    tr.querySelector('[data-act=save]').addEventListener('click', save);
    tr.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
    tr.querySelector('[data-act=del]')?.addEventListener('click', () => {
      if (confirm('Eliminare questo partecipante?')) mutate('DELETE', `/api/fencers/${id}`, null, 'Eliminato');
    });
  });
}

// ---------- Gironi ----------

function viewPools(el) {
  const cid = current.competition.id;
  const hasBracket = current.bracket.length > 0;
  const n = current.fencers.length;
  const anyResult = current.pools.some((p) => p.bouts.some((b) => b.winner_id != null));

  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div>
          <h2>Gironi</h2>
          <div class="muted small">Gironi da massimo ${current.competition.pool_max_size} tiratori, assalti a ${current.competition.pool_touches} stoccate. La composizione è casuale e cerca di separare chi è della stessa società.</div>
        </div>
        <span class="spacer"></span>
        ${hasBracket ? '<span class="muted small">🔒 Tabellone generato: elimina il tabellone per modificare i gironi.</span>' : `
          <button class="btn" id="gen-pools" ${n < 2 ? 'disabled' : ''}>🎲 ${current.pools.length ? 'Rigenera gironi' : 'Genera gironi casuali'}</button>
          ${current.pools.length ? '<button class="btn danger" id="del-pools">Elimina gironi</button>' : ''}`}
      </div>
    </section>
    ${current.pools.length ? `<div class="pool-grid">${current.pools.map((p) => poolCard(p, hasBracket)).join('')}</div>`
      : `<div class="panel empty"><img src="mosciolino.svg" alt=""><p>${n < 2 ? 'Servono almeno 2 partecipanti.' : 'Nessun girone ancora: premi “Genera gironi casuali”.'}</p></div>`}
    ${current.poolsDone && !hasBracket ? `<section class="panel row"><span>✅ Tutti gli assalti dei gironi sono conclusi.</span><span class="spacer"></span><a class="btn" href="#/c/${cid}/classifica-gironi">Vai alla classifica</a></section>` : ''}`;

  el.querySelector('#gen-pools')?.addEventListener('click', () => {
    if (anyResult && !confirm('Rigenerando i gironi perderai tutti i risultati già inseriti. Continuare?')) return;
    mutate('POST', `/api/competitions/${cid}/pools`, {}, 'Gironi generati');
  });
  el.querySelector('#del-pools')?.addEventListener('click', () => {
    if (confirm('Eliminare tutti i gironi e i relativi risultati?')) mutate('DELETE', `/api/competitions/${cid}/pools`, null, 'Gironi eliminati');
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
    const won = bout.winner_id === a.id;
    return `<td class="${won ? 'v' : 'd'}">${won ? 'V' : 'D'}${mine}</td>`;
  };
  return `
    <section class="panel">
      <div class="row"><h3>Girone ${p.number}</h3><span class="spacer"></span>
        ${p.done ? '<span class="badge ok">Concluso</span>' : `<span class="muted small">${p.bouts.filter((b) => b.winner_id != null).length}/${p.bouts.length} assalti</span>`}</div>
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
    </section>`;
}

function poolBoutRow(b, byId, locked) {
  const A = byId.get(b.fencer_a);
  const B = byId.get(b.fencer_b);
  const done = b.winner_id != null;
  const tied = done && b.score_a === b.score_b;
  return `
    <div class="bout ${done ? 'done' : ''}" data-id="${b.id}" data-a="${A.id}" data-b="${B.id}">
      <span class="n">${b.bout_order}</span>
      <span class="fa ${b.winner_id === A.id ? 'win' : ''}">${A.position}. ${esc(fencerName(A))}</span>
      <input type="number" min="0" inputmode="numeric" name="sa" value="${b.score_a ?? ''}" aria-label="Stoccate ${esc(fencerName(A))}" ${locked ? 'disabled' : ''}>
      <span class="muted">–</span>
      <input type="number" min="0" inputmode="numeric" name="sb" value="${b.score_b ?? ''}" aria-label="Stoccate ${esc(fencerName(B))}" ${locked ? 'disabled' : ''}>
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
  const togglePrio = () => { prio.hidden = !(sa.value !== '' && sa.value === sb.value); };
  sa.addEventListener('input', togglePrio);
  sb.addEventListener('input', togglePrio);
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
  const cid = current.competition.id;
  if (!current.pools.length) {
    el.innerHTML = '<div class="panel empty"><p>Genera prima i gironi.</p></div>';
    return;
  }
  const hasBracket = current.bracket.length > 0;
  const q = current.ranking.filter((r) => r.qualified).length;
  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div>
          <h2>Classifica dopo i gironi</h2>
          <div class="muted small">Ordinata per V/M (vittorie/assalti), poi indice (TS−TR), poi stoccate date. Qualificati alle dirette: ${q} su ${current.ranking.length} (${current.competition.qualify_percent}%).</div>
        </div>
        <span class="spacer"></span>
        ${hasBracket ? `<a class="btn secondary" href="#/c/${cid}/tabellone">Vai al tabellone</a>`
          : `<button class="btn" id="gen-bracket" ${current.poolsDone ? '' : 'disabled'} title="${current.poolsDone ? '' : 'Completa prima tutti gli assalti'}">🗡️ Genera tabellone dirette</button>`}
      </div>
      ${current.poolsDone ? '' : '<p class="muted small">⏳ Classifica provvisoria: ci sono ancora assalti da disputare.</p>'}
      <div class="table-wrap"><table>
        <thead><tr><th class="num">Pos</th><th>Tiratore</th><th>Società</th><th class="num">V</th><th class="num">M</th><th class="num">V/M</th><th class="num">TS</th><th class="num">TR</th><th class="num">Ind</th><th></th></tr></thead>
        <tbody>${current.ranking.map((r) => `
          <tr class="${r.qualified ? '' : 'out'}">
            <td class="num"><strong>${r.rank}</strong></td>
            <td>${esc(fencerName(r))}</td><td class="muted">${esc(r.club)}</td>
            <td class="num">${r.v}</td><td class="num">${r.m}</td><td class="num">${r.vm.toFixed(3)}</td>
            <td class="num">${r.ts}</td><td class="num">${r.tr}</td><td class="num">${r.ind > 0 ? '+' : ''}${r.ind}</td>
            <td>${r.qualified ? '<span class="badge ok">Qualificato</span>' : '<span class="badge">Eliminato</span>'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  el.querySelector('#gen-bracket')?.addEventListener('click', async () => {
    if (await mutate('POST', `/api/competitions/${cid}/bracket`, {}, 'Tabellone generato')) {
      location.hash = `#/c/${cid}/tabellone`;
    }
  });
}

// ---------- Tabellone ----------

function viewBracket(el) {
  const cid = current.competition.id;
  if (!current.bracket.length) {
    el.innerHTML = `<div class="panel empty"><img src="mosciolino.svg" alt="">
      <p>Il tabellone non è ancora stato generato.<br>${current.poolsDone ? `Vai alla <a href="#/c/${cid}/classifica-gironi">classifica dei gironi</a> per generarlo.` : 'Completa prima tutti gli assalti dei gironi.'}</p></div>`;
    return;
  }
  const byId = new Map(current.fencers.map((f) => [f.id, f]));
  const final = current.bracket.find((r) => r.round === 2)?.bouts[0];
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
          <div class="muted small">Assalti a ${current.competition.de_touches} stoccate. Clicca un assalto per inserire o correggere il risultato.</div></div>
        <span class="spacer"></span>
        <button class="btn danger" id="del-bracket">Elimina tabellone</button>
      </div>
      ${champ ? `<div class="champion"><div class="trophy">🏆</div><h1>${esc(fencerName(champ))}</h1><div class="muted">${esc(champ.club)}</div></div>` : ''}
      <div class="bracket">${current.bracket.map((r) => `
        <div class="round"><h3>${esc(r.label)}</h3>
          <div class="round-bouts">${r.bouts.map((b) => {
            const playable = !b.is_bye && b.fencer_a != null && b.fencer_b != null;
            return `<div class="de ${playable ? '' : 'locked'}" ${playable ? `data-id="${b.id}" tabindex="0" role="button"` : ''}>${side(b, 'a')}${side(b, 'b')}</div>`;
          }).join('')}</div>
        </div>`).join('')}</div>
    </section>`;

  el.querySelector('#del-bracket').addEventListener('click', () => {
    if (confirm('Eliminare il tabellone e tutti i risultati delle dirette?')) mutate('DELETE', `/api/competitions/${cid}/bracket`, null, 'Tabellone eliminato');
  });
  el.querySelectorAll('.de[data-id]').forEach((d) => {
    const open = () => openDeDialog(Number(d.dataset.id), byId);
    d.addEventListener('click', open);
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function openDeDialog(id, byId) {
  const b = current.bracket.flatMap((r) => r.bouts).find((x) => x.id === id);
  const A = byId.get(b.fencer_a);
  const B = byId.get(b.fencer_b);
  const tied = b.winner_id != null && b.score_a === b.score_b;
  dialogForm.innerHTML = `
    <h2>${esc(current.bracket.find((r) => r.round === b.round).label)}</h2>
    <p class="muted small">Assalto a ${current.competition.de_touches} stoccate</p>
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

// ---------- Classifica finale ----------

function viewFinal(el) {
  const fr = current.finalRanking;
  if (!fr) {
    el.innerHTML = `<div class="panel empty"><img src="mosciolino.svg" alt=""><p>La classifica finale sarà disponibile al termine della finale.</p></div>`;
    return;
  }
  const at = (p) => fr.filter((r) => r.place === p);
  const step = (cls, p, list) => `
    <div class="step ${cls}">
      ${list.map((r) => `<div class="who">${esc(fencerName(r))}<div class="club">${esc(r.club)}</div></div>`).join('')}
      <div class="block">${p}</div>
    </div>`;
  el.innerHTML = `
    <section class="panel">
      <h2>Classifica finale</h2>
      <div class="podium">${step('p2', 2, at(2))}${step('p1', 1, at(1))}${step('p3', 3, at(3))}</div>
      <div class="table-wrap"><table>
        <thead><tr><th class="num">Pos</th><th>Tiratore</th><th>Società</th><th class="num">Testa di serie</th></tr></thead>
        <tbody>${fr.map((r) => `<tr><td class="num"><strong>${r.place}</strong></td><td>${esc(fencerName(r))}</td><td class="muted">${esc(r.club)}</td>
          <td class="num">${current.ranking.findIndex((x) => x.id === r.id) + 1}</td></tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:14px"><button class="btn secondary" onclick="window.print()">🖨️ Stampa</button></div>
    </section>`;
}

// ---------- Impostazioni ----------

function viewSettings(el) {
  const c = current.competition;
  el.innerHTML = `
    <section class="panel">
      <h2>Impostazioni competizione</h2>
      <form id="settings">
        <div class="field"><label for="s-name">Nome</label><input id="s-name" name="name" value="${esc(c.name)}" required></div>
        <div class="fields">
          <div class="field"><label for="s-date">Data</label><input id="s-date" type="date" name="date" value="${esc(c.date)}"></div>
          <div class="field"><label for="s-loc">Luogo</label><input id="s-loc" name="location" value="${esc(c.location)}"></div>
        </div>
        ${settingsFields(c)}
        <div class="field"><label for="s-notes">Note</label><textarea id="s-notes" name="notes" style="font-family:inherit">${esc(c.notes)}</textarea></div>
        <p class="muted small">La dimensione dei gironi si applica alla prossima generazione; la percentuale di qualificati al prossimo tabellone generato.</p>
        <div class="row"><button class="btn">Salva</button><span class="spacer"></span><button type="button" class="btn danger" id="del-comp">Elimina competizione</button></div>
      </form>
    </section>`;
  el.querySelector('#settings').addEventListener('submit', (e) => {
    e.preventDefault();
    mutate('PUT', `/api/competitions/${c.id}`, formData(e.target), 'Impostazioni salvate');
  });
  el.querySelector('#del-comp').addEventListener('click', async () => {
    if (!confirm(`Eliminare definitivamente “${c.name}” con tutti i dati?`)) return;
    try {
      await api('DELETE', `/api/competitions/${c.id}`);
      current = null;
      location.hash = '#/';
      toast('Competizione eliminata');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

window.addEventListener('hashchange', render);
render();
