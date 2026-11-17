const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const T = require('./lib/tournament');

const TOURNAMENT_NAME = 'Fanum Fortunae XMas Cup';

// Uno scorer che non dà segnali da più di così è considerato disconnesso:
// un altro arbitro può subentrare (riprendendo dal punteggio salvato).
const STALE_MS = 45 * 1000;
const CLEAR_LOCK = 'scorer_id = NULL, scorer_name = NULL, locked_at = NULL, seen_at = NULL';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const fail = (message, status = 400, extra) => {
  throw new HttpError(status, message, extra);
};

const byName = (a, b) =>
  a.last_name.localeCompare(b.last_name, 'it', { sensitivity: 'base' }) ||
  (a.first_name || '').localeCompare(b.first_name || '', 'it', { sensitivity: 'base' });

const fencerName = (f) => (f ? `${f.last_name.toUpperCase()} ${f.first_name || ''}`.trim() : '');

const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

// ---------- Fotografia del database e calcoli ----------

// Il torneo è piccolo: si leggono tutte le tabelle e si calcola tutto in memoria.
async function load(q) {
  const [fencers, days, dayFencers, pools, members, poolBouts, deBouts] = await Promise.all([
    q.all('SELECT id, last_name, first_name FROM fencers'),
    q.all('SELECT * FROM days ORDER BY id'),
    q.all('SELECT * FROM day_fencers'),
    q.all('SELECT * FROM pools ORDER BY number'),
    q.all('SELECT * FROM pool_members ORDER BY position'),
    q.all('SELECT * FROM pool_bouts ORDER BY bout_order'),
    q.all('SELECT * FROM de_bouts ORDER BY round DESC, position'),
  ]);
  return { fencers, fencerById: new Map(fencers.map((f) => [f.id, f])), days, dayFencers, pools, members, poolBouts, deBouts };
}

function lockInfo(b, now, sid) {
  if (!b.scorer_id) return null;
  return {
    name: b.scorer_name,
    since: b.locked_at,
    stale: now - b.seen_at > STALE_MS,
    mine: !!sid && b.scorer_id === sid,
    live: parseJson(b.live),
  };
}

// L'id del dispositivo che arbitra è segreto: non esce mai dal server.
function publicBout(b, now, sid) {
  const { scorer_id, scorer_name, locked_at, seen_at, live, ...rest } = b;
  return { ...rest, lock: lockInfo(b, now, sid) };
}

function poolRanking(d, fencers, bouts) {
  const stats = T.computePoolStats(fencers, bouts);
  const ranked = T.rankStats([...stats.values()], byName);
  const q = T.qualifiedCount(ranked.length, d.qualify_percent);
  ranked.forEach((s, i) => { s.qualified = i < q; });
  return ranked;
}

// Classifica della giornata (null finché la finale non è disputata), con i punti assegnati.
function finalRanking(deBouts, ranking) {
  const final = deBouts.find((b) => b.round === 2);
  if (!final || final.winner_id == null) return null;
  const seedOf = new Map(ranking.map((r, i) => [r.id, i]));
  const place = new Map();
  place.set(final.winner_id, 1);
  for (const b of deBouts) {
    if (b.winner_id == null || b.is_bye) continue;
    const loser = b.winner_id === b.fencer_a ? b.fencer_b : b.fencer_a;
    place.set(loser, b.round === 2 ? 2 : b.round / 2 + 1);
  }
  const rows = ranking.map((r) => ({ ...r, place: place.get(r.id) }));
  const inBracket = rows.filter((r) => r.place != null)
    .sort((a, b) => a.place - b.place || seedOf.get(a.id) - seedOf.get(b.id));
  const out = rows.filter((r) => r.place == null);
  out.forEach((r, i) => {
    r.place = i > 0 && r.rank === out[i - 1].rank ? out[i - 1].place : inBracket.length + i + 1;
  });
  return [...inBracket, ...out].map((r) => ({ ...r, points: T.dayPoints(r.place) }));
}

