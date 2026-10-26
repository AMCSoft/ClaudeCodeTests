// SQLite integrato in Node (nessuna dipendenza nativa da compilare).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

function open(file = process.env.DB_FILE || path.join(__dirname, 'garespada.db')) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Stessa forma di better-sqlite3: db.transaction(fn)() esegue fn in una transazione.
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      pool_max_size INTEGER NOT NULL DEFAULT 7,
      pool_touches INTEGER NOT NULL DEFAULT 5,
      de_touches INTEGER NOT NULL DEFAULT 15,
      qualify_percent INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS fencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      last_name TEXT NOT NULL,
      first_name TEXT DEFAULT '',
      club TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      number INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pool_members (
      pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      fencer_id INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (pool_id, fencer_id)
    );
    CREATE TABLE IF NOT EXISTS pool_bouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      bout_order INTEGER NOT NULL,
      fencer_a INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      fencer_b INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      score_a INTEGER,
      score_b INTEGER,
      winner_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS de_bouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
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
      UNIQUE (competition_id, round, position)
    );
  `);
  return db;
}

module.exports = { open };
