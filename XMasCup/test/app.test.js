const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../db');
const { createApp } = require('../server');
const T = require('../lib/tournament');

test('le tabelle dell\'ordine degli assalti coprono ogni coppia una sola volta', () => {
  for (let n = 2; n <= 12; n++) {
    const order = T.boutOrder(n);
    const pairs = new Set(order.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    assert.equal(order.length, (n * (n - 1)) / 2, `girone da ${n}`);
    assert.equal(pairs.size, order.length, `girone da ${n}`);
  }
});

test('i gironi sono bilanciati e separano le società quando possibile', () => {
  const fencers = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, club: `Club ${i % 4}` }));
  const pools = T.generatePools(fencers, 7);
  assert.deepEqual(pools.map((p) => p.length).sort(), [6, 7, 7]);
  assert.equal(new Set(pools.flat().map((f) => f.id)).size, 20);
  for (const p of pools) {
    const counts = {};
    p.forEach((f) => { counts[f.club] = (counts[f.club] || 0) + 1; });
    assert.ok(Math.max(...Object.values(counts)) <= 2, 'massimo 2 per società in un girone');
  }
});

test('gironi da massimo 7 con al più 1 tiratore di differenza', () => {
  const sizes = (n) => T.generatePools(Array.from({ length: n }, (_, i) => ({ id: i })), T.POOL_MAX_SIZE)
    .map((p) => p.length).sort();
  assert.deepEqual(sizes(30), [6, 6, 6, 6, 6]);
  assert.deepEqual(sizes(32), [6, 6, 6, 7, 7]);
  for (let n = 2; n <= 80; n++) {
    const s = sizes(n);
    assert.ok(Math.max(...s) <= 7 && Math.max(...s) - Math.min(...s) <= 1, `${n} iscritti: ${s}`);
    assert.equal(s.length, Math.ceil(n / 7));
  }
});

test('teste di serie del tabellone', () => {
  assert.deepEqual(T.seedPositions(8), [1, 8, 5, 4, 3, 6, 7, 2]);
  assert.equal(T.bracketSize(9), 16);
});

test('validazione dei punteggi', () => {
  const base = { fencerA: 1, fencerB: 2, maxTouches: 5 };
  assert.equal(T.resolveWinner({ ...base, scoreA: 5, scoreB: 3 }), 1);
  assert.equal(T.resolveWinner({ ...base, scoreA: 2, scoreB: 2, winnerId: 2 }), 2);
  assert.throws(() => T.resolveWinner({ ...base, scoreA: 2, scoreB: 2 }), /priorità/);
  assert.throws(() => T.resolveWinner({ ...base, scoreA: 5, scoreB: 5, winnerId: 1 }));
  assert.throws(() => T.resolveWinner({ ...base, scoreA: 6, scoreB: 1 }));
});

test('punti di giornata', () => {
  assert.deepEqual([1, 2, 3, 5, 8, 9, 17].map(T.dayPoints), [10, 7, 5, 3, 3, 1, 1]);
  assert.equal(T.dayPoints(null), 0);
});

function client(t) {
  const db = open(':memory:');
  const server = createApp(db).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
}

// Gioca un'intera giornata: vince sempre il tiratore con l'id più basso.
async function playDay(call, dayId) {
  let { data } = await call('POST', `/days/${dayId}/pools`, {});
  for (const b of data.pools.flatMap((p) => p.bouts)) {
    const aWins = b.fencer_a < b.fencer_b;
    const r = await call('PUT', `/pool-bouts/${b.id}`, { score_a: aWins ? 5 : 2, score_b: aWins ? 2 : 5 });
    assert.equal(r.status, 200, r.data.error);
    data = r.data;
  }
  assert.equal(data.day.status, 'gironi_conclusi');
  ({ data } = await call('POST', `/days/${dayId}/bracket`, {}));
  for (let guard = 0; guard < 20 && data.day.status !== 'conclusa'; guard++) {
    for (const b of data.bracket.flatMap((r) => r.bouts).filter((x) => !x.is_bye && x.winner_id == null && x.fencer_a && x.fencer_b)) {
      const aWins = b.fencer_a < b.fencer_b;
      const r = await call('PUT', `/de-bouts/${b.id}`, { score_a: aWins ? 15 : 9, score_b: aWins ? 9 : 15 });
      assert.equal(r.status, 200, r.data.error);
      data = r.data;
    }
  }
  assert.equal(data.day.status, 'conclusa');
  return data;
}