function buildDay(S, dayId, now = Date.now(), sid = null) {
  const index = S.days.findIndex((x) => x.id === Number(dayId));
  if (index < 0) fail('Giornata non trovata', 404);
  const d = S.days[index];
  const present = new Set(S.dayFencers.filter((x) => x.day_id === d.id).map((x) => x.fencer_id));
  const fencers = S.fencers.filter((f) => present.has(f.id)).sort(byName);
  const pools = S.pools.filter((p) => p.day_id === d.id);
  const poolNumber = new Map(pools.map((p) => [p.id, p.number]));
  const poolBouts = S.poolBouts.filter((b) => poolNumber.has(b.pool_id))
    .sort((a, b) => poolNumber.get(a.pool_id) - poolNumber.get(b.pool_id) || a.bout_order - b.bout_order);
  const deBouts = S.deBouts.filter((b) => b.day_id === d.id);
  const members = S.members.filter((m) => poolNumber.has(m.pool_id));

  const ranking = pools.length ? poolRanking(d, fencers, poolBouts) : [];
  const seedOf = new Map(ranking.map((r, i) => [r.id, i + 1]));

  const poolsOut = pools.map((p) => {
    const ms = members.filter((m) => m.pool_id === p.id).map((m) => ({ ...S.fencerById.get(m.fencer_id), position: m.position }));
    const bouts = poolBouts.filter((b) => b.pool_id === p.id);
    const local = T.computePoolStats(ms, bouts);
    const localRank = new Map(T.rankStats([...local.values()]).map((s) => [s.id, s.rank]));
    return {
      ...p,
      members: ms.map((m) => ({ ...m, ...local.get(m.id), pool_rank: localRank.get(m.id) })),
      bouts: bouts.map((b) => publicBout(b, now, sid)),
      done: bouts.every((b) => b.winner_id != null),
    };
  });

  const poolsDone = pools.length > 0 && poolBouts.every((b) => b.winner_id != null);
  const final = finalRanking(deBouts, ranking);
  let status = 'presenze';
  if (pools.length) status = poolsDone ? 'gironi_conclusi' : 'gironi';
  if (deBouts.length) status = final ? 'conclusa' : 'dirette';

  const rounds = [];
  for (const b of deBouts) {
    let r = rounds.find((x) => x.round === b.round);
    if (!r) rounds.push((r = { round: b.round, label: T.roundLabel(b.round), bouts: [] }));
    r.bouts.push(publicBout(b, now, sid));
  }

  return {
    day: { ...d, number: index + 1, status },
    fencers: fencers.map((f) => ({ ...f, seed: seedOf.get(f.id) ?? null })),
    pools: poolsOut,
    poolsDone,
    ranking,
    bracket: rounds,
    finalRanking: final,
  };
}

// Riepilogo del torneo: anagrafica, giornate e classifica generale a punti.
function buildTournament(S, now = Date.now()) {
  const days = S.days.map((d) => buildDay(S, d.id, now));
  const rows = new Map(S.fencers.map((f) => [f.id, {
    ...f, total: 0, presences: 0, results: {}, counts: { 10: 0, 7: 0, 5: 0, 3: 0 },
  }]));

  for (const d of days) {
    const done = new Map((d.finalRanking || []).map((r) => [r.id, r]));
    for (const f of d.fencers) {
      const row = rows.get(f.id);
      if (!row) continue;
      row.presences++;
      const r = done.get(f.id);
      row.results[d.day.id] = r ? { place: r.place, points: r.points } : { pending: true };
      if (r) {
        row.total += r.points;
        row.counts[r.points]++;
      }
    }
  }

  // Totale punti, poi miglior rendimento (vittorie, secondi posti, terzi, ...), poi nome.
  const cmp = (a, b) => b.total - a.total || [10, 7, 5, 3].reduce((acc, k) => acc || b.counts[k] - a.counts[k], 0);
  const leaderboard = [...rows.values()].sort((a, b) => cmp(a, b) || byName(a, b));
  leaderboard.forEach((r, i) => {
    r.rank = i > 0 && cmp(leaderboard[i - 1], r) === 0 ? leaderboard[i - 1].rank : i + 1;
  });

  const locked = new Set(S.members.map((m) => m.fencer_id));
  return {
    name: TOURNAMENT_NAME,
    fencers: [...S.fencers].sort(byName).map((f) => ({ ...f, presences: rows.get(f.id).presences, locked: locked.has(f.id) })),
    days: days.map((d) => ({
      ...d.day,
      present: d.fencers.length,
      podium: d.finalRanking ? d.finalRanking.filter((r) => r.place <= 3) : null,
      live: [...d.pools.flatMap((p) => p.bouts), ...d.bracket.flatMap((r) => r.bouts)].filter((b) => b.lock).length,
    })),
    leaderboard,
  };
}

