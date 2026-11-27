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
  assert.deepEqual([1, 2, 3, 5, 8, 9, 17].map(T.dayPoints), [10, 7, 5, 3, 3, 3, 3]);
  assert.equal(T.dayPoints(null), 0);
});

// Con TEST_DATABASE_URL i test girano su Postgres (database azzerato), altrimenti su SQLite in memoria.
async function setup(t, opts = {}) {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? await open({ url, reset: true }) : await open({ file: ':memory:' });
  const server = createApp(db, opts).listen(0);
  t.after(async () => {
    server.close();
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  return { db, call };
}

async function client(t, opts) {
  return (await setup(t, opts)).call;
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
  const call = await client(t);
  let { data } = await call('GET', '/tournament');
  assert.equal(data.tournament.name, 'Fanum Fortunae XMas Cup');

  const bulk = Array.from({ length: 12 }, (_, i) => `Cognome${String(i).padStart(2, '0')}; Nome${i}`).join('\n');
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
  assert.deepEqual(fr.map((r) => r.points), [10, 7, 5, 5, 3, 3, 3, 3, 3, 3, 3]);
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
  assert.equal(sum, 10 + 7 + 5 + 5 + 3 * 7 + (10 + 7 + 5 + 5 + 3 + 3));

  // Eliminando una giornata spariscono anche i suoi punti.
  ({ data } = await call('DELETE', `/days/${d2}`));
  assert.equal(data.tournament.days.length, 1);
  assert.equal(data.tournament.leaderboard[0].id, ids[0]);
  assert.equal(data.tournament.leaderboard[0].total, 10);
});

test('correzioni nel tabellone', async (t) => {
  const call = await client(t);
  let { data } = await call('POST', '/fencers', { bulk: Array.from({ length: 8 }, (_, i) => `T${i}; N${i}`).join('\n') });
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

// ---------- Scorer ----------

async function dayWithPools(call, n = 5) {
  let { data } = await call('POST', '/fencers', { bulk: Array.from({ length: n }, (_, i) => `S${i}; N${i}`).join('\n') });
  const ids = data.tournament.fencers.map((f) => f.id);
  ({ data } = await call('POST', '/days', {}));
  const dayId = data.day.id;
  await call('PUT', `/days/${dayId}/presence`, { fencer_ids: ids });
  ({ data } = await call('POST', `/days/${dayId}/pools`, {}));
  return { dayId, data };
}

const A = { scorer_id: 'scorer-aaaa-1111', scorer_name: 'Arbitro A' };
const B = { scorer_id: 'scorer-bbbb-2222', scorer_name: 'Arbitro B' };

test('scorer: un incontro può essere arbitrato da una sola persona e il risultato arriva in automatico', async (t) => {
  const call = await client(t);
  const { dayId } = await dayWithPools(call);

  let r = await call('GET', `/scorer/days/${dayId}`);
  assert.equal(r.status, 200);
  const first = r.data.bouts[0];
  assert.equal(first.kind, 'pool');
  assert.equal(first.status, 'open');
  assert.equal(first.max, 5);
  assert.equal(first.timing.periods, 1);

  // A prende l'incontro; B no.
  r = await call('POST', `/scorer/bouts/pool/${first.id}/claim`, A);
  assert.equal(r.status, 200, r.data.error);
  assert.equal(r.data.bout.lock.mine, true);
  assert.equal(r.data.saved, null);
  r = await call('POST', `/scorer/bouts/pool/${first.id}/claim`, B);
  assert.equal(r.status, 409);
  assert.equal(r.data.locked, true);
  assert.equal(r.data.stale, false);
  assert.match(r.data.error, /Arbitro A/);
  // Riprendere il proprio incontro va bene (es. pagina ricaricata).
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/claim`, A)).status, 200);

  // Due prese contemporanee sullo stesso incontro libero: ne vince una sola.
  const second = (await call('GET', `/scorer/days/${dayId}`)).data.bouts[1];
  const both = await Promise.all([A, B].map((who) => call('POST', `/scorer/bouts/pool/${second.id}/claim`, who)));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
  const winnerOfSecond = both[0].status === 200 ? A : B;
  await call('POST', `/scorer/bouts/pool/${second.id}/release`, winnerOfSecond);

  // Punteggio dal vivo visibile nell'app principale; l'organizzazione non può modificarlo.
  r = await call('POST', `/scorer/bouts/pool/${first.id}/heartbeat`, { ...A, live: { fa: first.a.id, fb: first.b.id, score_a: 2, score_b: 1 } });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/heartbeat`, B)).status, 409);
  let day = (await call('GET', `/days/${dayId}`)).data;
  const shown = day.pools.flatMap((p) => p.bouts).find((b) => b.id === first.id);
  assert.equal(shown.lock.name, 'Arbitro A');
  assert.equal(shown.lock.live.score_a, 2);
  assert.equal(shown.scorer_id, undefined, 'l\'id dello scorer non deve uscire dal server');
  assert.equal((await call('PUT', `/pool-bouts/${first.id}`, { score_a: 5, score_b: 0 })).status, 409);

  // B non può inviare il risultato; A sì.
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/result`, { ...B, score_a: 5, score_b: 1 })).status, 409);
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/result`, { ...A, score_a: 5, score_b: 6 })).status, 400);
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/result`, { ...A, score_a: 3, score_b: 3 })).status, 400);
  r = await call('POST', `/scorer/bouts/pool/${first.id}/result`, { ...A, score_a: 3, score_b: 3, winner_id: first.b.id });
  assert.equal(r.status, 200, r.data.error);
  day = (await call('GET', `/days/${dayId}`)).data;
  const done = day.pools.flatMap((p) => p.bouts).find((b) => b.id === first.id);
  assert.deepEqual([done.score_a, done.score_b, done.winner_id, done.lock], [3, 3, first.b.id, null]);
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/claim`, B)).status, 409, 'incontro concluso');
  assert.equal((await call('POST', `/scorer/bouts/pool/${first.id}/result`, { ...A, score_a: 5, score_b: 0 })).status, 409);
});

