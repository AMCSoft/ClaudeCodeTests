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

test('flusso completo: iscrizioni, gironi, tabellone, classifica', async (t) => {
  const db = open(':memory:');
  // Percentuale non più modificabile dall'interfaccia: la imposto qui per provare anche gli esclusi.
  const server = createApp(db).listen(0);
  db.prepare('UPDATE competitions SET qualify_percent = 80').run();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };

  const bulk = Array.from({ length: 11 }, (_, i) => `Cognome${i}; Nome${i}; Club${i % 3}`).join('\n');
  let { data } = await call('GET', '/competition');
  assert.equal(data.competition.name, 'Spooky Mosciolino');
  ({ data } = await call('POST', '/fencers', { bulk }));
  assert.equal(data.fencers.length, 11);

  ({ data } = await call('POST', '/pools', {}));
  assert.equal(data.pools.length, 2);
  assert.equal(data.competition.status, 'gironi');

  // Con i gironi generati non si possono aggiungere iscritti.
  const locked = await call('POST', '/fencers', { last_name: 'Tardi' });
  assert.equal(locked.status, 400);

  // Il tabellone richiede i gironi completi.
  assert.equal((await call('POST', '/bracket', {})).status, 400);

  // Risultati: vince sempre il tiratore con l'id più basso; un assalto finisce in parità alla priorità.
  const bouts = data.pools.flatMap((p) => p.bouts);
  for (const [i, b] of bouts.entries()) {
    const aWins = b.fencer_a < b.fencer_b;
    const body = i === 0
      ? { score_a: 3, score_b: 3, winner_id: Math.min(b.fencer_a, b.fencer_b) }
      : { score_a: aWins ? 5 : 2, score_b: aWins ? 2 : 5 };
    const r = await call('PUT', `/pool-bouts/${b.id}`, body);
    assert.equal(r.status, 200, r.data.error);
    data = r.data;
  }
  assert.equal(data.competition.status, 'gironi_conclusi');
  assert.equal(data.ranking[0].v, data.ranking[0].m);
  const qualified = data.ranking.filter((r) => r.qualified);
  assert.equal(qualified.length, 9); // 80% di 11

  ({ data } = await call('POST', '/bracket', {}));
  assert.equal(data.competition.status, 'dirette');
  assert.deepEqual(data.bracket.map((r) => r.round), [16, 8, 4, 2]);
  const first = data.bracket[0].bouts;
  assert.equal(first.filter((b) => b.is_bye).length, 7);
  // La testa di serie n.1 è esente e già nel turno successivo.
  assert.equal(data.bracket[1].bouts[0].fencer_a, qualified[0].id);

  // Gioca tutte le dirette: vince sempre la testa di serie migliore.
  for (let guard = 0; guard < 20 && data.competition.status !== 'conclusa'; guard++) {
    const playable = data.bracket.flatMap((r) => r.bouts)
      .filter((b) => !b.is_bye && b.winner_id == null && b.fencer_a && b.fencer_b);
    for (const b of playable) {
      const aWins = b.seed_a < b.seed_b;
      const r = await call('PUT', `/de-bouts/${b.id}`, { score_a: aWins ? 15 : 9, score_b: aWins ? 9 : 15 });
      assert.equal(r.status, 200, r.data.error);
      data = r.data;
    }
  }
  assert.equal(data.competition.status, 'conclusa');
  const fr = data.finalRanking;
  assert.equal(fr[0].id, qualified[0].id);
  assert.deepEqual(fr.slice(0, 9).map((r) => r.place), [1, 2, 3, 3, 5, 5, 5, 5, 9]);
  assert.ok(fr.slice(9).every((r) => r.place >= 10));
  assert.equal(fr.length, 11);

  // Non si può cambiare il vincitore di un assalto se il turno dopo è già stato disputato.
  const semi = data.bracket.find((r) => r.round === 4).bouts[0];
  const flip = semi.winner_id === semi.fencer_a ? { score_a: 3, score_b: 15 } : { score_a: 15, score_b: 3 };
  assert.equal((await call('PUT', `/de-bouts/${semi.id}`, flip)).status, 400);

  // Ma si può cancellare la finale e poi correggere la semifinale.
  const final = data.bracket.find((r) => r.round === 2).bouts[0];
  assert.equal((await call('PUT', `/de-bouts/${final.id}`, { score_a: null, score_b: null })).status, 200);
  const fixed = await call('PUT', `/de-bouts/${semi.id}`, flip);
  assert.equal(fixed.status, 200);
  const newFinal = fixed.data.bracket.find((r) => r.round === 2).bouts[0];
  assert.ok([newFinal.fencer_a, newFinal.fencer_b].includes(fixed.data.bracket.find((r) => r.round === 4).bouts[0].winner_id));
  assert.equal(fixed.data.competition.status, 'dirette');
});
