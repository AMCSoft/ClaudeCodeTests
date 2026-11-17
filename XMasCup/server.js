const express = require('express');
const path = require('path');
const { open } = require('./db');
const T = require('./lib/tournament');

const TOURNAMENT_NAME = 'Fanum Fortunae XMas Cup';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (message, status = 400) => {
  throw new HttpError(status, message);
};

const byName = (a, b) =>
  a.last_name.localeCompare(b.last_name, 'it', { sensitivity: 'base' }) ||
  (a.first_name || '').localeCompare(b.first_name || '', 'it', { sensitivity: 'base' });

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- Accesso ai dati ----------

  const getDays = () => db.prepare('SELECT * FROM days ORDER BY id').all();
  const getDay = (id) => {
    const d = db.prepare('SELECT * FROM days WHERE id = ?').get(Number(id));
    if (!d) fail('Giornata non trovata', 404);
    return d;
  };
  const getRoster = () => db.prepare('SELECT * FROM fencers').all().sort(byName);
  const getPresent = (did) =>
    db.prepare('SELECT f.* FROM fencers f JOIN day_fencers df ON df.fencer_id = f.id WHERE df.day_id = ?').all(did).sort(byName);
  const getPools = (did) => db.prepare('SELECT * FROM pools WHERE day_id = ? ORDER BY number').all(did);
  const getPoolBouts = (did) =>
    db.prepare(`SELECT pb.* FROM pool_bouts pb JOIN pools p ON p.id = pb.pool_id
                WHERE p.day_id = ? ORDER BY p.number, pb.bout_order`).all(did);
  const getDeBouts = (did) =>
    db.prepare('SELECT * FROM de_bouts WHERE day_id = ? ORDER BY round DESC, position').all(did);
  const hasPools = (did) => !!db.prepare('SELECT 1 FROM pools WHERE day_id = ?').get(did);
  const hasBracket = (did) => !!db.prepare('SELECT 1 FROM de_bouts WHERE day_id = ?').get(did);
  const dayNumber = (did) => db.prepare('SELECT COUNT(*) AS n FROM days WHERE id <= ?').get(did).n;

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
    // Eventuali non qualificati seguono, nell'ordine della classifica dei gironi.
    out.forEach((r, i) => {
      r.place = i > 0 && r.rank === out[i - 1].rank ? out[i - 1].place : inBracket.length + i + 1;
    });
    return [...inBracket, ...out].map((r) => ({ ...r, points: T.dayPoints(r.place) }));
  }

  function fullDay(id) {
    const d = getDay(id);
    const fencers = getPresent(d.id);
    const byId = new Map(fencers.map((f) => [f.id, f]));
    const pools = getPools(d.id);
    const poolBouts = getPoolBouts(d.id);
    const deBouts = getDeBouts(d.id);
    const members = db.prepare(`SELECT pm.* FROM pool_members pm JOIN pools p ON p.id = pm.pool_id
                                WHERE p.day_id = ? ORDER BY pm.position`).all(d.id);

    const ranking = pools.length ? poolRanking(d, fencers, poolBouts) : [];
    const seedOf = new Map(ranking.map((r, i) => [r.id, i + 1]));

    const poolsOut = pools.map((p) => {
      const ms = members.filter((m) => m.pool_id === p.id).map((m) => ({ ...byId.get(m.fencer_id), position: m.position }));
      const bouts = poolBouts.filter((b) => b.pool_id === p.id);
      const local = T.computePoolStats(ms, bouts);
      const localRank = new Map(T.rankStats([...local.values()]).map((s) => [s.id, s.rank]));
      return {
        ...p,
        members: ms.map((m) => ({ ...m, ...local.get(m.id), pool_rank: localRank.get(m.id) })),
        bouts,
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
      r.bouts.push(b);
    }

    return {
      day: { ...d, number: dayNumber(d.id), status },
      fencers: fencers.map((f) => ({ ...f, seed: seedOf.get(f.id) ?? null })),
      pools: poolsOut,
      poolsDone,
      ranking,
      bracket: rounds,
      finalRanking: final,
    };
  }

  // Riepilogo del torneo: anagrafica, giornate e classifica generale a punti.
  function tournament() {
    const roster = getRoster();
    const days = getDays().map((d) => fullDay(d.id));
    const rows = new Map(roster.map((f) => [f.id, {
      ...f, total: 0, presences: 0, results: {}, counts: { 10: 0, 7: 0, 5: 0, 3: 0, 1: 0 },
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
    const cmp = (a, b) => b.total - a.total || [10, 7, 5, 3, 1].reduce((acc, k) => acc || b.counts[k] - a.counts[k], 0);
    const leaderboard = [...rows.values()].sort((a, b) => cmp(a, b) || byName(a, b));
    leaderboard.forEach((r, i) => {
      r.rank = i > 0 && cmp(leaderboard[i - 1], r) === 0 ? leaderboard[i - 1].rank : i + 1;
    });

    const locked = new Set(db.prepare(`SELECT DISTINCT pm.fencer_id FROM pool_members pm`).all().map((r) => r.fencer_id));

    return {
      name: TOURNAMENT_NAME,
      fencers: roster.map((f) => ({ ...f, presences: rows.get(f.id).presences, locked: locked.has(f.id) })),
      days: days.map((d) => ({
        ...d.day,
        present: d.fencers.length,
        podium: d.finalRanking ? d.finalRanking.filter((r) => r.place <= 3) : null,
      })),
      leaderboard,
    };
  }

  const state = (dayId) => ({ tournament: tournament(), ...(dayId ? fullDay(dayId) : {}) });

  // ---------- Validazione input ----------

  function fencerInput(body) {
    const last_name = String(body.last_name ?? '').trim();
    const first_name = String(body.first_name ?? '').trim();
    const club = String(body.club ?? '').trim();
    if (!last_name) fail('Il cognome è obbligatorio');
    return { last_name, first_name, club };
  }

  // Formato: una riga per tiratore, "Cognome; Nome; Società" (separatori ; tab o ,)
  function parseBulk(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [last_name = '', first_name = '', club = ''] = l.split(/\s*[;\t,]\s*/);
        return fencerInput({ last_name, first_name, club });
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

  const route = (fn) => (req, res) => {
    try {
      const result = fn(req, res);
      res.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Errore interno del server' });
    }
  };

  // ---------- Torneo e anagrafica ----------

  app.get('/api/tournament', route(() => state()));

  const insFencer = db.prepare('INSERT INTO fencers (last_name, first_name, club) VALUES (?, ?, ?)');

  app.post('/api/fencers', route((req) => {
    const list = req.body.bulk !== undefined ? parseBulk(req.body.bulk) : [fencerInput(req.body)];
    if (!list.length) fail('Nessun iscritto da aggiungere');
    // Facoltativo: segna subito il nuovo iscritto come presente in una giornata.
    const dayId = req.body.day_id ? getDay(req.body.day_id).id : null;
    if (dayId && hasPools(dayId)) fail('I gironi della giornata sono già stati generati: eliminali per cambiare i presenti');
    db.transaction(() => list.forEach((f) => {
      const id = insFencer.run(f.last_name, f.first_name, f.club).lastInsertRowid;
      if (dayId) db.prepare('INSERT INTO day_fencers (day_id, fencer_id) VALUES (?, ?)').run(dayId, id);
    }))();
    return state(dayId);
  }));

  app.put('/api/fencers/:id', route((req) => {
    const f = db.prepare('SELECT * FROM fencers WHERE id = ?').get(Number(req.params.id));
    if (!f) fail('Iscritto non trovato', 404);
    const d = fencerInput(req.body);
    db.prepare('UPDATE fencers SET last_name = ?, first_name = ?, club = ? WHERE id = ?')
      .run(d.last_name, d.first_name, d.club, f.id);
    return state();
  }));

  app.delete('/api/fencers/:id', route((req) => {
    const f = db.prepare('SELECT * FROM fencers WHERE id = ?').get(Number(req.params.id));
    if (!f) fail('Iscritto non trovato', 404);
    if (db.prepare('SELECT 1 FROM pool_members WHERE fencer_id = ?').get(f.id)) {
      fail('Questo tiratore ha già tirato in una giornata: non può essere eliminato dall\'anagrafica');
    }
    db.prepare('DELETE FROM fencers WHERE id = ?').run(f.id);
    return state();
  }));

  // ---------- Giornate ----------

  app.post('/api/days', route((req) => {
    const d = dayInput(req.body);
    const id = Number(db.prepare('INSERT INTO days (date, location) VALUES (?, ?)').run(d.date, d.location).lastInsertRowid);
    return state(id);
  }));

  app.get('/api/days/:id', route((req) => state(getDay(req.params.id).id)));

  app.put('/api/days/:id', route((req) => {
    const day = getDay(req.params.id);
    const d = dayInput(req.body);
    db.prepare('UPDATE days SET date = ?, location = ? WHERE id = ?').run(d.date, d.location, day.id);
    return state(day.id);
  }));

  app.delete('/api/days/:id', route((req) => {
    const day = getDay(req.params.id);
    db.prepare('DELETE FROM days WHERE id = ?').run(day.id);
    return state();
  }));

  app.put('/api/days/:id/presence', route((req) => {
    const day = getDay(req.params.id);
    if (hasPools(day.id)) fail('I gironi sono già stati generati: eliminali per cambiare i presenti');
    if (!Array.isArray(req.body.fencer_ids)) fail('Elenco dei presenti non valido');
    const ids = [...new Set(req.body.fencer_ids.map(Number))];
    const known = new Set(getRoster().map((f) => f.id));
    if (ids.some((x) => !known.has(x))) fail('Uno dei tiratori selezionati non è iscritto al torneo');
    db.transaction(() => {
      db.prepare('DELETE FROM day_fencers WHERE day_id = ?').run(day.id);
      const ins = db.prepare('INSERT INTO day_fencers (day_id, fencer_id) VALUES (?, ?)');
      ids.forEach((fid) => ins.run(day.id, fid));
    })();
    return state(day.id);
  }));

  // ---------- Gironi ----------

  app.post('/api/days/:id/pools', route((req) => {
    const day = getDay(req.params.id);
    if (hasBracket(day.id)) fail('Il tabellone è già stato generato: eliminalo prima di rigenerare i gironi');
    let pools;
    try {
      pools = T.generatePools(getPresent(day.id), T.POOL_MAX_SIZE);
    } catch (e) {
      fail(e.message.replace('partecipanti', 'presenti'));
    }
    db.transaction(() => {
      db.prepare('DELETE FROM pools WHERE day_id = ?').run(day.id);
      const insPool = db.prepare('INSERT INTO pools (day_id, number) VALUES (?, ?)');
      const insMember = db.prepare('INSERT INTO pool_members (pool_id, fencer_id, position) VALUES (?, ?, ?)');
      const insBout = db.prepare('INSERT INTO pool_bouts (pool_id, bout_order, fencer_a, fencer_b) VALUES (?, ?, ?, ?)');
      pools.forEach((members, i) => {
        const poolId = insPool.run(day.id, i + 1).lastInsertRowid;
        members.forEach((f, pos) => insMember.run(poolId, f.id, pos + 1));
        T.boutOrder(members.length).forEach(([a, b], k) =>
          insBout.run(poolId, k + 1, members[a - 1].id, members[b - 1].id));
      });
    })();
    return state(day.id);
  }));

  app.delete('/api/days/:id/pools', route((req) => {
    const day = getDay(req.params.id);
    if (hasBracket(day.id)) fail('Il tabellone è già stato generato: eliminalo prima di eliminare i gironi');
    db.prepare('DELETE FROM pools WHERE day_id = ?').run(day.id);
    return state(day.id);
  }));

  app.put('/api/pool-bouts/:id', route((req) => {
    const b = db.prepare(`SELECT pb.*, p.day_id FROM pool_bouts pb JOIN pools p ON p.id = pb.pool_id
                          WHERE pb.id = ?`).get(Number(req.params.id));
    if (!b) fail('Assalto non trovato', 404);
    const day = getDay(b.day_id);
    if (hasBracket(day.id)) fail('Il tabellone è già stato generato: eliminalo per modificare i risultati dei gironi');
    const s = scoreInput(req.body);
    if (!s) {
      db.prepare('UPDATE pool_bouts SET score_a = NULL, score_b = NULL, winner_id = NULL WHERE id = ?').run(b.id);
    } else {
      let winner;
      try {
        winner = T.resolveWinner({ ...s, fencerA: b.fencer_a, fencerB: b.fencer_b, maxTouches: day.pool_touches });
      } catch (e) {
        fail(e.message);
      }
      db.prepare('UPDATE pool_bouts SET score_a = ?, score_b = ?, winner_id = ? WHERE id = ?')
        .run(s.scoreA, s.scoreB, winner, b.id);
    }
    return state(day.id);
  }));

  // ---------- Tabellone dirette ----------

  // Porta il vincitore nello slot corretto del turno successivo.
  function advance(did, bout, fencerId) {
    if (bout.round <= 2) return;
    const slot = bout.position % 2 === 0 ? 'a' : 'b';
    const seed = fencerId == null ? null : (fencerId === bout.fencer_a ? bout.seed_a : bout.seed_b);
    db.prepare(`UPDATE de_bouts SET fencer_${slot} = ?, seed_${slot} = ? WHERE day_id = ? AND round = ? AND position = ?`)
      .run(fencerId, seed, did, bout.round / 2, Math.floor(bout.position / 2));
  }

  const nextBout = (did, bout) => bout.round <= 2 ? null :
    db.prepare('SELECT * FROM de_bouts WHERE day_id = ? AND round = ? AND position = ?')
      .get(did, bout.round / 2, Math.floor(bout.position / 2));

  app.post('/api/days/:id/bracket', route((req) => {
    const day = getDay(req.params.id);
    const id = day.id;
    if (hasBracket(id)) fail('Il tabellone è già stato generato');
    if (!hasPools(id)) fail('Genera prima i gironi');
    const bouts = getPoolBouts(id);
    if (bouts.some((b) => b.winner_id == null)) fail('Completa tutti gli assalti dei gironi prima di generare il tabellone');
    const qualified = poolRanking(day, getPresent(id), bouts).filter((r) => r.qualified);
    if (qualified.length < 2) fail('Servono almeno 2 qualificati per il tabellone');

    const size = T.bracketSize(qualified.length);
    const positions = T.seedPositions(size);
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO de_bouts (day_id, round, position, fencer_a, fencer_b, seed_a, seed_b)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (let round = size; round >= 2; round /= 2) {
        for (let p = 0; p < round / 2; p++) {
          if (round === size) {
            const sa = positions[2 * p];
            const sb = positions[2 * p + 1];
            const fa = qualified[sa - 1]?.id ?? null;
            const fb = qualified[sb - 1]?.id ?? null;
            ins.run(id, round, p, fa, fb, fa ? sa : null, fb ? sb : null);
          } else {
            ins.run(id, round, p, null, null, null, null);
          }
        }
      }
      // Esenti (bye): la testa di serie passa direttamente al turno successivo.
      const first = db.prepare('SELECT * FROM de_bouts WHERE day_id = ? AND round = ?').all(id, size);
      for (const b of first) {
        if (b.fencer_a == null || b.fencer_b == null) {
          const w = b.fencer_a ?? b.fencer_b;
          db.prepare('UPDATE de_bouts SET winner_id = ?, is_bye = 1 WHERE id = ?').run(w, b.id);
          advance(id, b, w);
        }
      }
    })();
    return state(id);
  }));

  app.delete('/api/days/:id/bracket', route((req) => {
    const day = getDay(req.params.id);
    db.prepare('DELETE FROM de_bouts WHERE day_id = ?').run(day.id);
    return state(day.id);
  }));

  app.put('/api/de-bouts/:id', route((req) => {
    const b = db.prepare('SELECT * FROM de_bouts WHERE id = ?').get(Number(req.params.id));
    if (!b) fail('Assalto non trovato', 404);
    const day = getDay(b.day_id);
    if (b.is_bye) fail('Questo è un passaggio diretto (esente), non c\'è un risultato da inserire');
    if (b.fencer_a == null || b.fencer_b == null) fail('L\'assalto non ha ancora entrambi i tiratori');
    const next = nextBout(day.id, b);
    const nextPlayed = next && next.winner_id != null;
    const s = scoreInput(req.body);

    db.transaction(() => {
      if (!s) {
        if (nextPlayed) fail('Il turno successivo è già stato disputato: cancella prima quel risultato');
        db.prepare('UPDATE de_bouts SET score_a = NULL, score_b = NULL, winner_id = NULL WHERE id = ?').run(b.id);
        advance(day.id, { ...b, winner_id: null }, null);
        return;
      }
      let winner;
      try {
        winner = T.resolveWinner({ ...s, fencerA: b.fencer_a, fencerB: b.fencer_b, maxTouches: day.de_touches });
      } catch (e) {
        fail(e.message);
      }
      if (nextPlayed && winner !== b.winner_id) {
        fail('Il turno successivo è già stato disputato: cancella prima quel risultato per cambiare il vincitore');
      }
      db.prepare('UPDATE de_bouts SET score_a = ?, score_b = ?, winner_id = ? WHERE id = ?')
        .run(s.scoreA, s.scoreB, winner, b.id);
      advance(day.id, { ...b, winner_id: winner }, winner);
    })();
    return state(day.id);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 4020;
  createApp(open()).listen(PORT, () => {
    console.log(`🎄 ${TOURNAMENT_NAME} in ascolto su http://localhost:${PORT}`);
  });
}

module.exports = { createApp, TOURNAMENT_NAME };