test('scorer: subentro a un arbitro disconnesso e sblocco dall\'organizzazione', async (t) => {
  const { db, call } = await setup(t);
  const { dayId } = await dayWithPools(call);
  const bout = (await call('GET', `/scorer/days/${dayId}`)).data.bouts[0];
  const url = `/scorer/bouts/pool/${bout.id}`;
  await call('POST', `${url}/claim`, A);
  const live = { fa: bout.a.id, fb: bout.b.id, score_a: 4, score_b: 2 };
  await call('POST', `${url}/heartbeat`, { ...A, live });

  // A smette di rispondere: B può subentrare solo chiedendolo esplicitamente.
  await db.run('UPDATE pool_bouts SET seen_at = ? WHERE id = ?', [Date.now() - 10 * 60 * 1000, bout.id]);
  let r = await call('POST', `${url}/claim`, B);
  assert.equal(r.status, 409);
  assert.equal(r.data.stale, true);
  r = await call('POST', `${url}/claim`, { ...B, takeover: true });
  assert.equal(r.status, 200, r.data.error);
  assert.deepEqual([r.data.saved.score_a, r.data.saved.score_b], [4, 2], 'riparte dal punteggio salvato');
  // A torna online ma non è più l'arbitro.
  r = await call('POST', `${url}/heartbeat`, A);
  assert.equal(r.status, 409);
  assert.equal(r.data.lost, true);

  // L'organizzazione sblocca: B perde l'incontro, che torna libero.
  r = await call('POST', `/bouts/pool/${bout.id}/unlock`);
  assert.equal(r.status, 200);
  assert.equal((await call('POST', `${url}/heartbeat`, B)).status, 409);
  const again = (await call('GET', `/scorer/days/${dayId}`)).data.bouts[0];
  assert.equal(again.status, 'open');
  r = await call('POST', `${url}/claim`, A);
  assert.equal(r.data.saved.score_a, 4);

  // Rilascio volontario: il punteggio resta salvato.
  await call('POST', `${url}/release`, { ...A, live: { ...live, score_b: 3 } });
  r = await call('POST', `${url}/claim`, B);
  assert.equal(r.status, 200);
  assert.equal(r.data.saved.score_b, 3);
});

