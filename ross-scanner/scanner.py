#!/usr/bin/env python3
"""Scanner di momentum sulle small cap USA, ispirato ai criteri pubblici di Ross Cameron.

Cerca titoli che oggi si muovono forte (prezzo 2-20 $, +10 % o piu', volume
relativo alto, poche azioni in circolazione) e per ciascuno propone un
possibile ingresso sulla rottura del massimo di giornata, con stop e numero di
azioni calcolati sul rischio massimo per operazione (default 1 % del capitale).

SOLO STRUMENTO DI STUDIO. Non e' una consulenza finanziaria e non invia ordini.
I dati sono quelli gratuiti e non ufficiali di api.nasdaq.com: possono essere in
ritardo o incompleti. Verifica sempre prezzi e notizie sul tuo broker.

Uso:
    python3 scanner.py                        # scansione con i default
    python3 scanner.py --capitale 100 --rischio 1
    python3 scanner.py --json                 # output JSON
    python3 scanner.py --min-gap 5 --max-float 50   # criteri piu' larghi
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
API = "https://api.nasdaq.com/api"
UA = "Mozilla/5.0 (compatible; ross-style-scanner/0.1; study tool)"
ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
PAUSA = 0.35  # secondi tra una richiesta e l'altra, per non sovraccaricare il server
# units di SPAC, warrant, rights e privilegiate: illiquidi, non sono il bersaglio della strategia
NON_AZIONI = re.compile(r"\b(units?|warrants?|rights?|preferred|depositary shares? representing|notes due)\b", re.I)


# ---------------------------------------------------------------- rete

def scarica(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def api(path):
    time.sleep(PAUSA)
    d = json.loads(scarica(API + path))
    return d.get("data") or {}


def numero(s):
    """'$3.23' / '14,764,203.29' / '-4.36%' / 'N/A' -> float o None."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = re.sub(r"[,$%\s]", "", str(s))
    try:
        return float(s)
    except ValueError:
        return None


def cambio_eur_usd():
    try:
        xml = scarica(ECB, timeout=15).decode()
        m = re.search(r"currency='USD' rate='([0-9.]+)'", xml)
        if m:
            return float(m.group(1))
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- dati

def universo():
    """Tutte le azioni USA quotate (Nasdaq, NYSE, AMEX) con prezzo, variazione, volume, cap."""
    d = api("/screener/stocks?tableonly=true&download=true")
    righe = d.get("rows") or []
    out = []
    for r in righe:
        prezzo = numero(r.get("lastsale"))
        cap = numero(r.get("marketCap"))
        out.append({
            "symbol": (r.get("symbol") or "").strip(),
            "nome": (r.get("name") or "").strip(),
            "prezzo": prezzo,
            "var_pct": numero(r.get("pctchange")),
            "volume": numero(r.get("volume")),
            "cap": cap,
            # azioni in circolazione stimate = capitalizzazione / prezzo.
            # E' un limite superiore del flottante (il float vero e' spesso minore).
            "azioni_mln": (cap / prezzo / 1e6) if cap and prezzo else None,
            "settore": r.get("sector") or "",
        })
    return out


def volume_medio(symbol, giorni=30):
    oggi = dt.datetime.now(NY).date()
    da = (oggi - dt.timedelta(days=giorni * 2)).isoformat()
    d = api("/quote/%s/historical?assetclass=stocks&fromdate=%s&limit=%d" % (symbol, da, giorni))
    righe = ((d.get("tradesTable") or {}).get("rows")) or []
    vols = []
    for r in righe:
        try:
            giorno = dt.datetime.strptime(r.get("date", ""), "%m/%d/%Y").date()
        except ValueError:
            continue
        if giorno >= oggi:       # escludi la giornata in corso
            continue
        v = numero(r.get("volume"))
        if v:
            vols.append(v)
    return sum(vols) / len(vols) if vols else None


def grafico(symbol):
    """Prezzi al minuto di oggi (dalle 4:00 ET, pre-market compreso) e chiusura di ieri."""
    d = api("/quote/%s/chart?assetclass=stocks" % symbol)
    punti = []
    for p in d.get("chart") or []:
        try:
            t = dt.datetime.fromtimestamp(p["x"] / 1000, dt.timezone.utc)
        except (KeyError, TypeError, ValueError):
            continue
        # Nasdaq mette gli orari di New York come se fossero UTC: li reinterpreto.
        t = t.replace(tzinfo=None).replace(tzinfo=NY)
        if p.get("y") is not None:
            punti.append((t, float(p["y"])))
    return {
        "punti": punti,
        "chiusura_ieri": numero(d.get("previousClose")),
        "ultimo": numero(d.get("lastSalePrice")),
        "volume": numero(d.get("volume")),
        "aggiornato": d.get("timeAsOf"),
    }


