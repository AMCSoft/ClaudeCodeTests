// Logica pura del torneo: gironi, ordine degli assalti, classifiche e tabellone.
// Nessun accesso al database qui, così è testabile in isolamento.

// Gironi da massimo 7 tiratori; le dimensioni differiscono al più di 1.
const POOL_MAX_SIZE = 7;

// Ordine degli assalti nei gironi (tabelle FIE). Indici 1-based sulla posizione nel girone.
const BOUT_ORDERS = {
  2: [[1, 2]],
  3: [[1, 2], [2, 3], [3, 1]],
  4: [[1, 4], [2, 3], [1, 3], [2, 4], [3, 4], [1, 2]],
  5: [[1, 2], [3, 4], [5, 1], [2, 3], [5, 4], [1, 3], [2, 5], [4, 1], [3, 5], [4, 2]],
  6: [[1, 2], [4, 5], [2, 3], [5, 6], [3, 1], [6, 4], [2, 5], [1, 4], [5, 3], [1, 6], [4, 2], [3, 6], [5, 1], [3, 4], [6, 2]],
  7: [[1, 4], [2, 5], [3, 6], [7, 1], [5, 4], [2, 3], [6, 7], [5, 1], [4, 3], [6, 2], [5, 7], [3, 1], [4, 6], [7, 2], [3, 5], [1, 6], [2, 4], [7, 3], [6, 5], [1, 2], [4, 7]],
};

// Ordine generico (metodo del cerchio) per gironi di dimensione non tabellata.
function roundRobinOrder(n) {
  const slots = [];
  for (let i = 1; i <= n; i++) slots.push(i);
  if (n % 2 === 1) slots.push(null);
  const m = slots.length;
  const order = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = slots[i];
      const b = slots[m - 1 - i];
      if (a !== null && b !== null) order.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    slots.splice(1, 0, slots.pop());
  }
  return order;
}

function boutOrder(n) {
  return BOUT_ORDERS[n] || roundRobinOrder(n);
}

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function poolSizes(n, maxSize) {
  const count = Math.ceil(n / maxSize);
  const base = Math.floor(n / count);
  const extra = n % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

function clubKey(f) {
  return (f.club || '').trim().toLowerCase();
}

// Distribuisce casualmente i tiratori nei gironi, cercando di separare
// chi appartiene alla stessa società. Restituisce un array di array di tiratori.
function generatePools(fencers, maxSize, rnd = Math.random) {
  if (fencers.length < 2) throw new Error('Servono almeno 2 partecipanti per generare i gironi');
  if (maxSize < 3) throw new Error('La dimensione massima del girone deve essere almeno 3');
  const count = poolSizes(fencers.length, maxSize).length;
  const pools = Array.from({ length: count }, () => []);

  // Raggruppa per società (ordine casuale dentro ogni gruppo), le più numerose prima;
  // chi non ha società fa gruppo a sé. Poi distribuisce come un mazzo di carte:
  // i compagni di società finiscono in gironi consecutivi diversi, quindi ogni
  // girone ne riceve al massimo ceil(tesserati / gironi).
  const groups = new Map();
  shuffle(fencers, rnd).forEach((f, i) => {
    const k = clubKey(f) || `__solo${i}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  });
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length).flat();
  ordered.forEach((f, i) => pools[i % count].push(f));

  // Numerazione dei gironi e posizione nel girone (che determina l'ordine degli assalti) casuali.
  return shuffle(pools, rnd).map((p) => shuffle(p, rnd));
}

// Valida un risultato. Restituisce l'id del vincitore o lancia un errore.
// Nella spada non esiste il pari: se il punteggio è in parità (tempo scaduto,
// minuto di priorità) bisogna indicare esplicitamente il vincitore.
function resolveWinner({ scoreA, scoreB, winnerId, fencerA, fencerB, maxTouches }) {
  for (const s of [scoreA, scoreB]) {
    if (!Number.isInteger(s) || s < 0) throw new Error('I punteggi devono essere numeri interi non negativi');
    if (s > maxTouches) throw new Error(`Il punteggio massimo è ${maxTouches}`);
  }
  if (scoreA === maxTouches && scoreB === maxTouches) {
    throw new Error(`Entrambi i tiratori non possono arrivare a ${maxTouches} stoccate`);
  }
  if (scoreA > scoreB) return fencerA;
  if (scoreB > scoreA) return fencerB;
  if (winnerId !== fencerA && winnerId !== fencerB) {
    throw new Error('Punteggio in parità: indica chi ha vinto alla priorità');
  }
  return winnerId;
}

// Statistiche e classifica dopo i gironi.
// fencers: [{id, ...}], bouts: [{fencer_a, fencer_b, score_a, score_b, winner_id}]
function computePoolStats(fencers, bouts) {
  const stats = new Map();
  for (const f of fencers) stats.set(f.id, { ...f, v: 0, m: 0, ts: 0, tr: 0 });
  for (const b of bouts) {
    if (b.winner_id == null) continue;
    const a = stats.get(b.fencer_a);
    const c = stats.get(b.fencer_b);
    if (!a || !c) continue;
    a.m++; c.m++;
    a.ts += b.score_a; a.tr += b.score_b;
    c.ts += b.score_b; c.tr += b.score_a;
    if (b.winner_id === b.fencer_a) a.v++; else c.v++;
  }
  for (const s of stats.values()) {
    s.ind = s.ts - s.tr;
    s.vm = s.m ? s.v / s.m : 0;
  }
  return stats;
}

function compareStats(a, b) {
  return b.vm - a.vm || b.ind - a.ind || b.ts - a.ts;
}

// Ordina e assegna il piazzamento (con ex aequo).
function rankStats(statsList, tieBreak = (a, b) => 0) {
  const sorted = statsList.slice().sort((a, b) => compareStats(a, b) || tieBreak(a, b));
  sorted.forEach((s, i) => {
    s.rank = i > 0 && compareStats(sorted[i - 1], s) === 0 ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

// Ordine delle teste di serie nelle posizioni del tabellone (1 contro N, ecc.).
function seedPositions(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    order.forEach((s, i) => {
      if (i % 2 === 0) next.push(s, n + 1 - s);
      else next.push(n + 1 - s, s);
    });
    order = next;
  }
  return order;
}

function bracketSize(n) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

function qualifiedCount(total, percent) {
  if (total < 2) return total;
  return Math.max(2, Math.min(total, Math.round((total * percent) / 100)));
}

// Etichetta del turno a partire dal numero di tiratori nel turno.
function roundLabel(round) {
  if (round === 2) return 'Finale';
  if (round === 4) return 'Semifinali';
  if (round === 8) return 'Quarti';
  return `Tabellone dei ${round}`;
}

module.exports = {
  POOL_MAX_SIZE,
  BOUT_ORDERS,
  boutOrder,
  roundRobinOrder,
  shuffle,
  poolSizes,
  generatePools,
  resolveWinner,
  computePoolStats,
  compareStats,
  rankStats,
  seedPositions,
  bracketSize,
  qualifiedCount,
  roundLabel,
};
