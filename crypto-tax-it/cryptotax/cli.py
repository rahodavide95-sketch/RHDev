from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

from .engine import Config, Engine
from .importers import PARSERS
from .importers.base import ImportFormatError, read_table
from .prices import FxTable, PriceBook
from .report import write_all
from .rules import rules_for
from .rw import compute_rw
from .tax import baskets_for_year

CATEGORICAL_LIMIT = 40


def cmd_inspect(args) -> int:
    """Stampa SOLO la struttura del file (intestazioni e valori delle colonne categoriali), senza importi."""
    p = Path(args.file)
    text = p.read_text(encoding="utf-8-sig")
    marker = "Transaction ID" if "Transaction ID" in text else None
    try:
        headers, rows, hdr_line = read_table(p, header_marker=marker)
    except ImportFormatError as exc:
        print(f"ERRORE: {exc}")
        return 1
    print(f"File: {p.name}")
    print(f"Riga di intestazione: {hdr_line}  |  righe dati: {len(rows)}")
    print(f"Colonne ({len(headers)}): {headers}")
    for h in headers:
        vals = Counter(r[h] for r in rows)
        if 0 < len(vals) <= CATEGORICAL_LIMIT:
            looks_numeric = all(_is_number(v) for v in vals)
            looks_time = all(len(v) >= 8 and v[:4].isdigit() for v in vals if v)
            if not looks_numeric and not looks_time:
                print(f"\n[{h}] {len(vals)} valori distinti:")
                for v, n in vals.most_common():
                    print(f"   {n:6d}  {v!r}")
    if rows:
        tcols = [h for h in headers if "time" in h.lower() or "date" in h.lower()]
        for h in tcols[:1]:
            ts = sorted(r[h] for r in rows if r[h])
            print(f"\nIntervallo {h}: {ts[0]}  ->  {ts[-1]}")
    return 0


def _is_number(s: str) -> bool:
    try:
        Decimal(s.replace(",", "."))
        return True
    except Exception:
        return False


def cmd_run(args) -> int:
    cfg_path = Path(args.config).resolve()
    base = cfg_path.parent
    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    year = int(args.year or raw["year"])
    rules = rules_for(year)

    events, parse_issues, notes = [], [], []
    for src in raw["sources"]:
        parser = PARSERS.get(src["type"])
        if parser is None:
            print(f"Tipo di sorgente sconosciuto: {src['type']} (disponibili: {sorted(PARSERS)})")
            return 1
        path = (base / src["path"]).resolve()
        kwargs = {"account": src["account"]} if "account" in src else {}
        try:
            res = parser(path, **kwargs)
        except ImportFormatError as exc:
            print(f"ERRORE IMPORT {path.name}: {exc}")
            return 1
        events.extend(res.events)
        parse_issues.extend(res.issues)
        notes.append(f"{src['type']}: {path.name} - {res.rows} righe")

    prices = PriceBook.from_csv(base / raw["prices_eur"]) if raw.get("prices_eur") else PriceBook()
    fx = FxTable.from_csv(base / raw["fx_eur"]) if raw.get("fx_eur") else FxTable()
    resolutions = {}
    if raw.get("resolutions"):
        resolutions = json.loads((base / raw["resolutions"]).read_text(encoding="utf-8"))
    cfg = Config(target_year=year, rebase_1_1_2025=bool(raw.get("rebase_1_1_2025", False)), resolutions=resolutions)

    engine = Engine(cfg, prices, fx).run(events)
    baskets = baskets_for_year(engine, rules, year, raw.get("carryforward", {}))
    rw_rows = compute_rw(engine, rules, year)
    out = (base / (args.out or raw.get("out", "out"))).resolve()
    summary = write_all(engine, baskets, rw_rows, cfg, rules, out, notes, parse_issues)

    print(f"Eventi importati: {len(events)}  |  cessioni totali: {len(engine.disposals)}  |  proventi: {len(engine.incomes)}")
    for b in baskets:
        print(f"{b.name}: imponibile {b.taxable}  imposta {b.tax}")
    print(f"Imposta sostitutiva totale (stima): {summary['total_tax']}")
    print(f"Output in: {out}")
    if summary["blocking"]:
        print(f"ATTENZIONE: {summary['blocking']} problemi bloccanti -> report in BOZZA (vedi problemi.csv)")
        return 0 if args.draft else 2
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="cryptotax")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("inspect", help="mostra la struttura di un export (senza importi)")
    p1.add_argument("file")
    p1.set_defaults(fn=cmd_inspect)
    p2 = sub.add_parser("run", help="calcola e scrive i report")
    p2.add_argument("--config", required=True)
    p2.add_argument("--year", type=int)
    p2.add_argument("--out")
    p2.add_argument("--draft", action="store_true", help="exit code 0 anche con problemi bloccanti")
    p2.set_defaults(fn=cmd_run)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