# ---------------------------------------------------------------- analisi

def frazione_giornata(adesso):
    """Quanta parte della seduta regolare (9:30-16:00) e' passata, tra 0.05 e 1."""
    apertura = adesso.replace(hour=9, minute=30, second=0, microsecond=0)
    minuti = (adesso - apertura).total_seconds() / 60
    return max(0.05, min(1.0, minuti / 390))


def analizza(c, g, vol_medio, adesso, rischio_usd):
    punti = g["punti"]
    ieri = g["chiusura_ieri"] or (c["prezzo"] / (1 + c["var_pct"] / 100) if c["var_pct"] else None)
    ultimo = g["ultimo"] or (punti[-1][1] if punti else c["prezzo"])
    if not punti or not ieri or not ultimo:
        return None

    pre = [p for t, p in punti if t.hour < 9 or (t.hour == 9 and t.minute < 30)]
    reg = [(t, p) for t, p in punti if not (t.hour < 9 or (t.hour == 9 and t.minute < 30))]
    apertura = reg[0][1] if reg else None
    massimo = max(p for _, p in punti)
    massimo_pre = max(pre) if pre else None

    vol_oggi = g["volume"] or c["volume"] or 0
    # volume relativo "a parita' di orario": il volume di oggi confrontato con la
    # quota di volume medio attesa a quest'ora della seduta (stima lineare).
    rvol = vol_oggi / (vol_medio * frazione_giornata(adesso)) if vol_medio else None

    # Ultimo minimo di pullback: il prezzo piu' basso degli ultimi 10 minuti.
    recenti = [p for _, p in punti[-10:]]
    minimo_recente = min(recenti)
    dist_max_pct = (massimo - ultimo) / massimo * 100

    # Proposta di ingresso: rottura del massimo di giornata (+1 cent),
    # stop sotto il minimo del pullback recente (-1 cent).
    ingresso = round(massimo + 0.01, 2)
    stop = round(minimo_recente - 0.01, 2)
    rischio_az = ingresso - stop
    if rischio_az <= 0:
        rischio_az = None

    stato = []
    if dist_max_pct <= 1.0:
        stato.append("sui massimi")
    elif dist_max_pct <= 5.0:
        stato.append("pullback vicino ai massimi")
    else:
        stato.append("lontano dai massimi (%.1f%%)" % dist_max_pct)
    if apertura and ultimo < apertura:
        stato.append("sotto l'apertura")
    if massimo_pre and ultimo > massimo_pre:
        stato.append("sopra il massimo pre-market")

    azioni = int(rischio_usd // rischio_az) if rischio_az else 0
    return {
        "symbol": c["symbol"],
        "nome": c["nome"],
        "prezzo": round(ultimo, 4),
        "var_pct": round((ultimo / ieri - 1) * 100, 1),
        "gap_apertura_pct": round((apertura / ieri - 1) * 100, 1) if apertura else None,
        "volume": int(vol_oggi),
        "rvol": round(rvol, 1) if rvol else None,
        "azioni_mln": round(c["azioni_mln"], 1) if c["azioni_mln"] else None,
        "massimo": round(massimo, 4),
        "massimo_premarket": round(massimo_pre, 4) if massimo_pre else None,
        "dist_massimo_pct": round(dist_max_pct, 1),
        "stato": ", ".join(stato),
        "piano": {
            "ingresso": ingresso,
            "stop": stop,
            "rischio_per_azione": round(rischio_az, 4) if rischio_az else None,
            "target_2R": round(ingresso + 2 * rischio_az, 2) if rischio_az else None,
            "azioni": azioni,
            "controvalore_usd": round(azioni * ingresso, 2),
            "perdita_max_usd": round(azioni * rischio_az, 2) if rischio_az else None,
        },
        "aggiornato": g["aggiornato"],
    }


def punteggio(s):
    """Ordine di priorita': vicino ai massimi, volume relativo, pochi titoli, variazione."""
    p = 0.0
    p += min(s["rvol"] or 0, 50)
    p += min(s["var_pct"], 100) / 5
    p -= s["dist_massimo_pct"] * 2
    if s["azioni_mln"]:
        p += max(0, 20 - s["azioni_mln"]) / 2
    return p


def regole_giorno(a, adesso):
    """(True se i nuovi ingressi sono bloccati, spiegazione). Finestra oraria + perdita giornaliera."""
    import diario  # stesso cartella dello scanner

    def hm(s):
        h, m = s.split(":")
        return adesso.replace(hour=int(h), minute=int(m), second=0, microsecond=0)

    motivi = []
    if adesso.weekday() >= 5:
        motivi.append("oggi la borsa e' chiusa (weekend)")
    elif not (hm(a.ora_inizio) <= adesso <= hm(a.ora_fine)):
        motivi.append("fuori dalla finestra di ingresso %s-%s di New York" % (a.ora_inizio, a.ora_fine))

    limite = a.capitale * a.perdita_giorno / 100
    tot, n = diario.risultato_oggi(adesso)
    if tot <= -limite:
        motivi.append("perdita giornaliera raggiunta (%+.2f EUR su %d operazioni, limite -%.2f EUR)" % (tot, n, limite))
    stato = "Oggi: %d operazioni registrate, %+.2f EUR (limite -%.2f EUR)." % (n, tot, limite)
    if motivi:
        return True, "; ".join(motivi) + ". " + stato
    return False, "Ingressi consentiti. " + stato


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="Scanner momentum small cap (stile Ross Cameron). Solo studio.")
    ap.add_argument("--capitale", type=float, default=100.0, help="capitale in euro (default 100)")
    ap.add_argument("--rischio", type=float, default=1.0, help="rischio massimo per operazione, %% del capitale (default 1)")
    ap.add_argument("--min-prezzo", type=float, default=2.0)
    ap.add_argument("--max-prezzo", type=float, default=20.0)
    ap.add_argument("--min-gap", type=float, default=10.0, help="variazione minima %% sul giorno (default 10)")
    ap.add_argument("--min-rvol", type=float, default=5.0, help="volume relativo minimo (default 5)")
    ap.add_argument("--max-float", type=float, default=20.0, help="max azioni in circolazione, milioni (default 20)")
    ap.add_argument("--max-candidati", type=int, default=25, help="quanti titoli approfondire (default 25)")
    ap.add_argument("--eurusd", type=float, default=None, help="cambio EUR/USD (default: BCE del giorno)")
    ap.add_argument("--ora-inizio", default="09:30", help="primo ingresso consentito, ora di New York (default 09:30)")
    ap.add_argument("--ora-fine", default="11:00", help="ultimo ingresso consentito, ora di New York (default 11:00)")
    ap.add_argument("--perdita-giorno", type=float, default=3.0,
                    help="perdita massima giornaliera, %% del capitale (default 3); legge diario.json")
    ap.add_argument("--adesso", default=None, help="fissa l'ora, es. '2026-11-17 10:15' (New York), per prove")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--salva", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "segnali"),
                    help="cartella dove salvare i segnali in JSON ('' per non salvare)")
    a = ap.parse_args(argv)

    adesso = (dt.datetime.strptime(a.adesso, "%Y-%m-%d %H:%M").replace(tzinfo=NY)
              if a.adesso else dt.datetime.now(NY))
    eurusd = a.eurusd or cambio_eur_usd() or 1.10
    rischio_eur = a.capitale * a.rischio / 100
    rischio_usd = rischio_eur * eurusd

    log = (lambda *x: print(*x, file=sys.stderr)) if a.json else print
    log("Scansione delle %s (New York). Capitale %.2f EUR, rischio max %.2f EUR (%.2f USD, cambio %.4f)."
        % (adesso.strftime("%H:%M del %d/%m/%Y"), a.capitale, rischio_eur, rischio_usd, eurusd))

    stop_giorno, motivo_stop = regole_giorno(a, adesso)
    log(motivo_stop)

    tutti = universo()
    primo = [c for c in tutti
             if c["prezzo"] and a.min_prezzo <= c["prezzo"] <= a.max_prezzo
             and c["var_pct"] is not None and c["var_pct"] >= a.min_gap
             and "^" not in c["symbol"] and "/" not in c["symbol"]
             and not NON_AZIONI.search(c["nome"])
             and (c["azioni_mln"] is None or c["azioni_mln"] <= a.max_float)]
    primo.sort(key=lambda c: c["var_pct"], reverse=True)
    log("Universo: %d titoli. Prezzo %.0f-%.0f $, +%.0f%% o piu', max %.0f mln di azioni: %d. Ne approfondisco %d."
        % (len(tutti), a.min_prezzo, a.max_prezzo, a.min_gap, a.max_float, len(primo),
           min(len(primo), a.max_candidati)))

    segnali, scartati = [], []
    for c in primo[: a.max_candidati]:
        try:
            vm = volume_medio(c["symbol"])
            g = grafico(c["symbol"])
            s = analizza(c, g, vm, adesso, rischio_usd)
        except Exception as e:  # un titolo che fallisce non ferma la scansione
            scartati.append((c["symbol"], "errore dati: %s" % e))
            continue
        if not s:
            scartati.append((c["symbol"], "dati intraday mancanti"))
        elif s["var_pct"] < a.min_gap:
            # la lista di Nasdaq puo' essere in ritardo: conta la variazione dal grafico
            scartati.append((c["symbol"], "variazione reale %+.1f%% sotto %.0f%%" % (s["var_pct"], a.min_gap)))
        elif s["rvol"] is not None and s["rvol"] < a.min_rvol:
            scartati.append((c["symbol"], "volume relativo %.1f sotto %.0f" % (s["rvol"], a.min_rvol)))
        else:
            segnali.append(s)

    segnali.sort(key=punteggio, reverse=True)
    for s in segnali:
        p = s["piano"]
        p["perdita_max_eur"] = round(p["perdita_max_usd"] / eurusd, 2) if p["perdita_max_usd"] else None
        p["controvalore_eur"] = round(p["controvalore_usd"] / eurusd, 2)
        p["entra_nel_capitale"] = p["controvalore_eur"] <= a.capitale
        p["ingresso_consentito"] = (not stop_giorno and p["azioni"] > 0 and p["entra_nel_capitale"])

    risultato = {
        "ora_ny": adesso.isoformat(timespec="minutes"),
        "capitale_eur": a.capitale, "rischio_eur": rischio_eur, "eurusd": eurusd,
        "ingressi_consentiti": not stop_giorno,
        "regole_giorno": motivo_stop,
        "criteri": {"prezzo": [a.min_prezzo, a.max_prezzo], "min_var_pct": a.min_gap,
                    "min_rvol": a.min_rvol, "max_azioni_mln": a.max_float,
                    "finestra_ny": [a.ora_inizio, a.ora_fine], "perdita_giorno_pct": a.perdita_giorno},
        "segnali": segnali,
        "scartati": [{"symbol": s, "motivo": m} for s, m in scartati],
        "avvertenza": "Solo studio. Non e' consulenza finanziaria. Dati gratuiti e non ufficiali, "
                      "possono essere in ritardo. Il catalizzatore (notizia) va verificato a mano.",
    }

    if a.salva:
        os.makedirs(a.salva, exist_ok=True)
        f = os.path.join(a.salva, "segnali-%s.json" % adesso.strftime("%Y%m%d-%H%M"))
        with open(f, "w") as fh:
            json.dump(risultato, fh, indent=2, ensure_ascii=False)
        log("Salvato in %s" % f)

    if a.json:
        print(json.dumps(risultato, indent=2, ensure_ascii=False))
        return 0

    stampa(risultato, scartati)
    return 0