test('torneo a giornate: presenti, gironi, dirette, punti e classifica generale', async (t) => {
  const call = client(t);
  let { data } = await call('GET', '/tournament');
  assert.equal(data.tournament.name, 'Fanum Fortunae XMas Cup');

  const bulk = Array.from({ length: 12 }, (_, i) => `Cognome${String(i).padStart(2, '0')}; Nome${i}; Club${i % 3}`).join('\n');
  ({ data } = await call('POST', '/fencers', { bulk }));
  const roster = data.tournament.fencers;
  assert.equal(roster.length, 12);
  const ids = roster.map((f) => f.id).sort((a, b) => a - b);

  // Giornata 1: presenti i primi 11.
  ({ data } = await call('POST', '/days', { date: '2026-12-06', location: 'Fano' }));
  const d1 = data.day.id;
  assert.equal(data.day.number, 1);
  assert.equal(data.day.status, 'presenze');
  assert.equal((await call('POST', `/days/${d1}/pools`, {})).status, 400); // nessun presente
  ({ data } = await call('PUT', `/days/${d1}/presence`, { fencer_ids: ids.slice(0, 11) }));
  assert.equal(data.fencers.length, 11);
  assert.equal((await call('PUT', `/days/${d1}/presence`, { fencer_ids: [9999] })).status, 400);

  data = await playDay(call, d1);
  assert.equal(data.pools.flatMap((p) => p.members).length, 11, 'solo i presenti nei gironi');
  const fr = data.finalRanking;
  assert.deepEqual(fr.map((r) => r.place), [1, 2, 3, 3, 5, 5, 5, 5, 9, 9, 9]);
  assert.deepEqual(fr.map((r) => r.points), [10, 7, 5, 5, 3, 3, 3, 3, 1, 1, 1]);
  assert.equal(fr[0].id, ids[0]);

  // Dopo i gironi i presenti sono bloccati; un tiratore che ha tirato non si può eliminare.
  assert.equal((await call('PUT', `/days/${d1}/presence`, { fencer_ids: ids })).status, 400);
  assert.equal((await call('DELETE', `/fencers/${ids[0]}`)).status, 400);

  // Giornata 2: assente il vincitore della prima, presente il dodicesimo (aggiunto ai presenti).
  ({ data } = await call('POST', '/days', { date: '2026-12-13' }));
  const d2 = data.day.id;
  assert.equal(data.day.number, 2);
  ({ data } = await call('PUT', `/days/${d2}/presence`, { fencer_ids: ids.slice(1, 6) }));
  // Un nuovo iscritto arrivato il giorno stesso viene aggiunto all'anagrafica e segnato presente.
  ({ data } = await call('POST', '/fencers', { last_name: 'Zeta', first_name: 'Ultimo', day_id: d2 }));
  assert.equal(data.tournament.fencers.length, 13);
  assert.equal(data.fencers.length, 6);

  // Mentre la giornata 2 è in corso, la classifica generale conta solo la giornata 1.
  let lb = data.tournament.leaderboard;
  assert.equal(lb[0].id, ids[0]);
  assert.equal(lb[0].total, 10);
  assert.ok(lb.find((r) => r.id === ids[1]).results[d2].pending);

  data = await playDay(call, d2);
  // Giornata 2 (6 presenti, tabellone da 8): vince ids[1].
  assert.equal(data.finalRanking[0].id, ids[1]);
  lb = data.tournament.leaderboard;
  const row = (id) => lb.find((r) => r.id === id);
  assert.equal(row(ids[1]).total, 17); // 7 + 10
  assert.equal(row(ids[0]).total, 10); // 10 + assente
  assert.equal(row(ids[0]).presences, 1);
  assert.equal(lb[0].id, ids[1]);
  assert.equal(lb[0].rank, 1);
  assert.equal(row(ids[11]).total, 0);
  assert.equal(row(ids[11]).presences, 0);
  // La somma dei punti è coerente con le due classifiche di giornata.
  const sum = lb.reduce((s, r) => s + r.total, 0);
  assert.equal(sum, 10 + 7 + 5 + 5 + 3 * 4 + 1 * 3 + (10 + 7 + 5 + 5 + 3 + 3));

  // Eliminando una giornata spariscono anche i suoi punti.
  ({ data } = await call('DELETE', `/days/${d2}`));
  assert.equal(data.tournament.days.length, 1);
  assert.equal(data.tournament.leaderboard[0].id, ids[0]);
  assert.equal(data.tournament.leaderboard[0].total, 10);
});

test('correzioni nel tabellone', async (t) => {
  const call = client(t);
  let { data } = await call('POST', '/fencers', { bulk: Array.from({ length: 8 }, (_, i) => `T${i}; N; C${i % 2}`).join('\n') });
  const ids = data.tournament.fencers.map((f) => f.id);
  ({ data } = await call('POST', '/days', {}));
  const d = data.day.id;
  await call('PUT', `/days/${d}/presence`, { fencer_ids: ids });
  data = await playDay(call, d);

  // Non si può cambiare il vincitore di un assalto se il turno dopo è già stato disputato.
  const semi = data.bracket.find((r) => r.round === 4).bouts[0];
  const flip = semi.winner_id === semi.fencer_a ? { score_a: 3, score_b: 15 } : { score_a: 15, score_b: 3 };
  assert.equal((await call('PUT', `/de-bouts/${semi.id}`, flip)).status, 400);
  // Ma si può cancellare la finale e poi correggere la semifinale: la giornata torna in corso.
  const final = data.bracket.find((r) => r.round === 2).bouts[0];
  assert.equal((await call('PUT', `/de-bouts/${final.id}`, { score_a: null, score_b: null })).status, 200);
  const fixed = await call('PUT', `/de-bouts/${semi.id}`, flip);
  assert.equal(fixed.status, 200);
  assert.equal(fixed.data.day.status, 'dirette');
  assert.equal(fixed.data.finalRanking, null);
  assert.ok(fixed.data.tournament.leaderboard.every((r) => r.total === 0));
});