test('scorer: dirette arbitrate dallo scorer, il vincitore avanza nel tabellone', async (t) => {
  const call = await client(t);
  const { dayId, data } = await dayWithPools(call, 4);
  for (const b of data.pools.flatMap((p) => p.bouts)) {
    await call('PUT', `/pool-bouts/${b.id}`, b.fencer_a < b.fencer_b ? { score_a: 5, score_b: 1 } : { score_a: 1, score_b: 5 });
  }
  // A gironi chiusi dallo scorer non si possono più prendere incontri dei gironi.
  await call('POST', `/days/${dayId}/bracket`, {});
  let list = (await call('GET', `/scorer/days/${dayId}`)).data.bouts;
  assert.ok(list.filter((b) => b.kind === 'pool').every((b) => b.status === 'done'));
  const semis = list.filter((b) => b.kind === 'de' && b.status === 'open');
  assert.equal(semis.length, 2);
  assert.equal(semis[0].max, 15);
  assert.equal(semis[0].timing.periods, 3);
  assert.equal(list.find((b) => b.group === 'Finale').status, 'waiting');

  for (const s of semis) {
    assert.equal((await call('POST', `/scorer/bouts/de/${s.id}/claim`, A)).status, 200);
    const r = await call('POST', `/scorer/bouts/de/${s.id}/result`, { ...A, score_a: 15, score_b: 11 });
    assert.equal(r.status, 200, r.data.error);
  }
  list = (await call('GET', `/scorer/days/${dayId}`)).data.bouts;
  const final = list.find((b) => b.group === 'Finale');
  assert.equal(final.status, 'open');
  assert.deepEqual([final.a.id, final.b.id], semis.map((s) => s.a.id));

  // Mentre la finale è in arbitraggio non si può cambiare il vincitore di una semifinale.
  await call('POST', `/scorer/bouts/de/${final.id}/claim`, B);
  const semi = (await call('GET', `/days/${dayId}`)).data.bracket.find((r) => r.round === 4).bouts[0];
  assert.equal((await call('PUT', `/de-bouts/${semi.id}`, { score_a: 3, score_b: 15 })).status, 409);
  const r = await call('POST', `/scorer/bouts/de/${final.id}/result`, { ...B, score_a: 9, score_b: 15 });
  assert.equal(r.status, 200);
  const day = (await call('GET', `/days/${dayId}`)).data;
  assert.equal(day.day.status, 'conclusa');
  assert.equal(day.finalRanking[0].id, final.b.id);
});