def stampa(r, scartati):
    segnali = r["segnali"]
    print()
    if not segnali:
        print("Nessun titolo soddisfa tutti i criteri in questo momento.")
    for i, s in enumerate(segnali, 1):
        p = s["piano"]
        print("%d. %s  %s" % (i, s["symbol"], s["nome"][:60]))
        print("   prezzo %.2f $  %+.1f%% oggi  gap all'apertura %s  volume %s  vol. relativo %s  azioni ~%s mln"
              % (s["prezzo"], s["var_pct"],
                 ("%+.1f%%" % s["gap_apertura_pct"]) if s["gap_apertura_pct"] is not None else "n.d.",
                 format(s["volume"], ","), s["rvol"] or "n.d.", s["azioni_mln"] or "n.d."))
        print("   massimo %.2f  (pre-market %s)  stato: %s"
              % (s["massimo"], s["massimo_premarket"] or "n.d.", s["stato"]))
        if p["rischio_per_azione"] and p["azioni"] > 0:
            print("   idea: ingresso sopra %.2f, stop %.2f, target 2R %.2f -> %d azioni (%.2f EUR), perdita max ~%.2f EUR%s"
                  % (p["ingresso"], p["stop"], p["target_2R"], p["azioni"], p["controvalore_eur"],
                     p["perdita_max_eur"], "" if p["entra_nel_capitale"] else "  [SUPERA IL CAPITALE]"))
            if not r["ingressi_consentiti"]:
                print("   NESSUN INGRESSO: %s" % r["regole_giorno"])
        else:
            print("   idea: lo stop e' troppo largo per il tuo rischio massimo, nessuna posizione possibile")
        print()
    if scartati:
        print("Scartati: " + "; ".join("%s (%s)" % x for x in scartati))
    print()
    print(r["avvertenza"])
    print("Spread, slippage e commissioni non sono inclusi: con stop stretti possono pesare piu' della perdita prevista.")


if __name__ == "__main__":
    sys.exit(main())
