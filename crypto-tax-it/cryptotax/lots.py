"""Gestione dei lotti di costo con criterio LIFO (ultimi acquistati = primi ceduti).

Un unico pool per ogni asset, indipendente dal conto/custode: i trasferimenti tra conti propri non
cambiano i lotti. Il criterio LIFO e' quello indicato dalla Circ. AdE 30/E 2023 per le cripto-attivita'
nel regime dichiarativo (da riverificare sulla fonte primaria).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import List

from .models import ZERO


@dataclass
class Lot:
    lot_id: str
    asset: str
    acquired_ts: datetime
    qty: Decimal                 # quantita' residua
    unit_cost: Decimal           # costo EUR per unita' (oneri accessori inclusi)
    origin: str                  # uid dell'evento che ha creato il lotto
    cost_documented: bool = True
    rebased: bool = False        # costo rideterminato al valore del 1/1/2025


@dataclass(frozen=True)
class LotUse:
    lot_id: str
    acquired_ts: datetime
    qty: Decimal
    cost: Decimal
    cost_documented: bool
    rebased: bool
    origin: str


class LotPool:
    def __init__(self, asset: str) -> None:
        self.asset = asset
        self.lots: List[Lot] = []   # in ordine cronologico di acquisto; LIFO = si preleva dalla coda

    @property
    def balance(self) -> Decimal:
        return sum((l.qty for l in self.lots), ZERO)

    def add(self, lot: Lot) -> None:
        self.lots.append(lot)
        self.lots.sort(key=lambda l: l.acquired_ts)  # sort stabile: a pari timestamp resta l'ordine di inserimento

    def consume(self, qty: Decimal):
        """Preleva `qty` con LIFO. Ritorna (usi, quantita_mancante). La mancanza NON viene coperta qui."""
        remaining = qty
        uses: List[LotUse] = []
        while remaining > 0 and self.lots:
            lot = self.lots[-1]
            take = min(lot.qty, remaining)
            uses.append(LotUse(lot.lot_id, lot.acquired_ts, take, take * lot.unit_cost,
                               lot.cost_documented, lot.rebased, lot.origin))
            lot.qty -= take
            remaining -= take
            if lot.qty == 0:
                self.lots.pop()
        return uses, remaining
