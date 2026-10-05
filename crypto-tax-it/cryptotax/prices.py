"""Prezzi e cambi in input (file CSV forniti dall'utente). Nessun interpolamento silenzioso."""
from __future__ import annotations

import csv
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

from .models import tax_date


def _parse_day(s: str) -> date:
    return datetime.strptime(s.strip()[:10], "%Y-%m-%d").date()


class PriceBook:
    """Prezzo giornaliero in EUR per 1 unita' di asset. CSV: date,symbol,eur_price"""

    def __init__(self) -> None:
        self._data: dict[str, dict[date, Decimal]] = {}

    def add(self, symbol: str, day: date, price: Decimal) -> None:
        self._data.setdefault(symbol.upper(), {})[day] = price

    @classmethod
    def from_csv(cls, path: str | Path) -> "PriceBook":
        pb = cls()
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                pb.add(row["symbol"], _parse_day(row["date"]), Decimal(row["eur_price"].replace(",", ".")))
        return pb

    def get_day(self, symbol: str, day: date, max_gap_days: int = 0) -> Optional[Decimal]:
        series = self._data.get(symbol.upper())
        if not series:
            return None
        for gap in range(max_gap_days + 1):
            p = series.get(day - timedelta(days=gap))
            if p is not None:
                return p
        return None

    def get(self, symbol: str, ts: datetime, max_gap_days: int = 0) -> Optional[Decimal]:
        return self.get_day(symbol, tax_date(ts), max_gap_days)


class FxTable:
    """Cambi di riferimento BCE: unita' di valuta per 1 EUR. CSV: date,currency,rate

    Per le valute il "cambio del giorno" in assenza di quotazione (weekend/festivi) e' l'ultimo disponibile:
    si ammette un gap massimo di 7 giorni, sempre segnalato nel report.
    """

    def __init__(self) -> None:
        self._data: dict[str, dict[date, Decimal]] = {}

    def add(self, ccy: str, day: date, rate: Decimal) -> None:
        self._data.setdefault(ccy.upper(), {})[day] = rate

    @classmethod
    def from_csv(cls, path: str | Path) -> "FxTable":
        fx = cls()
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                fx.add(row["currency"], _parse_day(row["date"]), Decimal(row["rate"].replace(",", ".")))
        return fx

    def to_eur(self, amount: Decimal, ccy: str, ts: datetime, max_gap_days: int = 7):
        """Ritorna (importo_eur, gap_giorni) oppure None se manca il cambio."""
        ccy = ccy.upper()
        if ccy == "EUR":
            return amount, 0
        series = self._data.get(ccy)
        if not series:
            return None
        day = tax_date(ts)
        for gap in range(max_gap_days + 1):
            r = series.get(day - timedelta(days=gap))
            if r is not None:
                return amount / r, gap
        return None
