# 🎃 Spooky Mosciolino

Web app locale per gestire **gare amichevoli di spada**, a tema Halloween. Il simbolo è il *mosciolino*: il mosciolo, la cozza selvatica del Conero, qui intagliato come una zucca, con cappello da strega e spada in pugno.

## Funzionalità

- **Competizioni**: crea, modifica ed elimina. Ogni gara ha nome, data, luogo, note, dimensione massima dei gironi, stoccate nei gironi e nelle dirette, percentuale di qualificati.
- **Partecipanti**: aggiunta singola, modifica in linea, eliminazione e importazione di un elenco (`Cognome; Nome; Società`, una riga per tiratore, si può incollare da Excel).
- **Gironi casuali**: gironi bilanciati (es. 20 tiratori con massimo 7 → 7, 7, 6). La composizione è casuale ma separa il più possibile i tiratori della stessa società. L'ordine degli assalti segue le tabelle FIE.
- **Risultati dei gironi**: la matrice del girone (V5/D3) si aggiorna mentre inserisci i punteggi. Come nella spada, non esiste il pari: a punteggio pari si indica chi vince alla priorità.
- **Classifica dopo i gironi**: V/M, poi indice (TS−TR), poi stoccate date. Indica chi si qualifica.
- **Tabellone delle dirette**: tabellone a 2ⁿ con le teste di serie nelle posizioni standard (1–16, 8–9, …) e gli esenti assegnati alle prime teste di serie. Clicca un assalto per inserire il risultato: il vincitore passa al turno successivo.
- **Correzioni**: un risultato si può modificare finché il turno successivo non è stato disputato. Si possono rigenerare gironi e tabellone, con conferma.
- **Classifica finale**: podio con due terzi posti ex aequo, poi 5°, 9°, ecc. per turno di eliminazione, e infine i non qualificati.

## Avvio

Serve Node.js 22.13 o superiore (consigliato Node 24). Non ci sono dipendenze native da compilare.

```bash
cd GareSpada
npm install
npm start
```

Apri http://localhost:4010.

Il database SQLite `garespada.db` viene creato automaticamente nella cartella al primo avvio. Per cambiare porta o file: `PORT=5000 DB_FILE=/percorso/gara.db npm start`.

## Test

```bash
npm test
```

## Struttura

- `server.js`: API Express e regole di gestione (blocchi, avanzamento nel tabellone)
- `db.js`: schema SQLite (modulo `node:sqlite` integrato in Node, nessuna compilazione)
- `lib/tournament.js`: logica pura (gironi, ordine assalti, classifiche, teste di serie)
- `public/`: interfaccia (HTML/CSS/JS senza build) e logo `mosciolino.svg`
- `test/`: test con `node --test`