test('ritiro nei gironi: assalti annullati, fuori dalle dirette, reintegro', async (t) => {
  const call = await client(t);
  const { dayId, data } = await dayWithPools(call, 6);
  const ids = data.fencers.map((f) => f.id);
  const out = ids[0];
  const bouts = data.pools.flatMap((p) => p.bouts);
  // Un assalto del ritirato già disputato e uno in arbitraggio.
  const played = bouts.find((b) => b.fencer_a === out || b.fencer_b === out);
  await call('PUT', `/pool-bouts/${played.id}`, { score_a: 5, score_b: 0 });
  const busy = bouts.find((b) => b.id !== played.id && (b.fencer_a === out || b.fencer_b === out));
  assert.equal((await call('POST', `/scorer/bouts/pool/${busy.id}/claim`, A)).status, 200);

  let r = await call('POST', `/days/${dayId}/withdraw`, { fencer_id: out });
  assert.equal(r.status, 200, r.data.error);
  let d = r.data;
  assert.equal(d.fencers.find((f) => f.id === out).withdrawn, 'gironi');
  const mine = d.pools.flatMap((p) => p.bouts).filter((b) => b.fencer_a === out || b.fencer_b === out);
  assert.ok(mine.every((b) => b.annulled && !b.lock));
  // L'assalto già disputato non conta più per l'avversario.
  const opp = played.fencer_a === out ? played.fencer_b : played.fencer_a;
  assert.equal(d.ranking.find((x) => x.id === opp).m, 0);
  assert.equal(d.ranking.at(-1).id, out);
  // Lo scorer perde l'incontro annullato e non lo vede più tra quelli da arbitrare.
  assert.equal((await call('POST', `/scorer/bouts/pool/${busy.id}/heartbeat`, A)).status, 409);
  assert.equal((await call('POST', `/scorer/bouts/pool/${busy.id}/claim`, A)).status, 409);
  assert.equal((await call('PUT', `/pool-bouts/${busy.id}`, { score_a: 5, score_b: 1 })).status, 400);
  const list = (await call('GET', `/scorer/days/${dayId}`)).data.bouts;
  assert.ok(list.filter((b) => b.a.id === out || b.b.id === out).every((b) => b.status === 'annulled'));

  // Reintegro e nuovo ritiro: tutto torna come prima.
  r = await call('DELETE', `/days/${dayId}/withdraw/${out}`);
  assert.equal(r.status, 200, r.data.error);
  assert.equal(r.data.ranking.find((x) => x.id === opp).m, 1);
  await call('POST', `/days/${dayId}/withdraw`, { fencer_id: out });

  // Si completano gli altri assalti: i gironi risultano conclusi senza quelli annullati.
  d = (await call('GET', `/days/${dayId}`)).data;
  for (const b of d.pools.flatMap((p) => p.bouts).filter((x) => !x.annulled && x.winner_id == null)) {
    r = await call('PUT', `/pool-bouts/${b.id}`, b.fencer_a < b.fencer_b ? { score_a: 5, score_b: 1 } : { score_a: 1, score_b: 5 });
    assert.equal(r.status, 200, r.data.error);
  }
  assert.equal(r.data.day.status, 'gironi_conclusi');
  r = await call('POST', `/days/${dayId}/bracket`, {});
  assert.equal(r.status, 200, r.data.error);
  const inBracket = new Set(r.data.bracket.flatMap((x) => x.bouts).flatMap((b) => [b.fencer_a, b.fencer_b]));
  assert.ok(!inBracket.has(out), 'il ritirato non entra nel tabellone');
  assert.equal(r.data.fencers.find((f) => f.id === out).seed, null);
  // Dopo il tabellone non si reintegra più chi si è ritirato nei gironi.
  assert.equal((await call('DELETE', `/days/${dayId}/withdraw/${out}`)).status, 400);

  // Fine giornata: il ritirato è ultimo e prende i punti di presenza.
  for (let g = 0; g < 10 && r.data.day.status !== 'conclusa'; g++) {
    for (const b of r.data.bracket.flatMap((x) => x.bouts).filter((x) => !x.is_bye && x.winner_id == null && x.fencer_a && x.fencer_b)) {
      r = await call('PUT', `/de-bouts/${b.id}`, { score_a: 15, score_b: 3 });
    }
  }
  const last = r.data.finalRanking.at(-1);
  assert.equal(last.id, out);
  assert.equal(last.withdrawn, 'gironi');
  assert.equal(last.place, 6);
});

