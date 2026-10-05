"""Calcolo dell'imposta per paniere: cripto (c-sexies) e metalli preziosi (c-ter).

Scelte interpretative applicate (riportate nel report, da far confermare dal commercialista):
  1. I proventi (staking, interessi, airdrop, cashback) sono tassati al valore normale alla percezione e NON
     sono compensabili con le minusvalenze da cessione (scelta prudenziale).
  2. Le minusvalenze cripto compensano solo plusvalenze cripto (Circ. 30/E 2023). Le minusvalenze dei metalli
     preziosi (c-ter) compensano solo redditi diversi di natura finanziaria (c-bis..c-quinquies), mai le cripto.
  3. Riporto in avanti: le minusvalenze dell'anno Y sono utilizzabili fino all'anno Y+4, solo se indicate nella
     dichiarazione dell'anno di realizzo. Le eccedenze degli anni precedenti vanno passate in input
     (`carryforward`): il programma non le deduce da solo.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, List, Tuple

from .engine import Disposal, IncomeRec
from .models import ZERO, AssetClass
from .rules import YearRules


def round_euro(x: Decimal) -> Decimal:
    """Arrotondamento all'unita' di euro, come richiesto dai modelli dichiarativi (0,5 -> per eccesso)."""
    return x.quantize(Decimal(1), rounding=ROUND_HALF_UP)


@dataclass
class BasketResult:
    name: str
    year: int
    rate: Decimal
    n_disposals: int = 0
    proceeds: Decimal = ZERO          # corrispettivi (al netto commissioni)
    costs: Decimal = ZERO
    gains: Decimal = ZERO             # somma delle sole plusvalenze
    losses: Decimal = ZERO            # somma (positiva) delle sole minusvalenze
    net: Decimal = ZERO               # gains - losses
    income: Decimal = ZERO            # proventi (staking, interessi, ...)
    carry_used: List[Tuple[int, Decimal]] = field(default_factory=list)
    carry_unused: List[Tuple[int, Decimal]] = field(default_factory=list)
    carry_expired: List[Tuple[int, Decimal]] = field(default_factory=list)
    new_loss: Decimal = ZERO          # minusvalenza netta dell'anno, riportabile
    taxable: Decimal = ZERO
    tax: Decimal = ZERO


def compute_basket(name: str, year: int, rules: YearRules, rate: Decimal,
                   disposals: Iterable[Disposal], incomes: Iterable[IncomeRec],
                   carryforward: List[Tuple[int, Decimal]]) -> BasketResult:
    r = BasketResult(name=name, year=year, rate=rate)
    for d in disposals:
        r.n_disposals += 1
        r.proceeds += d.proceeds
        r.costs += d.cost
        if d.gain > 0:
            r.gains += d.gain
        else:
            r.losses += -d.gain
    r.income = sum((i.value for i in incomes), ZERO)
    r.net = r.gains - r.losses

    usable = sorted([(y, a) for y, a in carryforward if year - rules.loss_carry_years <= y < year])
    expired = [(y, a) for y, a in carryforward if y < year - rules.loss_carry_years]
    remaining_net = round_euro(r.net) if r.net > 0 else ZERO
    taxable_cap = remaining_net
    unused: List[Tuple[int, Decimal]] = []
    for y, amount in usable:           # prima le piu' vecchie
        take = min(amount, taxable_cap)
        if take > 0:
            r.carry_used.append((y, take))
            taxable_cap -= take
        if amount - take > 0:
            unused.append((y, amount - take))
    r.carry_unused = unused
    r.carry_expired = expired          # oltre il 4o anno: non piu' utilizzabili
    if r.net < 0:
        r.new_loss = round_euro(-r.net)
    r.taxable = round_euro(taxable_cap + r.income)
    r.tax = round_euro(r.taxable * rate)
    return r


def baskets_for_year(engine, rules: YearRules, year: int, carryforward: dict) -> List[BasketResult]:
    if rules.crypto_threshold_eur is not None:
        raise NotImplementedError(
            f"Anno {year}: la franchigia di {rules.crypto_threshold_eur} EUR non e' implementata. "
            f"Il motore calcola l'imposta solo dal 2025 (franchigia abolita).")
    ds = [d for d in engine.disposals if d.year == year]
    inc = [i for i in engine.incomes if i.year == year]
    crypto = compute_basket(
        "cripto-attivita (art. 67 c.1 lett. c-sexies)", year, rules, rules.crypto_rate,
        [d for d in ds if d.asset_class == AssetClass.CRYPTO],
        [i for i in inc if i.asset_class == AssetClass.CRYPTO],
        [(int(y), Decimal(str(a))) for y, a in carryforward.get("crypto", [])])
    metals = compute_basket(
        "metalli preziosi (art. 67 c.1 lett. c-ter)", year, rules, rules.metals_rate,
        [d for d in ds if d.asset_class == AssetClass.METAL],
        [i for i in inc if i.asset_class == AssetClass.METAL],
        [(int(y), Decimal(str(a))) for y, a in carryforward.get("metals", [])])
    return [crypto, metals]