// Elenco degli incontri visto dallo scorer.
function scorerBouts(S, dayId, now, sid) {
  const D = buildDay(S, dayId, now, sid);
  const side = (id, extra) => (id == null ? null : { id, name: fencerName(S.fencerById.get(id)), ...extra });
  const result = (b) => (b.winner_id == null ? null : { score_a: b.score_a, score_b: b.score_b, winner_id: b.winner_id });
  const closed = D.bracket.length > 0;
  const out = [];
  for (const p of D.pools) {
    const pos = new Map(p.members.map((m) => [m.id, m.position]));
    for (const b of p.bouts) {
      out.push({
        kind: 'pool', id: b.id, group: `Girone ${p.number}`, label: `Girone ${p.number} · Assalto ${b.bout_order}`, order: b.bout_order,
        a: side(b.fencer_a, { position: pos.get(b.fencer_a) }), b: side(b.fencer_b, { position: pos.get(b.fencer_b) }),
        max: D.day.pool_touches, timing: { ...T.TIMING.pool, priorityMs: T.TIMING.priorityMs },
        status: b.winner_id != null ? 'done' : closed ? 'closed' : b.lock ? 'locked' : 'open',
        lock: b.lock, result: result(b),
      });
    }
  }
  for (const r of D.bracket) {
    const many = r.bouts.filter((b) => !b.is_bye).length > 1;
    r.bouts.forEach((b) => {
      if (b.is_bye) return;
      out.push({
        kind: 'de', id: b.id, group: r.label, label: many ? `${r.label} · ${b.position + 1}` : r.label, order: b.position,
        a: side(b.fencer_a, { seed: b.seed_a }), b: side(b.fencer_b, { seed: b.seed_b }),
        max: D.day.de_touches, timing: { ...T.TIMING.de, priorityMs: T.TIMING.priorityMs },
        status: b.winner_id != null ? 'done' : b.fencer_a == null || b.fencer_b == null ? 'waiting' : b.lock ? 'locked' : 'open',
        lock: b.lock, result: result(b),
      });
    });
  }
  return { day: D.day, bouts: out };
}

// ---------- Applicazione ----------

