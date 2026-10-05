"""Prospetto per il monitoraggio (quadro RW) e imposta sul valore delle cripto-attivita' (IVCA).

BOZZA DI LAVORO: la mappatura sui righi/colonne del quadro, i codici investimento e il criterio di
valorizzazione vanno presi dalle istruzioni ministeriali dell'anno (le fonti secondarie sono discordanti).
Per ogni coppia (custode, asset) si calcolano:
  - giorni di detenzione nell'anno: giorni di calendario (Italia) in cui il saldo e' stato > 0, anche solo in parte
  - valore iniziale: saldo al 1/1 x prezzo del 1/1; se detenuto solo da dopo, valore al primo ingresso dell'anno
  - valore finale: saldo al 31/12 x prezzo del 31/12; se azzerato prima, valore all'ultima uscita dell'anno
  - IVCA indicativa = aliquota x valore finale x giorni/365 (solo cripto; per i metalli NON si applica)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from .models import ZERO, AssetClass, tax_date
from .rules import YearRules

DUST = Decimal("1e-9")   # residui inferiori non contano come "detenzione"


@dataclass
class RwRow:
    account: str
    asset: str
    asset_class: AssetClass
    qty_start: Decimal
    qty_end: Decimal
    days: int
    value_initial: Optional[Decimal]
    value_final: Optional[Decimal]
    ivca: Decimal
    notes: str = ""


def _days_held(intervals: List[Tuple[date, date]], start: date, end: date) -> int:
    held = set()
    for a, b in intervals:
        x, stop = max(a, start), min(b, end)
        while x <= stop:
            held.add(x)
            x += timedelta(days=1)
    return len(held)


def compute_rw(engine, rules: YearRules, year: int) -> List[RwRow]:
    start, end = date(year, 1, 1), date(year, 12, 31)
    series: Dict[Tuple[str, str], list] = {}
    for m in engine.movements:
        if m.account == "(rete)":
            continue
        series.setdefault((m.account, m.asset), []).append(m)

    rows: List[RwRow] = []
    for (account, asset), moves in sorted(series.items()):
        moves = sorted(moves, key=lambda m: m.ts)
        cls = engine._class(asset)
        bal = ZERO
        qty_start = ZERO
        intervals: List[Tuple[date, date]] = []
        cur_start: Optional[date] = None
        first_in_value: Optional[Decimal] = None
        last_out_value: Optional[Decimal] = None
        for m in moves:
            d = tax_date(m.ts)
            before = bal
            bal += m.delta
            if d > end:
                bal -= m.delta   # movimento successivo al 31/12: escluso
                break
            if before <= DUST < bal:
                cur_start = d
                if d >= start and first_in_value is None:
                    first_in_value = m.eur
            elif before > DUST >= bal:
                intervals.append((cur_start or d, d))
                cur_start = None
                if d >= start:
                    last_out_value = m.eur
        # saldo al 1/1: tutti i movimenti con data < 1/1
        qty_start = sum((m.delta for m in moves if tax_date(m.ts) < start), ZERO)
        qty_end = sum((m.delta for m in moves if tax_date(m.ts) <= end), ZERO)
        if cur_start is not None:
            intervals.append((cur_start, end))
        days = _days_held(intervals, start, end)
        if days == 0 and qty_start <= DUST:
            continue

        notes: List[str] = []
        p0 = engine.prices.get_day(asset, start)
        p1 = engine.prices.get_day(asset, end)
        if qty_start > DUST:
            v0 = qty_start * p0 if p0 is not None else None
            if p0 is None:
                engine.missing_prices.add((asset.upper(), start.isoformat()))
                engine.issue("block", "rw_missing_price", "", f"RW {account}/{asset}: manca il prezzo EUR del {start}")
                notes.append("manca prezzo 1/1")
        else:
            v0 = first_in_value
        if qty_end > DUST:
            v1 = qty_end * p1 if p1 is not None else None
            if p1 is None:
                engine.missing_prices.add((asset.upper(), end.isoformat()))
                engine.issue("block", "rw_missing_price", "", f"RW {account}/{asset}: manca il prezzo EUR del {end}")
                notes.append("manca prezzo 31/12")
        else:
            v1 = last_out_value
        ivca = ZERO
        if cls == AssetClass.CRYPTO and v1 is not None:
            ivca = rules.ivca_rate * v1 * Decimal(days) / Decimal(365)
        elif cls == AssetClass.METAL:
            notes.append("metallo: IVCA/IVAFE non calcolate; verificare codice RW e imposte con il commercialista")
        if account == "self_custody":
            notes.append("wallet proprio: verificare obbligo e codice RW")
        rows.append(RwRow(account, asset, cls, qty_start, qty_end, days, v0, v1, ivca, "; ".join(notes)))
    return rows
