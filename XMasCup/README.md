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
   - **ritiri** (pulsante 🏳️ Ritiri nella giornata):
     - nei gironi: tutti gli assalti dell'atleta si annullano (anche quelli già disputati), non conta nella classifica dei gironi, non passa alle dirette e chiude in fondo alla classifica della giornata;
     - nelle dirette: perde per ritiro, nel tabellone compare **R** e l'avversario passa il turno (anche se l'avversario non è ancora deciso, appena lo è); mantiene il piazzamento del turno in cui si ritira;
     - chi si ritira resta presente e prende comunque i punti del suo piazzamento; un ritiro inserito per errore si annulla con "Reintegra".
5. **Classifica della giornata**: podio con due terzi ex aequo, poi 5°, 9°, ecc., con i punti guadagnati.

## Punti per la classifica generale

| Piazzamento nella giornata | Punti |
|---|---|
| 1° | 10 |
| 2° | 7 |
| 3° (ex aequo, entrambi) | 5 |
| dal 5° in poi, tutti gli altri presenti (il 4° posto non esiste) | 3 |
| assente | 0 |

La **classifica generale** è la prima cosa visibile nella pagina principale: somma dei punti delle giornate concluse, con il dettaglio giornata per giornata e il numero di presenze. A parità di punti conta il miglior rendimento (più vittorie di giornata, poi più secondi posti, poi più terzi, ecc.). Una giornata conta solo quando la sua finale è stata disputata.

## 📱 Scorer per gli arbitri

Lo **scorer** è una seconda app, pensata per il telefono o il tablet dell'arbitro, all'indirizzo `/scorer/`. Si può aggiungere alla schermata Home e si usa come un'app (PWA). L'app principale fa da server: fornisce gironi e tabellone e riceve i risultati.

- **Un incontro, un arbitro.** Quando un arbitro preme "Arbitra" l'incontro diventa suo: la presa è atomica sul database, quindi se due arbitri ci provano nello stesso istante uno solo ci riesce. Gli altri vedono "📱 Nome sta arbitrando" e il punteggio dal vivo, e nemmeno forzando le richieste possono inviare un risultato.
- **Risultato automatico.** A fine incontro l'arbitro conferma il punteggio e il risultato viene inserito nell'app principale. Classifiche e tabellone si aggiornano da soli (l'app principale si aggiorna ogni pochi secondi).
- **Regole della spada.** Cronometro (gironi 3 minuti; dirette 3 periodi da 3 minuti con 1 minuto di pausa), stoccate, colpo doppio (annullato sul pari all'ultima stoccata, es. 4–4 o 14–14, e nel minuto di priorità), cartellini giallo e rosso (il rosso dà una stoccata all'avversario, il secondo giallo diventa rosso), sorteggio e minuto di priorità sul pari allo scadere, annulla ultima azione, inversione dei lati, schermo sempre acceso. Su computer ci sono anche i tasti rapidi: ← → stoccata, D colpo doppio, Spazio cronometro, Z annulla.
- **Telefono scarico o senza rete.** Il punteggio resta salvato sul telefono e, ogni pochi secondi, anche sul server. Se un arbitro non risponde da 45 secondi, un altro può **subentrare** ripartendo dal punteggio salvato. In alternativa l'organizzazione preme **Sblocca** sull'incontro. Chi ha perso l'incontro non può più inviare risultati.
- L'elenco mostra **solo gli assalti da arbitrare**: quelli già in arbitraggio da un altro arbitro, conclusi o in attesa dei tiratori non compaiono. Restano visibili quelli lasciati da un arbitro che non risponde, così qualcuno può subentrare. In alto c'è un **pulsante per ogni girone** (o turno delle dirette), con il numero di assalti rimasti, per vedere solo quel girone.
- Nei gironi lo scorer suggerisce il **prossimo incontro** nell'ordine FIE e avvisa se un tiratore sta già tirando su un'altra pedana.

Nell'app principale la pagina **📱 Arbitri** mostra gli indirizzi da aprire sui telefoni, con il QR code, e gli incontri in arbitraggio.

## Avvio in locale (palestra, senza internet)

Serve Node.js 22.13 o superiore (consigliato Node 24).

```bash
cd XMasCup
npm install
npm start
```

Apri http://localhost:4020 sul computer dell'organizzazione. I telefoni degli arbitri, collegati alla **stessa rete Wi-Fi**, aprono l'indirizzo mostrato nella pagina 📱 Arbitri (es. `http://192.168.1.10:4020/scorer/`).

In locale i dati stanno nel file SQLite `xmascup.db`, creato automaticamente. Per cambiare porta o file: `PORT=5000 DB_FILE=/percorso/torneo.db npm start`.

## Pubblicazione su Vercel (accessibile da qualsiasi dispositivo)

Su Vercel i file non sono permanenti, quindi serve un database Postgres. Quello integrato (Neon) ha un piano gratuito sufficiente.

1. Su [vercel.com](https://vercel.com) → **Add New… → Project** → importa il repository GitHub e come **Root Directory** scegli `XMasCup`. Il resto lo legge da `vercel.json`.
2. Nel progetto → **Storage → Create Database → Neon (Postgres)** e collegalo al progetto: Vercel imposta da solo `DATABASE_URL`. Le tabelle si creano al primo avvio.
3. Nel progetto → **Settings → Environment Variables** aggiungi:
   - `ADMIN_PASSWORD`: password dell'organizzazione, necessaria per modificare il torneo. La classifica resta visibile a tutti.
   - `SCORER_PIN`: PIN che gli arbitri inseriscono nello scorer.
4. **Redeploy**. L'app è su `https://<progetto>.vercel.app` e lo scorer su `https://<progetto>.vercel.app/scorer/`.

Senza `ADMIN_PASSWORD` e `SCORER_PIN` chiunque conosca l'indirizzo potrebbe modificare il torneo: online impostale sempre. In locale si possono lasciare vuote.

Le stesse variabili funzionano anche in locale: per esempio `DATABASE_URL=postgres://… npm start` usa Postgres invece di SQLite.

## Test

```bash
npm test
```

Per provare anche su Postgres: `TEST_DATABASE_URL=postgres://utente@host/database_di_prova npm test`. Attenzione: il database indicato viene azzerato.

## Struttura

- `server.js`: API Express (anagrafica, giornate, presenti, gironi, tabellone, classifica generale, scorer)
- `db.js`: accesso al database, SQLite in locale (`node:sqlite`) o Postgres (`DATABASE_URL`) con la stessa interfaccia
- `lib/tournament.js`: logica pura (gironi, ordine assalti, classifiche, teste di serie, punti, tempi)
- `api/index.js` e `vercel.json`: adattamento per Vercel (funzione serverless + pagine statiche)
- `public/`: app dell'organizzazione (HTML/CSS/JS senza build) e logo `logo.svg` (logo della Fanum Fortunae Scherma nella ghirlanda natalizia)
- `public/scorer/`: app per gli arbitri (PWA: manifest, service worker, icone)
- `test/`: test con `node --test`