test('ritiro nelle dirette: R nel tabellone, l\'avversario avanza', async (t) => {
  const call = await client(t);
  const { dayId, data } = await dayWithPools(call, 4);
  for (const b of data.pools.flatMap((p) => p.bouts)) {
    await call('PUT', `/pool-bouts/${b.id}`, b.fencer_a < b.fencer_b ? { score_a: 5, score_b: 1 } : { score_a: 1, score_b: 5 });
  }
  let d = (await call('POST', `/days/${dayId}/bracket`, {})).data;
  const [s1, s2] = d.bracket.find((x) => x.round === 4).bouts;
  // Il tiratore della seconda semifinale è in arbitraggio quando si ritira.
  assert.equal((await call('POST', `/scorer/bouts/de/${s2.id}/claim`, A)).status, 200);
  let r = await call('POST', `/days/${dayId}/withdraw`, { fencer_id: s2.fencer_b });
  assert.equal(r.status, 200, r.data.error);
  let semi = r.data.bracket.find((x) => x.round === 4).bouts[1];
  assert.equal(semi.forfeit, s2.fencer_b);
  assert.equal(semi.winner_id, s2.fencer_a);
  assert.equal(semi.lock, null);
  assert.equal(r.data.bracket.find((x) => x.round === 2).bouts[0].fencer_b, s2.fencer_a);
  assert.equal((await call('POST', `/scorer/bouts/de/${s2.id}/heartbeat`, A)).status, 409);
  assert.equal((await call('PUT', `/de-bouts/${s2.id}`, { score_a: 15, score_b: 2 })).status, 400);
  const sc = (await call('GET', `/scorer/days/${dayId}`)).data.bouts.find((b) => b.id === s2.id && b.kind === 'de');
  assert.equal(sc.status, 'done');
  assert.equal(sc.result.score_b, 'R');
  // Chi è già eliminato non può ritirarsi.
  assert.equal((await call('POST', `/days/${dayId}/withdraw`, { fencer_id: s2.fencer_b })).status, 400);

  // Reintegro: la semifinale torna da disputare.
  r = await call('DELETE', `/days/${dayId}/withdraw/${s2.fencer_b}`);
  assert.equal(r.status, 200, r.data.error);
  semi = r.data.bracket.find((x) => x.round === 4).bouts[1];
  assert.equal(semi.winner_id, null);
  assert.equal(semi.forfeit, null);

  // Ritiro di chi aspetta l'avversario: perde la finale appena l'avversario è deciso.
  r = await call('PUT', `/de-bouts/${s1.id}`, { score_a: 15, score_b: 4 });
  r = await call('POST', `/days/${dayId}/withdraw`, { fencer_id: s1.fencer_a });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(r.data.bracket.find((x) => x.round === 2).bouts[0].winner_id, null);
  r = await call('PUT', `/de-bouts/${s2.id}`, { score_a: 15, score_b: 7 });
  assert.equal(r.status, 200, r.data.error);
  const final = r.data.bracket.find((x) => x.round === 2).bouts[0];
  assert.equal(final.forfeit, s1.fencer_a);
  assert.equal(final.winner_id, s2.fencer_a);
  assert.equal(r.data.day.status, 'conclusa');
  const fr = r.data.finalRanking;
  assert.equal(fr[0].id, s2.fencer_a);
  assert.deepEqual([fr[1].id, fr[1].place, fr[1].points, fr[1].withdrawn], [s1.fencer_a, 2, 7, 'dirette']);
});

test('password dell\'organizzazione e PIN degli arbitri', async (t) => {
  const call = await client(t, { adminPassword: 'segreto', scorerPin: '2412' });
  const admin = { 'x-admin-key': 'segreto' };
  assert.equal((await call('GET', '/tournament')).status, 200, 'la classifica resta pubblica');
  assert.deepEqual((await call('GET', '/auth')).data, { admin: true, scorer: true });
  let r = await call('POST', '/fencers', { last_name: 'Rossi' });
  assert.equal(r.status, 401);
  assert.equal(r.data.auth, 'admin');
  assert.equal((await call('POST', '/fencers', { last_name: 'Rossi' }, { 'x-admin-key': 'sbagliata' })).status, 401);
  assert.equal((await call('POST', '/auth/check', {}, admin)).status, 200);
  await call('POST', '/fencers', { bulk: 'A; a\nB; b\nC; c' }, admin);
  const ids = (await call('GET', '/tournament')).data.tournament.fencers.map((f) => f.id);
  const dayId = (await call('POST', '/days', {}, admin)).data.day.id;
  await call('PUT', `/days/${dayId}/presence`, { fencer_ids: ids }, admin);
  await call('POST', `/days/${dayId}/pools`, {}, admin);
  const bout = (await call('GET', `/scorer/days/${dayId}`)).data.bouts[0];
  r = await call('POST', `/scorer/bouts/pool/${bout.id}/claim`, A);
  assert.equal(r.status, 401);
  assert.equal(r.data.auth, 'scorer');
  assert.equal((await call('POST', `/scorer/bouts/pool/${bout.id}/claim`, A, { 'x-scorer-key': '2412' })).status, 200);
  // Il PIN degli arbitri non apre l'amministrazione.
  assert.equal((await call('POST', '/days', {}, { 'x-scorer-key': '2412' })).status, 401);
});
