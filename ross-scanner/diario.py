#!/usr/bin/env python3
"""Diario delle operazioni: serve allo scanner per la perdita massima giornaliera.

Uso:
    python3 diario.py aggiungi SJT -0.91            # operazione chiusa: simbolo e risultato in euro
    python3 diario.py aggiungi SJT 1.80 --nota "target 2R"
    python3 diario.py oggi                          # operazioni e risultato di oggi
    python3 diario.py tutto                         # riepilogo per giorno
"""

import argparse
import datetime as dt
import json
import os
import sys
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diario.json")


def carica(path=None):
    try:
        with open(path or FILE) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return []


def salva(voci, path=None):
    path = path or FILE
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(voci, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def giorno_ny(adesso=None):
    return (adesso or dt.datetime.now(NY)).astimezone(NY).date().isoformat()


def oggi(voci=None, adesso=None, path=None):
    """Operazioni della giornata di borsa in corso (data di New York)."""
    voci = carica(path) if voci is None else voci
    g = giorno_ny(adesso)
    return [v for v in voci if v.get("giorno") == g]


def risultato_oggi(adesso=None, path=None):
    """(risultato netto in euro, numero di operazioni) di oggi."""
    vv = oggi(adesso=adesso, path=path)
    return round(sum(v["eur"] for v in vv), 2), len(vv)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Diario operazioni per lo scanner.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a1 = sub.add_parser("aggiungi", help="registra un'operazione chiusa")
    a1.add_argument("symbol")
    a1.add_argument("eur", type=float, help="risultato in euro, negativo se in perdita")
    a1.add_argument("--nota", default="")
    sub.add_parser("oggi", help="operazioni di oggi")
    sub.add_parser("tutto", help="riepilogo per giorno")
    a = ap.parse_args(argv)

    voci = carica()
    if a.cmd == "aggiungi":
        adesso = dt.datetime.now(NY)
        voci.append({"giorno": giorno_ny(adesso), "ora_ny": adesso.strftime("%H:%M"),
                     "symbol": a.symbol.upper(), "eur": round(a.eur, 2), "nota": a.nota})
        salva(voci)
        tot, n = risultato_oggi()
        print("Registrato %s %+.2f EUR. Oggi: %d operazioni, %+.2f EUR." % (a.symbol.upper(), a.eur, n, tot))
    elif a.cmd == "oggi":
        vv = oggi(voci)
        if not vv:
            print("Nessuna operazione registrata oggi.")
        for v in vv:
            print("%s  %-6s %+7.2f EUR  %s" % (v["ora_ny"], v["symbol"], v["eur"], v.get("nota", "")))
        if vv:
            print("Totale oggi: %+.2f EUR" % sum(v["eur"] for v in vv))
    else:
        per_giorno = {}
        for v in voci:
            per_giorno.setdefault(v["giorno"], []).append(v["eur"])
        cum = 0.0
        for g in sorted(per_giorno):
            r = sum(per_giorno[g])
            cum += r
            vinte = sum(1 for x in per_giorno[g] if x > 0)
            print("%s  %2d operazioni (%d vinte)  %+7.2f EUR  cumulato %+7.2f EUR"
                  % (g, len(per_giorno[g]), vinte, r, cum))
        if not per_giorno:
            print("Diario vuoto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