function createApp(db, opts = {}) {
  const ADMIN = opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';
  const PIN = opts.scorerPin ?? process.env.SCORER_PIN ?? '';
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const state = async (dayId) => {
    const S = await load(db);
    const now = Date.now();
    return { tournament: buildTournament(S, now), ...(dayId ? buildDay(S, dayId, now) : {}) };
  };

  const getDay = async (q, id) => {
    const d = await q.get('SELECT * FROM days WHERE id = ?', [Number(id)]);
    if (!d) fail('Giornata non trovata', 404);
    return d;
  };
  const getPresent = async (q, did) =>
    (await q.all('SELECT f.id, f.last_name, f.first_name FROM fencers f JOIN day_fencers df ON df.fencer_id = f.id WHERE df.day_id = ?', [did])).sort(byName);
  const getPoolBouts = (q, did) =>
    q.all(`SELECT pb.* FROM pool_bouts pb JOIN pools p ON p.id = pb.pool_id
           WHERE p.day_id = ? ORDER BY p.number, pb.bout_order`, [did]);
  const hasPools = async (q, did) => !!(await q.get('SELECT 1 AS x FROM pools WHERE day_id = ?', [did]));
  const hasBracket = async (q, did) => !!(await q.get('SELECT 1 AS x FROM de_bouts WHERE day_id = ?', [did]));

  // ---------- Autorizzazioni ----------
  // Senza ADMIN_PASSWORD / SCORER_PIN (uso locale) tutto è aperto. Online le pagine
  // si possono sempre consultare, ma per modificare serve la password o il PIN.
  const isAdmin = (req) => !ADMIN || safeEqual(req.get('x-admin-key') || '', ADMIN);
  const isScorer = (req) => !PIN || safeEqual(req.get('x-scorer-key') || '', PIN) || (!!ADMIN && isAdmin(req));

  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    if (req.path.startsWith('/scorer/')) {
      if (!isScorer(req)) return res.status(401).json({ error: 'PIN arbitro non valido', auth: 'scorer' });
    } else if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Serve la password dell\'organizzazione', auth: 'admin' });
    }
    next();
  });

  // ---------- Validazione input ----------

  function fencerInput(body) {
    const last_name = String(body.last_name ?? '').trim();
    const first_name = String(body.first_name ?? '').trim();
    if (!last_name) fail('Il cognome è obbligatorio');
    return { last_name, first_name };
  }

  // Formato: una riga per tiratore, "Cognome; Nome" (separatori ; tab o ,). Siamo tutti della
  // Fanum Fortunae Scherma, quindi la società non si gestisce: eventuali colonne in più si ignorano.
  function parseBulk(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [last_name = '', first_name = ''] = l.split(/\s*[;\t,]\s*/);
        return fencerInput({ last_name, first_name });
      });
  }

  function dayInput(body) {
    const date = String(body.date ?? '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Data non valida');
    return { date, location: String(body.location ?? '').trim() };
  }

  function scoreInput(body) {
    if (body.score_a == null && body.score_b == null) return null;
    return {
      scoreA: Number(body.score_a),
      scoreB: Number(body.score_b),
      winnerId: body.winner_id == null ? null : Number(body.winner_id),
    };
  }

  function scorerInput(body, needName = false) {
    const sid = String(body.scorer_id ?? '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) fail('Identificativo dello scorer non valido');
    const name = String(body.scorer_name ?? '').trim().slice(0, 40);
    if (needName && !name) fail('Indica il nome dell\'arbitro');
    return { sid, name };
  }

  function liveInput(live) {
    if (live == null) return null;
    const s = JSON.stringify(live);
    if (s.length > 4000) fail('Stato dell\'incontro troppo grande');
    return s;
  }

  const route = (fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      res.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra });
      console.error(e);
      res.status(500).json({ error: 'Errore interno del server' });
    }
  };

  // ---------- Incontri: contesto, risultati e avanzamento ----------

  async function boutCtx(q, kind, id) {
    if (kind === 'pool') {
      const b = await q.get(`SELECT pb.*, p.day_id, p.number AS pool_number FROM pool_bouts pb
                             JOIN pools p ON p.id = pb.pool_id WHERE pb.id = ?`, [Number(id)]);
      if (!b) fail('Incontro non trovato: forse i gironi sono stati rigenerati', 404);
      const day = await getDay(q, b.day_id);
      const closed = (await hasBracket(q, day.id)) ? 'Il tabellone è già stato generato: i risultati dei gironi sono chiusi' : null;
      return { kind, table: 'pool_bouts', b, day, max: day.pool_touches, closed };
    }
    if (kind === 'de') {
      const b = await q.get('SELECT * FROM de_bouts WHERE id = ?', [Number(id)]);
      if (!b) fail('Incontro non trovato: forse il tabellone è stato rigenerato', 404);
      const day = await getDay(q, b.day_id);
      let closed = null;
      if (b.is_bye) closed = 'Questo è un passaggio diretto (esente), non c\'è un risultato da inserire';
      else if (b.fencer_a == null || b.fencer_b == null) closed = 'L\'assalto non ha ancora entrambi i tiratori';
      return { kind, table: 'de_bouts', b, day, max: day.de_touches, closed };
    }
    return fail('Tipo di incontro non valido', 404);
  }

  const nextBout = (q, b) => (b.round <= 2 ? null :
    q.get('SELECT * FROM de_bouts WHERE day_id = ? AND round = ? AND position = ?', [b.day_id, b.round / 2, Math.floor(b.position / 2)]));

  // Porta il vincitore nello slot corretto del turno successivo.
  async function advance(q, bout, fencerId) {
    if (bout.round <= 2) return;
    const slot = bout.position % 2 === 0 ? 'a' : 'b';
    const seed = fencerId == null ? null : (fencerId === bout.fencer_a ? bout.seed_a : bout.seed_b);
    await q.run(`UPDATE de_bouts SET fencer_${slot} = ?, seed_${slot} = ?, live = NULL WHERE day_id = ? AND round = ? AND position = ?`,
      [fencerId, seed, bout.day_id, bout.round / 2, Math.floor(bout.position / 2)]);
  }

  // Scrive (o cancella, con s = null) il risultato di un incontro. Dall'organizzazione
  // (sid assente) solo se nessuno lo sta arbitrando; dallo scorer solo se è suo.
  async function writeResult(q, ctx, s, sid = null) {
    const { b, table } = ctx;
    if (ctx.closed) fail(ctx.closed, sid ? 409 : 400);
    if (sid) {
      if (b.scorer_id !== sid) fail('Non hai più in carico questo incontro', 409, { lost: true });
      if (b.winner_id != null) fail('Il risultato di questo incontro è già stato inserito', 409);
      if (!s) fail('Risultato mancante');
    } else if (b.scorer_id) {
      fail(`Incontro in arbitraggio da ${b.scorer_name}: sbloccalo prima di modificarlo`, 409);
    }
    const next = ctx.kind === 'de' ? await nextBout(q, b) : null;
    const nextPlayed = next && next.winner_id != null;

    if (!s) {
      if (nextPlayed) fail('Il turno successivo è già stato disputato: cancella prima quel risultato');
      if (next?.scorer_id) fail(`Il turno successivo è in arbitraggio da ${next.scorer_name}: sbloccalo prima`, 409);
      await q.run(`UPDATE ${table} SET score_a = NULL, score_b = NULL, winner_id = NULL WHERE id = ?`, [b.id]);
      if (ctx.kind === 'de') await advance(q, b, null);
      return;
    }
    let winner;
    try {
      winner = T.resolveWinner({ ...s, fencerA: b.fencer_a, fencerB: b.fencer_b, maxTouches: ctx.max });
    } catch (e) {
      fail(e.message);
    }
    if (winner !== b.winner_id) {
      if (nextPlayed) fail('Il turno successivo è già stato disputato: cancella prima quel risultato per cambiare il vincitore');
      if (next?.scorer_id) fail(`Il turno successivo è in arbitraggio da ${next.scorer_name}: sbloccalo prima`, 409);
    }
    const r = await q.run(
      `UPDATE ${table} SET score_a = ?, score_b = ?, winner_id = ?, ${CLEAR_LOCK}, live = NULL WHERE id = ?${sid ? ' AND scorer_id = ?' : ''}`,
      [s.scoreA, s.scoreB, winner, b.id, ...(sid ? [sid] : [])]);
    if (!r.changes) fail('Non hai più in carico questo incontro', 409, { lost: true });
    if (ctx.kind === 'de' && winner !== b.winner_id) await advance(q, b, winner);
  }

  // ---------- Torneo e anagrafica ----------

  app.get('/api/tournament', route(() => state()));

  app.get('/api/auth', route(() => ({ admin: !!ADMIN, scorer: !!PIN })));
  app.post('/api/auth/check', route(() => ({ ok: true })));

  app.post('/api/fencers', route(async (req) => {
    const list = req.body.bulk !== undefined ? parseBulk(req.body.bulk) : [fencerInput(req.body)];
    if (!list.length) fail('Nessun iscritto da aggiungere');
    // Facoltativo: segna subito il nuovo iscritto come presente in una giornata.
    const dayId = req.body.day_id ? (await getDay(db, req.body.day_id)).id : null;
    if (dayId && await hasPools(db, dayId)) fail('I gironi della giornata sono già stati generati: eliminali per cambiare i presenti');
    await db.tx(async (t) => {
      for (const f of list) {
        const { id } = await t.get('INSERT INTO fencers (last_name, first_name) VALUES (?, ?) RETURNING id', [f.last_name, f.first_name]);
        if (dayId) await t.run('INSERT INTO day_fencers (day_id, fencer_id) VALUES (?, ?)', [dayId, id]);
      }
    });
    return state(dayId);
  }));

  app.put('/api/fencers/:id', route(async (req) => {
    const d = fencerInput(req.body);
    const r = await db.run('UPDATE fencers SET last_name = ?, first_name = ? WHERE id = ?', [d.last_name, d.first_name, Number(req.params.id)]);
    if (!r.changes) fail('Iscritto non trovato', 404);
    return state();
  }));

  app.delete('/api/fencers/:id', route(async (req) => {
    const id = Number(req.params.id);
    if (await db.get('SELECT 1 AS x FROM pool_members WHERE fencer_id = ?', [id])) {
      fail('Questo tiratore ha già tirato in una giornata: non può essere eliminato dall\'anagrafica');
    }
    const r = await db.run('DELETE FROM fencers WHERE id = ?', [id]);
    if (!r.changes) fail('Iscritto non trovato', 404);
    return state();
  }));

  // ---------- Giornate ----------

  app.post('/api/days', route(async (req) => {
    const d = dayInput(req.body);
    const { id } = await db.get('INSERT INTO days (date, location) VALUES (?, ?) RETURNING id', [d.date, d.location]);
    return state(id);
  }));

  app.get('/api/days/:id', route(async (req) => state((await getDay(db, req.params.id)).id)));

  app.put('/api/days/:id', route(async (req) => {
    const day = await getDay(db, req.params.id);
    const d = dayInput(req.body);
    await db.run('UPDATE days SET date = ?, location = ? WHERE id = ?', [d.date, d.location, day.id]);
    return state(day.id);
  }));

  app.delete('/api/days/:id', route(async (req) => {
    const day = await getDay(db, req.params.id);
    await db.run('DELETE FROM days WHERE id = ?', [day.id]);
    return state();
  }));

  app.put('/api/days/:id/presence', route(async (req) => {
    const day = await getDay(db, req.params.id);
    if (await hasPools(db, day.id)) fail('I gironi sono già stati generati: eliminali per cambiare i presenti');
    if (!Array.isArray(req.body.fencer_ids)) fail('Elenco dei presenti non valido');
    const ids = [...new Set(req.body.fencer_ids.map(Number))];
    const known = new Set((await db.all('SELECT id FROM fencers')).map((f) => f.id));
    if (ids.some((x) => !known.has(x))) fail('Uno dei tiratori selezionati non è iscritto al torneo');
    await db.tx(async (t) => {
      await t.run('DELETE FROM day_fencers WHERE day_id = ?', [day.id]);
      for (const fid of ids) await t.run('INSERT INTO day_fencers (day_id, fencer_id) VALUES (?, ?)', [day.id, fid]);
    });
    return state(day.id);
  }));

  // ---------- Gironi ----------

  app.post('/api/days/:id/pools', route(async (req) => {
    const day = await getDay(db, req.params.id);
    if (await hasBracket(db, day.id)) fail('Il tabellone è già stato generato: eliminalo prima di rigenerare i gironi');
    let pools;
    try {
      pools = T.generatePools(await getPresent(db, day.id), T.POOL_MAX_SIZE);
    } catch (e) {
      fail(e.message.replace('partecipanti', 'presenti'));
    }
    await db.tx(async (t) => {
      await t.run('DELETE FROM pools WHERE day_id = ?', [day.id]);
      for (const [i, members] of pools.entries()) {
        const { id: poolId } = await t.get('INSERT INTO pools (day_id, number) VALUES (?, ?) RETURNING id', [day.id, i + 1]);
        for (const [pos, f] of members.entries()) {
          await t.run('INSERT INTO pool_members (pool_id, fencer_id, position) VALUES (?, ?, ?)', [poolId, f.id, pos + 1]);
        }
        for (const [k, [a, b]] of T.boutOrder(members.length).entries()) {
          await t.run('INSERT INTO pool_bouts (pool_id, bout_order, fencer_a, fencer_b) VALUES (?, ?, ?, ?)',
            [poolId, k + 1, members[a - 1].id, members[b - 1].id]);
        }
      }
    });
    return state(day.id);
  }));

  app.delete('/api/days/:id/pools', route(async (req) => {
    const day = await getDay(db, req.params.id);
    if (await hasBracket(db, day.id)) fail('Il tabellone è già stato generato: eliminalo prima di eliminare i gironi');
    await db.run('DELETE FROM pools WHERE day_id = ?', [day.id]);
    return state(day.id);
  }));

  app.put('/api/pool-bouts/:id', route(async (req) => {
    const dayId = await db.tx(async (t) => {
      const ctx = await boutCtx(t, 'pool', req.params.id);
      await writeResult(t, ctx, scoreInput(req.body));
      return ctx.day.id;
    });
    return state(dayId);
  }));

  // ---------- Tabellone dirette ----------

  app.post('/api/days/:id/bracket', route(async (req) => {
    const day = await getDay(db, req.params.id);
    const id = day.id;
    await db.tx(async (t) => {
      if (await hasBracket(t, id)) fail('Il tabellone è già stato generato');
      if (!(await hasPools(t, id))) fail('Genera prima i gironi');
      const bouts = await getPoolBouts(t, id);
      if (bouts.some((b) => b.winner_id == null)) fail('Completa tutti gli assalti dei gironi prima di generare il tabellone');
      const qualified = poolRanking(day, await getPresent(t, id), bouts).filter((r) => r.qualified);
      if (qualified.length < 2) fail('Servono almeno 2 qualificati per il tabellone');

      const size = T.bracketSize(qualified.length);
      const positions = T.seedPositions(size);
      const ins = 'INSERT INTO de_bouts (day_id, round, position, fencer_a, fencer_b, seed_a, seed_b) VALUES (?, ?, ?, ?, ?, ?, ?)';
      for (let round = size; round >= 2; round /= 2) {
        for (let p = 0; p < round / 2; p++) {
          if (round === size) {
            const sa = positions[2 * p];
            const sb = positions[2 * p + 1];
            const fa = qualified[sa - 1]?.id ?? null;
            const fb = qualified[sb - 1]?.id ?? null;
            await t.run(ins, [id, round, p, fa, fb, fa ? sa : null, fb ? sb : null]);
          } else {
            await t.run(ins, [id, round, p, null, null, null, null]);
          }
        }
      }
      // Esenti (bye): la testa di serie passa direttamente al turno successivo.
      for (const b of await t.all('SELECT * FROM de_bouts WHERE day_id = ? AND round = ?', [id, size])) {
        if (b.fencer_a == null || b.fencer_b == null) {
          const w = b.fencer_a ?? b.fencer_b;
          await t.run('UPDATE de_bouts SET winner_id = ?, is_bye = 1 WHERE id = ?', [w, b.id]);
          await advance(t, b, w);
        }
      }
    });
    return state(id);
  }));

  app.delete('/api/days/:id/bracket', route(async (req) => {
    const day = await getDay(db, req.params.id);
    await db.run('DELETE FROM de_bouts WHERE day_id = ?', [day.id]);
    return state(day.id);
  }));

  app.put('/api/de-bouts/:id', route(async (req) => {
    const dayId = await db.tx(async (t) => {
      const ctx = await boutCtx(t, 'de', req.params.id);
      await writeResult(t, ctx, scoreInput(req.body));
      return ctx.day.id;
    });
    return state(dayId);
  }));

  // L'organizzazione libera un incontro bloccato (es. telefono dell'arbitro scarico):
  // il punteggio salvato resta, così chi subentra riparte da lì.
  app.post('/api/bouts/:kind/:id/unlock', route(async (req) => {
    const ctx = await boutCtx(db, req.params.kind, req.params.id);
    await db.run(`UPDATE ${ctx.table} SET ${CLEAR_LOCK} WHERE id = ?`, [ctx.b.id]);
    return state(ctx.day.id);
  }));

  // ---------- Scorer (app per arbitrare) ----------

  app.get('/api/scorer/config', route((req) => {
    // In locale suggerisce gli indirizzi da aprire sui telefoni collegati alla stessa rete.
    const lan = process.env.VERCEL ? [] : Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `http://${i.address}:${req.socket.localPort}/scorer/`);
    return { name: TOURNAMENT_NAME, pinRequired: !!PIN, staleMs: STALE_MS, lan };
  }));

  // Verifica del PIN (il controllo vero lo fa il middleware di autorizzazione).
  app.post('/api/scorer/check', route(() => ({ ok: true })));

  app.get('/api/scorer/days', route(async () => {
    const S = await load(db);
    const now = Date.now();
    return {
      days: S.days.map((d) => {
        const { day, bouts } = scorerBouts(S, d.id, now, null);
        return {
          ...day,
          open: bouts.filter((b) => b.status === 'open').length,
          live: bouts.filter((b) => b.status === 'locked').length,
          todo: bouts.filter((b) => ['open', 'locked', 'waiting'].includes(b.status)).length,
        };
      }),
    };
  }));

  app.get('/api/scorer/days/:id', route(async (req) => {
    const S = await load(db);
    return scorerBouts(S, req.params.id, Date.now(), req.get('x-scorer-id') || null);
  }));

  // Prende in carico un incontro. L'aggiornamento è atomico: se due arbitri ci provano
  // insieme, uno solo vince. Si può subentrare solo a uno scorer disconnesso.
  app.post('/api/scorer/bouts/:kind/:id/claim', route(async (req) => {
    const { sid, name } = scorerInput(req.body, true);
    const ctx = await boutCtx(db, req.params.kind, req.params.id);
    if (ctx.closed) fail(ctx.closed, 409);
    if (ctx.b.winner_id != null) fail('Il risultato di questo incontro è già stato inserito', 409);
    const now = Date.now();
    const r = await db.run(
      `UPDATE ${ctx.table} SET scorer_id = ?, scorer_name = ?, locked_at = CASE WHEN scorer_id = ? THEN locked_at ELSE ? END, seen_at = ?
       WHERE id = ? AND winner_id IS NULL AND (scorer_id IS NULL OR scorer_id = ? OR (? = 1 AND seen_at < ?))`,
      [sid, name, sid, now, now, ctx.b.id, sid, req.body.takeover ? 1 : 0, now - STALE_MS]);
    if (!r.changes) {
      const cur = (await boutCtx(db, req.params.kind, req.params.id)).b;
      if (cur.winner_id != null) fail('Il risultato di questo incontro è già stato inserito', 409);
      const stale = now - cur.seen_at > STALE_MS;
      fail(stale
        ? `${cur.scorer_name} stava arbitrando questo incontro ma non risponde da ${Math.round((now - cur.seen_at) / 1000)} secondi. Vuoi subentrare?`
        : `Questo incontro è già in arbitraggio da ${cur.scorer_name}`, 409, { locked: true, stale, by: cur.scorer_name });
    }
    const S = await load(db);
    const bout = scorerBouts(S, ctx.day.id, now, sid).bouts.find((b) => b.kind === ctx.kind && b.id === ctx.b.id);
    // Punteggio salvato da un arbitro precedente, se riguarda gli stessi tiratori.
    const saved = parseJson((await boutCtx(db, ctx.kind, ctx.b.id)).b.live);
    const valid = saved && saved.fa === ctx.b.fencer_a && saved.fb === ctx.b.fencer_b;
    return { bout, saved: valid ? saved : null };
  }));

  app.post('/api/scorer/bouts/:kind/:id/heartbeat', route(async (req) => {
    const { sid } = scorerInput(req.body);
    const ctx = await boutCtx(db, req.params.kind, req.params.id);
    const live = liveInput(req.body.live);
    const r = await db.run(`UPDATE ${ctx.table} SET seen_at = ?${live ? ', live = ?' : ''} WHERE id = ? AND scorer_id = ? AND winner_id IS NULL`,
      [Date.now(), ...(live ? [live] : []), ctx.b.id, sid]);
    if (!r.changes) {
      fail(ctx.b.winner_id != null ? 'Il risultato di questo incontro è già stato inserito'
        : 'Questo incontro non è più in carico a te: è stato sbloccato dall\'organizzazione o preso da un altro arbitro', 409, { lost: true });
    }
    return { ok: true };
  }));

  app.post('/api/scorer/bouts/:kind/:id/release', route(async (req) => {
    const { sid } = scorerInput(req.body);
    const ctx = await boutCtx(db, req.params.kind, req.params.id);
    const live = liveInput(req.body.live);
    await db.run(`UPDATE ${ctx.table} SET ${CLEAR_LOCK}${live ? ', live = ?' : ''} WHERE id = ? AND scorer_id = ?`,
      [...(live ? [live] : []), ctx.b.id, sid]);
    return { ok: true };
  }));

  app.post('/api/scorer/bouts/:kind/:id/result', route(async (req) => {
    const { sid } = scorerInput(req.body);
    await db.tx(async (t) => {
      const ctx = await boutCtx(t, req.params.kind, req.params.id);
      await writeResult(t, ctx, scoreInput(req.body), sid);
    });
    return { ok: true };
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

  return app;
}

if (require.main === module) {
  const { open } = require('./db');
  const PORT = Number(process.env.PORT) || 4020;
  open().then((db) => {
    createApp(db).listen(PORT, () => {
      console.log(`🎄 ${TOURNAMENT_NAME} in ascolto su http://localhost:${PORT}`);
      console.log(`📱 Scorer per gli arbitri: http://localhost:${PORT}/scorer/`);
    });
  }).catch((e) => {
    console.error('Impossibile aprire il database:', e.message);
    process.exit(1);
  });
}

module.exports = { createApp, TOURNAMENT_NAME, STALE_MS };
