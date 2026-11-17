# 🎄 Fanum Fortunae XMas Cup

Web app locale per gestire la **Fanum Fortunae XMas Cup**, torneo di **spada** a tema natalizio che si svolge su più giornate.

## Come funziona

1. **Iscritti** (menu 🎅 Iscritti): all'inizio si inserisce l'elenco di tutti gli iscritti al torneo, uno alla volta o importando un elenco (`Cognome; Nome`, una riga per tiratore, si può incollare da Excel). La società non si indica: siamo tutti della Fanum Fortunae Scherma.
2. **Nuova giornata** (dalla pagina principale): si crea la giornata con data ed eventualmente il luogo.
3. **Presenti**: si spuntano gli iscritti presenti quel giorno (c'è la ricerca e i pulsanti Tutti/Nessuno). Se arriva qualcuno che non era in elenco lo si aggiunge al torneo e viene segnato subito presente.
4. **Gironi e dirette** solo con i presenti, come nello Spooky Mosciolino:
   - gironi casuali da massimo 7 tiratori (al più uno di differenza tra un girone e l'altro), ordine degli assalti FIE, assalti a 5 stoccate;
   - classifica dopo i gironi (V/M, indice, stoccate date);
   - tabellone delle dirette a 15 stoccate con tutti i presenti, teste di serie ed esenti;
   - nella spada non c'è il pari: a punteggio pari si indica chi vince alla priorità;
   - correzioni possibili finché il turno successivo non è disputato.
5. **Classifica della giornata**: podio con due terzi ex aequo, poi 5°, 9°, ecc., con i punti guadagnati.

## Punti per la classifica generale

| Piazzamento nella giornata | Punti |
|---|---|
| 1° | 10 |
| 2° | 7 |
| 3° (ex aequo, entrambi) | 5 |
| dal 4° all'8° | 3 |
| tutti gli altri presenti | 1 |
| assente | 0 |

La **classifica generale** è la prima cosa visibile nella pagina principale: somma dei punti delle giornate concluse, con il dettaglio giornata per giornata e il numero di presenze. A parità di punti conta il miglior rendimento (più vittorie di giornata, poi più secondi posti, poi più terzi, ecc.). Una giornata conta solo quando la sua finale è stata disputata.

## Avvio

Serve Node.js 22.13 o superiore (consigliato Node 24). Non ci sono dipendenze native da compilare.

```bash
cd XMasCup
npm install
npm start
```

Apri http://localhost:4020.

Il database SQLite `xmascup.db` viene creato automaticamente nella cartella al primo avvio. Per cambiare porta o file: `PORT=5000 DB_FILE=/percorso/torneo.db npm start`.

## Test

```bash
npm test
```

## Struttura

- `server.js`: API Express (anagrafica, giornate, presenti, gironi, tabellone, classifica generale)
- `db.js`: schema SQLite (modulo `node:sqlite` integrato in Node)
- `lib/tournament.js`: logica pura (gironi, ordine assalti, classifiche, teste di serie, punti)
- `public/`: interfaccia (HTML/CSS/JS senza build) e logo `logo.svg` (logo della Fanum Fortunae Scherma nella ghirlanda natalizia)
- `test/`: test con `node --test`
