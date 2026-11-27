// Accesso al database con due motori e la stessa interfaccia asincrona:
// - SQLite (modulo node:sqlite integrato) per l'uso locale, zero configurazione;
// - Postgres (es. Neon su Vercel) quando è impostata DATABASE_URL o POSTGRES_URL.
// Le query usano i segnaposto "?" e un sottoinsieme di SQL comune ai due motori.
const path = require('path');

// Colonne che gestiscono l'arbitraggio dallo scorer: chi ha in carico l'incontro
// (id segreto del dispositivo e nome), da quando, ultimo segnale e punteggio dal vivo.
const LOCK_COLUMNS = [
  ['scorer_id', 'TEXT'],
  ['scorer_name', 'TEXT'],
  ['locked_at', 'BIGINT'],
  ['seen_at', 'BIGINT'],
  ['live', 'TEXT'],
];

// Colonne aggiunte dopo la prima versione: ritiro di un tiratore nella giornata
// ('gironi' o 'dirette') e assalto di diretta vinto per ritiro (id di chi si è ritirato).
const EXTRA_COLUMNS = {
  pool_bouts: LOCK_COLUMNS,
  de_bouts: [...LOCK_COLUMNS, ['forfeit', 'INTEGER']],
  day_fencers: [['withdrawn', 'TEXT']],
};

const TABLES = ['de_bouts', 'pool_bouts', 'pool_members', 'pools', 'day_fencers', 'days', 'fencers'];

function schema(dialect) {
  const ID = dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const lock = LOCK_COLUMNS.map(([c, t]) => `${c} ${t}`).join(', ');
  return `
    CREATE TABLE IF NOT EXISTS fencers (
      id ${ID},
      last_name TEXT NOT NULL,
      first_name TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS days (
      id ${ID},
      date TEXT DEFAULT '',
      location TEXT DEFAULT '',
      pool_touches INTEGER NOT NULL DEFAULT 5,
      de_touches INTEGER NOT NULL DEFAULT 15,
      qualify_percent INTEGER NOT NULL DEFAULT 100,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS day_fencers (
      day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      fencer_id INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      withdrawn TEXT,
      PRIMARY KEY (day_id, fencer_id)
    );
    CREATE TABLE IF NOT EXISTS pools (
      id ${ID},
      day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      number INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pool_members (
      pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      fencer_id INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (pool_id, fencer_id)
    );
    CREATE TABLE IF NOT EXISTS pool_bouts (
      id ${ID},
      pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      bout_order INTEGER NOT NULL,
      fencer_a INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      fencer_b INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      score_a INTEGER,
      score_b INTEGER,
      winner_id INTEGER,
      ${lock}
    );
    CREATE TABLE IF NOT EXISTS de_bouts (
      id ${ID},
      day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      position INTEGER NOT NULL,
      fencer_a INTEGER REFERENCES fencers(id) ON DELETE SET NULL,
      fencer_b INTEGER REFERENCES fencers(id) ON DELETE SET NULL,
      seed_a INTEGER,
      seed_b INTEGER,
      score_a INTEGER,
      score_b INTEGER,
      winner_id INTEGER,
      is_bye INTEGER NOT NULL DEFAULT 0,
      forfeit INTEGER,
      ${lock},
      UNIQUE (day_id, round, position)
    );
  `;
}

function sqliteAdapter(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  const args = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const plain = (r) => (r ? { ...r } : null);
  // node:sqlite è sincrono: dentro una transazione nessun'altra richiesta può
  // inserirsi, perché le promesse si risolvono senza tornare al ciclo degli eventi.
  const db = {
    dialect: 'sqlite',
    async all(sql, p = []) { return stmt(sql).all(...args(p)).map(plain); },
    async get(sql, p = []) { return plain(stmt(sql).get(...args(p))); },
    async run(sql, p = []) { return { changes: Number(stmt(sql).run(...args(p)).changes) }; },
    async exec(sql) { raw.exec(sql); },
    async tx(fn) {
      raw.exec('BEGIN');
      try {
        const r = await fn(db);
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    async close() { raw.close(); },
  };
  return db;
}

function pgAdapter(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); // BIGINT e COUNT(*) come numeri
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10000 });
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const querier = (q) => ({
    dialect: 'pg',
    async all(sql, p = []) { return (await q(toPg(sql), p)).rows; },
    async get(sql, p = []) { return (await q(toPg(sql), p)).rows[0] ?? null; },
    async run(sql, p = []) { return { changes: (await q(toPg(sql), p)).rowCount }; },
  });
  return {
    ...querier((s, p) => pool.query(s, p)),
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(querier((s, p) => client.query(s, p)));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function migrate(db, { reset = false } = {}) {
  if (reset) {
    for (const t of TABLES) await db.exec(`DROP TABLE IF EXISTS ${t}${db.dialect === 'pg' ? ' CASCADE' : ''}`);
  }
  await db.exec(schema(db.dialect));
  // Database creati con una versione precedente: aggiunge le colonne mancanti.
  for (const [table, cols] of Object.entries(EXTRA_COLUMNS)) {
    if (db.dialect === 'pg') {
      await db.exec(cols.map(([c, t]) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${c} ${t}`).join(';\n'));
    } else {
      const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name));
      for (const [c, t] of cols) if (!have.has(c)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${t}`);
    }
  }
}

// open({ file }) usa SQLite; open({ url }) o le variabili d'ambiente usano Postgres.
async function open(opts = {}) {
  const url = opts.file ? null : opts.url || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const db = url
    ? pgAdapter(url)
    : sqliteAdapter(opts.file || process.env.DB_FILE || path.join(__dirname, 'xmascup.db'));
  try {
    await migrate(db, opts);
  } catch (e) {
    // Due istanze serverless che creano le tabelle insieme: basta riprovare.
    if (db.dialect !== 'pg') throw e;
    await new Promise((r) => setTimeout(r, 300));
    await migrate(db);
  }
  return db;
}

module.exports = { open };
