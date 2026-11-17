// SQLite integrato in Node (nessuna dipendenza nativa da compilare).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

function open(file = process.env.DB_FILE || path.join(__dirname, 'xmascup.db')) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // db.transaction(fn)() esegue fn in una transazione.
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
    -- Anagrafica unica del torneo: tutti gli iscritti alla XMas Cup.
    CREATE TABLE IF NOT EXISTS fencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      last_name TEXT NOT NULL,
      first_name TEXT DEFAULT '',
      club TEXT DEFAULT ''
    );
    -- Ogni giornata è una gara completa (gironi + dirette) tra i soli presenti.
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT DEFAULT '',
      location TEXT DEFAULT '',
      pool_touches INTEGER NOT NULL DEFAULT 5,
      de_touches INTEGER NOT NULL DEFAULT 15,
      qualify_percent INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS day_fencers (
      day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      fencer_id INTEGER NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
      PRIMARY KEY (day_id, fencer_id)
    );
    CREATE TABLE IF NOT EXISTS pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      UNIQUE (day_id, round, position)
    );
  `);
  return db;
}

module.exports = { open };
