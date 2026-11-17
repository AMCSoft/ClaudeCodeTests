// Su Vercel tutte le richieste /api/* arrivano qui (vedi vercel.json): è la stessa
// app Express dell'uso locale, con il database Postgres indicato da DATABASE_URL.
// Le pagine in public/ sono servite direttamente dalla CDN di Vercel.
const { open } = require('../db');
const { createApp } = require('../server');

let appPromise;

module.exports = async (req, res) => {
  appPromise ||= open().then((db) => createApp(db)).catch((e) => {
    appPromise = null;
    throw e;
  });
  try {
    const app = await appPromise;
    return app(req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database non raggiungibile: controlla DATABASE_URL nelle impostazioni di Vercel' }));
  }
};
