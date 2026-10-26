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
  ['iscrizioni', 'Iscrizioni'],
  ['gironi', 'Gironi'],
  ['classifica-gironi', 'Classifica gironi'],
  ['tabellone', 'Tabellone dirette'],
  ['classifica', 'Classifica finale'],
];

// ---------- Utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fencerName(f) {
  if (!f) return '';
  return `${f.last_name.toUpperCase()} ${f.first_name || ''}`.trim();
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

function currentTab() {
  const tab = location.hash.replace(/^#\/?/, '');
  return TABS.some(([k]) => k === tab) ? tab : 'iscrizioni';
}

// ---------- Competizione ----------

async function loadCompetition() {
  try {
    current = await api('GET', '/api/competition');
  } catch (e) {
    app.innerHTML = `<div class="panel empty"><p>${esc(e.message)}</p></div>`;
    return;
  }
  render();
}

function render() {
  if (!current) return loadCompetition();
  const tab = currentTab();
  const c = current.competition;
  const view = {
    iscrizioni: viewFencers,
    gironi: viewPools,
    'classifica-gironi': viewPoolRanking,
    tabellone: viewBracket,
    classifica: viewFinal,
  }[tab];

  app.innerHTML = `
    <div class="row">
      <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
      <span class="muted">${current.fencers.length} iscritti</span>
    </div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/${k}">${l}</a>`).join('')}</nav>
    <div id="view"></div>`;
  view(document.getElementById('view'));
}

// ---------- Iscrizioni ----------

// Stessa regola del server: gironi da massimo 7, dimensioni che differiscono al più di 1.
function poolSplitText(n) {
  if (n < 2) return '';
  const count = Math.ceil(n / 7);
  const base = Math.floor(n / count);
  const big = n % count;
  const part = (k, size) => `${k} ${k === 1 ? 'girone' : 'gironi'} da ${size}`;
  const parts = [];
  if (count - big) parts.push(part(count - big, base));
  if (big) parts.push(part(big, base + 1));
  return `Con ${n} iscritti: ${parts.join(' e ')}.`;
}

function viewFencers(el) {
  const locked = current.pools.length > 0;
  el.innerHTML = `
    <div class="grid grid-fencers">
      <section class="panel">
        <h2>Iscritti (${current.fencers.length})</h2>
        ${locked ? '' : `<p class="muted small">${poolSplitText(current.fencers.length)}</p>`}
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
    if (await mutate('POST', '/api/fencers', formData(e.target), 'Partecipante aggiunto')) {
      document.getElementById('af-l')?.focus();
    }
  });
  el.querySelector('#bulk-fencers').addEventListener('submit', (e) => {
    e.preventDefault();
    mutate('POST', '/api/fencers', formData(e.target), 'Elenco importato');
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
  const hasBracket = current.bracket.length > 0;
  const n = current.fencers.length;
  const anyResult = current.pools.some((p) => p.bouts.some((b) => b.winner_id != null));

  el.innerHTML = `
    <section class="panel">
      <div class="row">
        <div style="flex: 1 1 420px">
          <h2>Gironi</h2>
          <div class="muted small">Gironi da massimo 7 tiratori, con al più un tiratore di differenza tra un girone e l'altro. Assalti a ${current.competition.pool_touches} stoccate. La composizione è casuale e separa il più possibile chi è della stessa società.</div>
        </div>
        <span class="spacer"></span>
        ${hasBracket ? '<span class="muted small">🔒 Tabellone generato: elimina il tabellone per modificare i gironi.</span>' : `
          <button class="btn" id="gen-pools" ${n < 2 ? 'disabled' : ''}>🎲 ${current.pools.length ? 'Rigenera gironi' : 'Genera gironi casuali'}</button>
          ${current.pools.length ? '<button class="btn danger" id="del-pools">Elimina gironi</button>' : ''}`}
      </div>
    </section>
    ${current.pools.length ? `<div class="pool-grid">${current.pools.map((p) => poolCard(p, hasBracket)).join('')}</div>`
      : `<div class="panel empty"><img src="mosciolino.svg" alt=""><p>${n < 2 ? 'Servono almeno 2 partecipanti.' : 'Nessun girone ancora: premi “Genera gironi casuali”.'}</p></div>`}
    ${current.poolsDone && !hasBracket ? `<section class="panel row"><span>✅ Tutti gli assalti dei gironi sono conclusi.</span><span class="spacer"></span><a class="btn" href="#/classifica-gironi">Vai alla classifica</a></section>` : ''}`;

  el.querySelector('#gen-pools')?.addEventListener('click', () => {
    if (anyResult && !confirm('Rigenerando i gironi perderai tutti i risultati già inseriti. Continuare?')) return;
    mutate('POST', '/api/pools', {}, 'Gironi generati');
  });
  el.querySelector('#del-pools')?.addEventListener('click', () => {
    if (confirm('Eliminare tutti i gironi e i relativi risultati?')) mutate('DELETE', '/api/pools', null, 'Gironi eliminati');
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
    return `<td class="v">V${mine < current.competition.pool_touches ? mine : ''}</td>`;
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
  return `
    <div class="bout ${done ? 'done' : ''}" data-id="${b.id}" data-a="${A.id}" data-b="${B.id}">
      <span class="n">${b.bout_order}</span>
      <span class="fa ${b.winner_id === A.id ? 'win' : ''}">${A.position}. ${esc(fencerName(A))}</span>
      <input type="number" min="0" max="${current.competition.pool_touches}" inputmode="numeric" name="sa" value="${b.score_a ?? ''}" aria-label="Stoccate ${esc(fencerName(A))}" ${locked ? 'disabled' : ''}>
      <span class="muted">–</span>
      <input type="number" min="0" max="${current.competition.pool_touches}" inputmode="numeric" name="sb" value="${b.score_b ?? ''}" aria-label="Stoccate ${esc(fencerName(B))}" ${locked ? 'disabled' : ''}>
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
  const max = current.competition.pool_touches;
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
        ${hasBracket ? `<a class="btn secondary" href="#/tabellone">Vai al tabellone</a>`
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
    if (await mutate('POST', '/api/bracket', {}, 'Tabellone generato')) {
      location.hash = `#/tabellone`;
    }
  });
}

// ---------- Tabellone ----------

function viewBracket(el) {
  if (!current.bracket.length) {
    el.innerHTML = `<div class="panel empty"><img src="mosciolino.svg" alt="">
      <p>Il tabellone non è ancora stato generato.<br>${current.poolsDone ? `Vai alla <a href="#/classifica-gironi">classifica dei gironi</a> per generarlo.` : 'Completa prima tutti gli assalti dei gironi.'}</p></div>`;
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
    if (confirm('Eliminare il tabellone e tutti i risultati delle dirette?')) mutate('DELETE', '/api/bracket', null, 'Tabellone eliminato');
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

window.addEventListener('hashchange', render);
render();
