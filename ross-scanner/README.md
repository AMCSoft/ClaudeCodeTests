# Scanner momentum small cap (stile Ross Cameron)

Strumento di **studio**. Non invia ordini e non è una consulenza finanziaria.

Cerca azioni USA che oggi si muovono forte, con i criteri pubblici di Ross Cameron:

| criterio | default | flag |
| --- | --- | --- |
| prezzo | 2–20 $ | `--min-prezzo`, `--max-prezzo` |
| variazione sul giorno | +10% o più | `--min-gap` |
| volume relativo (a parità di orario) | 5× o più | `--min-rvol` |
| azioni in circolazione | max 20 milioni | `--max-float` |

Per ogni titolo propone un'idea: ingresso sopra il massimo di giornata, stop sotto il minimo
degli ultimi 10 minuti, target a 2R. Il numero di azioni è calcolato sul rischio massimo per
operazione (default 1% di 100 €).

```bash
python3 scanner.py
python3 scanner.py --capitale 100 --rischio 1
python3 scanner.py --min-gap 5 --max-float 50 --min-rvol 2   # criteri più larghi
python3 scanner.py --json
```

## Regole di giornata

Lo scanner mostra sempre i segnali, ma segna **NESSUN INGRESSO** quando:

- **Finestra oraria:** è fuori dalle 9:30–11:00 di New York (15:30–17:00 in Italia), oppure è
  weekend. Si cambia con `--ora-inizio` e `--ora-fine`.
- **Perdita massima giornaliera:** le operazioni chiuse oggi sommano −3% del capitale o peggio
  (−3 € su 100 €). Si cambia con `--perdita-giorno`.

Le operazioni chiuse si registrano nel diario (`diario.json`, solo in locale):

```bash
python3 diario.py aggiungi SJT -0.91            # simbolo e risultato in euro
python3 diario.py aggiungi SJT 1.80 --nota "target 2R"
python3 diario.py oggi
python3 diario.py tutto                         # riepilogo per giorno, con cumulato
```

`--adesso "2026-11-17 10:15"` fissa l'ora (New York) per provare le regole. I dati scaricati
restano comunque quelli live.

Serve solo Python 3.9 o superiore, nessuna libreria da installare. I segnali vengono salvati in `segnali/`.

## Limiti da conoscere

- **Dati:** api.nasdaq.com, gratuiti e non ufficiali; possono essere in ritardo. Cambio EUR/USD dalla BCE.
- **Float:** è stimato come capitalizzazione / prezzo, quindi è il totale delle azioni in
  circolazione, non il flottante vero (che spesso è più basso).
- **Notizie:** non lette automaticamente. Il catalizzatore va verificato a mano.
- **Pre-market:** prima delle 9:30 di New York la lista di Nasdaq riporta la variazione del
  giorno prima, quindi lo scanner funziona bene solo a mercato aperto.
- **Costi:** spread, slippage e commissioni non sono inclusi. Con stop stretti e 100 € di
  capitale possono pesare più della perdita prevista.
- **Broker europei:** molte di queste small cap non sono negoziabili su Trade Republic o XTB,
  oppure lo sono con spread larghi e senza pre-market.
