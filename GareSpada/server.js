const express = require('express');
const path = require('path');
const { open } = require('./db');
const T = require('./lib/tournament');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (message, status = 400) => {
  throw new HttpError(status, message);
};

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- Accesso ai dati ----------

  const getCompetition = (id) => {
    const c = db.prepare('SELECT * FROM competitions WHERE id = ?').get(id);
    if (!c) fail('Competizione non trovata', 404);
    return c;
  };
  const getFencers = (cid) =>
    db.prepare('SELECT * FROM fencers WHERE competition_id = ? ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE').all(cid);
  const getPools = (cid) => db.prepare('SELECT * FROM pools WHERE competition_id = ? ORDER BY number').all(cid);
  const getPoolBouts = (cid) =>
    db.prepare(`SELECT pb.* FROM pool_bouts pb JOIN pools p ON p.id = pb.pool_id
                WHERE p.competition_id = ? ORDER BY p.number, pb.bout_order`).all(cid);
  const getDeBouts = (cid) =>
    db.prepare('SELECT * FROM de_bouts WHERE competition_id = ? ORDER BY round DESC, position').all(cid);
  const hasPools = (cid) => !!db.prepare('SELECT 1 FROM pools WHERE competition_id = ?').get(cid);
  const hasBracket = (cid) => !!db.prepare('SELECT 1 FROM de_bouts WHERE competition_id = ?').get(cid);

  function poolRanking(c, fencers, bouts) {
    const stats = T.computePoolStats(fencers, bouts);
    const ranked = T.rankStats([...stats.values()], (a, b) =>
      a.last_name.localeCompare(b.last_name, 'it') || (a.first_name || '').localeCompare(b.first_name || '', 'it'));
    const q = T.qualifiedCount(ranked.length, c.qualify_percent);
    ranked.forEach((s, i) => { s.qualified = i < q; });
    return ranked;
  }

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
    // I non qualificati seguono, nell'ordine della classifica dei gironi.
    out.forEach((r, i) => {
      r.place = i > 0 && r.rank === out[i - 1].rank ? out[i - 1].place : inBracket.length + i + 1;
    });
    return [...inBracket, ...out];
  }

  function fullCompetition(id) {
    const c = getCompetition(id);
    const fencers = getFencers(id);
    const byId = new Map(fencers.map((f) => [f.id, f]));
    const pools = getPools(id);
    const poolBouts = getPoolBouts(id);
    const deBouts = getDeBouts(id);
    const members = db.prepare(`SELECT pm.* FROM pool_members pm JOIN pools p ON p.id = pm.pool_id
                                WHERE p.competition_id = ? ORDER BY pm.position`).all(id);

    const ranking = pools.length ? poolRanking(c, fencers, poolBouts) : [];
    const rankById = new Map(ranking.map((r) => [r.id, r]));

    const poolsOut = pools.map((p) => {
      const ms = members.filter((m) => m.pool_id === p.id).map((m) => ({ ...byId.get(m.fencer_id), position: m.position }));
      const bouts = poolBouts.filter((b) => b.pool_id === p.id);
      const local = T.computePoolStats(ms, bouts);
      const localRanked = T.rankStats([...local.values()]);
      const localRank = new Map(localRanked.map((s) => [s.id, s.rank]));
      return {
        ...p,
        members: ms.map((m) => ({ ...m, ...local.get(m.id), pool_rank: localRank.get(m.id) })),
        bouts,
        done: bouts.every((b) => b.winner_id != null),
      };
    });

    const poolsDone = pools.length > 0 && poolBouts.every((b) => b.winner_id != null);
    const final = finalRanking(deBouts, ranking);
    let status = 'iscrizioni';
    if (pools.length) status = poolsDone ? 'gironi_conclusi' : 'gironi';
    if (deBouts.length) status = final ? 'conclusa' : 'dirette';

    const rounds = [];
    for (const b of deBouts) {
      let r = rounds.find((x) => x.round === b.round);
      if (!r) rounds.push((r = { round: b.round, label: T.roundLabel(b.round), bouts: [] }));
      r.bouts.push(b);
    }

    return {
      competition: { ...c, status },
      fencers: fencers.map((f) => ({ ...f, seed: rankById.has(f.id) ? ranking.indexOf(rankById.get(f.id)) + 1 : null })),
      pools: poolsOut,
      poolsDone,
      ranking,
      bracket: rounds,
      finalRanking: final,
    };
  }

  // ---------- Validazione input ----------

  function competitionInput(body, partial = false) {
    const out = {};
    const str = (k) => {
      if (body[k] !== undefined) out[k] = String(body[k] ?? '').trim();
    };
    const int = (k, min, max, label) => {
      if (body[k] === undefined) return;
      const v = Number(body[k]);
      if (!Number.isInteger(v) || v < min || v > max) fail(`${label}: inserisci un numero tra ${min} e ${max}`);
      out[k] = v;
    };
    ['name', 'date', 'location', 'notes'].forEach(str);
    int('pool_max_size', 3, 12, 'Dimensione massima girone');
    int('pool_touches', 1, 15, 'Stoccate nei gironi');
    int('de_touches', 1, 45, 'Stoccate nelle dirette');
    int('qualify_percent', 1, 100, 'Percentuale qualificati');
    if (!partial || out.name !== undefined) {
      if (!out.name) fail('Il nome della competizione è obbligatorio');
    }
    return out;
  }

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

  // ---------- Competizioni ----------

  app.get('/api/competitions', route(() =>
    db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM fencers f WHERE f.competition_id = c.id) AS fencer_count
                FROM competitions c ORDER BY c.date DESC, c.id DESC`).all()
      .map((c) => ({ ...c, status: fullCompetition(c.id).competition.status }))));

  app.post('/api/competitions', route((req) => {
    const d = competitionInput(req.body);
    const cols = Object.keys(d);
    const info = db.prepare(`INSERT INTO competitions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((k) => d[k]));
    return fullCompetition(info.lastInsertRowid);
  }));

  app.get('/api/competitions/:id', route((req) => fullCompetition(Number(req.params.id))));

  app.put('/api/competitions/:id', route((req) => {
    const id = Number(req.params.id);
    getCompetition(id);
    const d = competitionInput(req.body, true);
    const cols = Object.keys(d);
    if (cols.length) {
      db.prepare(`UPDATE competitions SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((k) => d[k]), id);
    }
    return fullCompetition(id);
  }));

  app.delete('/api/competitions/:id', route((req) => {
    getCompetition(Number(req.params.id));
    db.prepare('DELETE FROM competitions WHERE id = ?').run(Number(req.params.id));
  }));

  // ---------- Partecipanti ----------

  app.post('/api/competitions/:id/fencers', route((req) => {
    const id = Number(req.params.id);
    getCompetition(id);
    if (hasPools(id)) fail('I gironi sono già stati generati: eliminali per modificare l\'elenco dei partecipanti');
    const list = req.body.bulk !== undefined ? parseBulk(req.body.bulk) : [fencerInput(req.body)];
    if (!list.length) fail('Nessun partecipante da aggiungere');
    const ins = db.prepare('INSERT INTO fencers (competition_id, last_name, first_name, club) VALUES (?, ?, ?, ?)');
    db.transaction(() => list.forEach((f) => ins.run(id, f.last_name, f.first_name, f.club)))();
    return fullCompetition(id);
  }));

  app.put('/api/fencers/:id', route((req) => {
    const f = db.prepare('SELECT * FROM fencers WHERE id = ?').get(Number(req.params.id));
    if (!f) fail('Partecipante non trovato', 404);
    const d = fencerInput(req.body);
    db.prepare('UPDATE fencers SET last_name = ?, first_name = ?, club = ? WHERE id = ?')
      .run(d.last_name, d.first_name, d.club, f.id);
    return fullCompetition(f.competition_id);
  }));

  app.delete('/api/fencers/:id', route((req) => {
    const f = db.prepare('SELECT * FROM fencers WHERE id = ?').get(Number(req.params.id));
    if (!f) fail('Partecipante non trovato', 404);
    if (hasPools(f.competition_id)) fail('I gironi sono già stati generati: eliminali per rimuovere un partecipante');
    db.prepare('DELETE FROM fencers WHERE id = ?').run(f.id);
    return fullCompetition(f.competition_id);
  }));

  // ---------- Gironi ----------

  app.post('/api/competitions/:id/pools', route((req) => {
    const id = Number(req.params.id);
    const c = getCompetition(id);
    if (hasBracket(id)) fail('Il tabellone è già stato generato: eliminalo prima di rigenerare i gironi');
    const fencers = getFencers(id);
    let pools;
    try {
      pools = T.generatePools(fencers, c.pool_max_size);
    } catch (e) {
      fail(e.message);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM pools WHERE competition_id = ?').run(id);
      const insPool = db.prepare('INSERT INTO pools (competition_id, number) VALUES (?, ?)');
      const insMember = db.prepare('INSERT INTO pool_members (pool_id, fencer_id, position) VALUES (?, ?, ?)');
      const insBout = db.prepare('INSERT INTO pool_bouts (pool_id, bout_order, fencer_a, fencer_b) VALUES (?, ?, ?, ?)');
      pools.forEach((members, i) => {
        const poolId = insPool.run(id, i + 1).lastInsertRowid;
        members.forEach((f, pos) => insMember.run(poolId, f.id, pos + 1));
        T.boutOrder(members.length).forEach(([a, b], k) =>
          insBout.run(poolId, k + 1, members[a - 1].id, members[b - 1].id));
      });
    })();
    return fullCompetition(id);
  }));

  app.delete('/api/competitions/:id/pools', route((req) => {
    const id = Number(req.params.id);
    getCompetition(id);
    if (hasBracket(id)) fail('Il tabellone è già stato generato: eliminalo prima di eliminare i gironi');
    db.prepare('DELETE FROM pools WHERE competition_id = ?').run(id);
    return fullCompetition(id);
  }));

  app.put('/api/pool-bouts/:id', route((req) => {
    const b = db.prepare(`SELECT pb.*, p.competition_id FROM pool_bouts pb JOIN pools p ON p.id = pb.pool_id
                          WHERE pb.id = ?`).get(Number(req.params.id));
    if (!b) fail('Assalto non trovato', 404);
    const c = getCompetition(b.competition_id);
    if (hasBracket(c.id)) fail('Il tabellone è già stato generato: eliminalo per modificare i risultati dei gironi');
    const s = scoreInput(req.body);
    if (!s) {
      db.prepare('UPDATE pool_bouts SET score_a = NULL, score_b = NULL, winner_id = NULL WHERE id = ?').run(b.id);
    } else {
      let winner;
      try {
        winner = T.resolveWinner({ ...s, fencerA: b.fencer_a, fencerB: b.fencer_b, maxTouches: c.pool_touches });
      } catch (e) {
        fail(e.message);
      }
      db.prepare('UPDATE pool_bouts SET score_a = ?, score_b = ?, winner_id = ? WHERE id = ?')
        .run(s.scoreA, s.scoreB, winner, b.id);
    }
    return fullCompetition(c.id);
  }));

  // ---------- Tabellone dirette ----------

  // Porta il vincitore nello slot corretto del turno successivo.
  function advance(cid, bout, fencerId) {
    if (bout.round <= 2) return;
    const slot = bout.position % 2 === 0 ? 'a' : 'b';
    const seed = fencerId == null ? null : (fencerId === bout.fencer_a ? bout.seed_a : bout.seed_b);
    db.prepare(`UPDATE de_bouts SET fencer_${slot} = ?, seed_${slot} = ? WHERE competition_id = ? AND round = ? AND position = ?`)
      .run(fencerId, seed, cid, bout.round / 2, Math.floor(bout.position / 2));
  }

  const nextBout = (cid, bout) => bout.round <= 2 ? null :
    db.prepare('SELECT * FROM de_bouts WHERE competition_id = ? AND round = ? AND position = ?')
      .get(cid, bout.round / 2, Math.floor(bout.position / 2));

  app.post('/api/competitions/:id/bracket', route((req) => {
    const id = Number(req.params.id);
    const c = getCompetition(id);
    if (hasBracket(id)) fail('Il tabellone è già stato generato');
    if (!hasPools(id)) fail('Genera prima i gironi');
    const bouts = getPoolBouts(id);
    if (bouts.some((b) => b.winner_id == null)) fail('Completa tutti gli assalti dei gironi prima di generare il tabellone');
    const qualified = poolRanking(c, getFencers(id), bouts).filter((r) => r.qualified);
    if (qualified.length < 2) fail('Servono almeno 2 qualificati per il tabellone');

    const size = T.bracketSize(qualified.length);
    const positions = T.seedPositions(size);
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO de_bouts (competition_id, round, position, fencer_a, fencer_b, seed_a, seed_b)
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
      const first = db.prepare('SELECT * FROM de_bouts WHERE competition_id = ? AND round = ?').all(id, size);
      for (const b of first) {
        if (b.fencer_a == null || b.fencer_b == null) {
          const w = b.fencer_a ?? b.fencer_b;
          db.prepare('UPDATE de_bouts SET winner_id = ?, is_bye = 1 WHERE id = ?').run(w, b.id);
          advance(id, b, w);
        }
      }
    })();
    return fullCompetition(id);
  }));

  app.delete('/api/competitions/:id/bracket', route((req) => {
    const id = Number(req.params.id);
    getCompetition(id);
    db.prepare('DELETE FROM de_bouts WHERE competition_id = ?').run(id);
    return fullCompetition(id);
  }));

  app.put('/api/de-bouts/:id', route((req) => {
    const b = db.prepare('SELECT * FROM de_bouts WHERE id = ?').get(Number(req.params.id));
    if (!b) fail('Assalto non trovato', 404);
    const c = getCompetition(b.competition_id);
    if (b.is_bye) fail('Questo è un passaggio diretto (esente), non c\'è un risultato da inserire');
    if (b.fencer_a == null || b.fencer_b == null) fail('L\'assalto non ha ancora entrambi i tiratori');
    const next = nextBout(c.id, b);
    const nextPlayed = next && next.winner_id != null;
    const s = scoreInput(req.body);

    db.transaction(() => {
      if (!s) {
        if (nextPlayed) fail('Il turno successivo è già stato disputato: cancella prima quel risultato');
        db.prepare('UPDATE de_bouts SET score_a = NULL, score_b = NULL, winner_id = NULL WHERE id = ?').run(b.id);
        advance(c.id, { ...b, winner_id: null }, null);
        return;
      }
      let winner;
      try {
        winner = T.resolveWinner({ ...s, fencerA: b.fencer_a, fencerB: b.fencer_b, maxTouches: c.de_touches });
      } catch (e) {
        fail(e.message);
      }
      if (nextPlayed && winner !== b.winner_id) {
        fail('Il turno successivo è già stato disputato: cancella prima quel risultato per cambiare il vincitore');
      }
      db.prepare('UPDATE de_bouts SET score_a = ?, score_b = ?, winner_id = ? WHERE id = ?')
        .run(s.scoreA, s.scoreB, winner, b.id);
      advance(c.id, { ...b, winner_id: winner }, winner);
    })();
    return fullCompetition(c.id);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 4010;
  createApp(open()).listen(PORT, () => {
    console.log(`🎃 Gare di Spada del Mosciolino in ascolto su http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
