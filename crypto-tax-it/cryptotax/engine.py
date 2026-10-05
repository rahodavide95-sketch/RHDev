"""Motore di calcolo: eventi normalizzati -> cessioni, proventi, movimenti per conto, problemi.

Principio guida: un dato mancante o ambiguo NON viene mai risolto in silenzio. Genera un `Issue`
di livello 'block' (il report resta una BOZZA finche' non viene risolto) e il calcolo prosegue
con l'ipotesi piu' conservativa (costo zero, valore zero) cosi' l'impatto e' visibile.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from .lots import Lot, LotPool, LotUse
from .models import (STABLECOINS, ZERO, AssetClass, Event, Issue, Kind, classify, tax_date)
from .prices import FxTable, PriceBook

REBASE_DATE = date(2025, 1, 1)


@dataclass
class Config:
    target_year: int
    rebase_1_1_2025: bool = False            # rideterminazione del costo al valore del 1/1/2025 (imposta sostitutiva 18%)
    transfer_window_hours: int = 72          # finestra per abbinare uscita e ingresso tra conti propri
    transfer_fee_tolerance: Decimal = Decimal("0.10")  # commissione di rete max 10% della quantita' inviata
    fx_max_gap_days: int = 7
    resolutions: Dict[str, dict] = field(default_factory=dict)  # uid -> {"action": ...}


@dataclass
class Disposal:
    uid: str
    ts: datetime
    account: str
    asset: str
    asset_class: AssetClass
    kind: str            # sell | swap | spend | fee | transfer_fee | missing_out
    qty: Decimal
    proceeds: Decimal    # al netto delle commissioni
    fee: Decimal
    cost: Decimal
    gain: Decimal
    uses: List[LotUse]
    value_source: str
    src: str
    note: str = ""

    @property
    def year(self) -> int:
        return tax_date(self.ts).year


@dataclass
class IncomeRec:
    uid: str
    ts: datetime
    account: str
    asset: str
    asset_class: AssetClass
    qty: Decimal
    value: Decimal
    income_type: str
    value_source: str
    src: str

    @property
    def year(self) -> int:
        return tax_date(self.ts).year


@dataclass
class Movement:
    ts: datetime
    account: str
    asset: str
    delta: Decimal
    eur: Optional[Decimal]
    uid: str


class Engine:
    def __init__(self, cfg: Config, prices: Optional[PriceBook] = None, fx: Optional[FxTable] = None) -> None:
        self.cfg = cfg
        self.prices = prices or PriceBook()
        self.fx = fx or FxTable()
        self.pools: Dict[str, LotPool] = {}
        self.disposals: List[Disposal] = []
        self.incomes: List[IncomeRec] = []
        self.issues: List[Issue] = []
        self.movements: List[Movement] = []
        self.missing_prices: set = set()      # (symbol, 'YYYY-MM-DD')
        self.stats: Counter = Counter()
        self.rebase_total_value = ZERO
        self._classes: Dict[str, AssetClass] = {}
        self._lot_seq = 0
        self._rebased = False

    # ------------------------------------------------------------------ utilita'
    def issue(self, level: str, code: str, uid: str, message: str) -> None:
        self.issues.append(Issue(level, code, uid, message))

    def _pool(self, asset: str) -> LotPool:
        if asset not in self.pools:
            self.pools[asset] = LotPool(asset)
        return self.pools[asset]

    def _lot_id(self) -> str:
        self._lot_seq += 1
        return f"L{self._lot_seq:06d}"

    def _class(self, asset: str, hint: Optional[str] = None) -> AssetClass:
        if hint is not None:
            self._classes[asset] = classify(asset, hint)
        if asset not in self._classes:
            self._classes[asset] = classify(asset)
        return self._classes[asset]

    def _need_price(self, symbol: str, ts: datetime) -> None:
        self.missing_prices.add((symbol.upper(), tax_date(ts).isoformat()))

    def _to_eur(self, amount: Decimal, ccy: str, ts: datetime, uid: str) -> Optional[Decimal]:
        res = self.fx.to_eur(amount, ccy, ts, self.cfg.fx_max_gap_days)
        if res is None:
            self._need_price(ccy, ts)
            self.issue("block", "missing_fx", uid, f"Manca il cambio {ccy}/EUR per il {tax_date(ts)}")
            return None
        eur, gap = res
        if gap:
            self.issue("info", "fx_gap", uid, f"Cambio {ccy}/EUR: usato l'ultimo disponibile ({gap} gg prima)")
        return eur

    def _value_eur(self, e: Event) -> Tuple[Decimal, str]:
        """Controvalore EUR della gamba principale. Ordine: valore dalla fonte > prezzo*quantita'."""
        if e.value is not None:
            v = self._to_eur(e.value, e.value_ccy, e.ts, e.uid)
            if v is not None:
                return v, f"fonte({e.value_ccy})" if e.value_ccy != "EUR" else "fonte"
        if e.asset:
            p = self.prices.get(e.asset, e.ts)
            if p is not None:
                return p * e.qty, "prezzario"
        if e.counter_asset and e.counter_qty:
            p = self.prices.get(e.counter_asset, e.ts)
            if p is not None:
                return p * e.counter_qty, "prezzario(controparte)"
        self._need_price(e.asset or e.counter_asset, e.ts)
        self.issue("block", "missing_value", e.uid,
                   f"Impossibile valorizzare in EUR {e.qty} {e.asset} del {tax_date(e.ts)}: manca il prezzo")
        return ZERO, "MANCANTE"

    def _fee_eur(self, e: Event) -> Decimal:
        if e.fee_qty == 0 and e.fee_value is None:
            return ZERO
        if e.fee_value is not None:
            v = self._to_eur(e.fee_value, e.fee_value_ccy, e.ts, e.uid)
            return v if v is not None else ZERO
        if e.fee_asset and classify(e.fee_asset) == AssetClass.FIAT:
            v = self._to_eur(e.fee_qty, e.fee_asset, e.ts, e.uid)
            return v if v is not None else ZERO
        p = self.prices.get(e.fee_asset, e.ts)
        if p is None:
            self._need_price(e.fee_asset, e.ts)
            self.issue("block", "missing_fee_value", e.uid,
                       f"Manca il prezzo di {e.fee_asset} per valorizzare la commissione del {tax_date(e.ts)}")
            return ZERO
        return p * e.fee_qty

    # ------------------------------------------------------------------ operazioni elementari
    def _move(self, e: Event, account: str, asset: str, delta: Decimal, eur: Optional[Decimal] = None) -> None:
        self.movements.append(Movement(e.ts, account, asset, delta, eur, e.uid))

    def _acquire(self, e: Event, asset: str, qty: Decimal, cost: Decimal, documented: bool = True,
                 ts: Optional[datetime] = None) -> None:
        if qty == 0:
            return
        self._pool(asset).add(Lot(self._lot_id(), asset, ts or e.ts, qty, cost / qty, e.uid, documented))

    def _dispose(self, e: Event, asset: str, qty: Decimal, proceeds: Decimal, fee: Decimal,
                 kind: str, source: str, note: str = "") -> Disposal:
        uses, short = self._pool(asset).consume(qty)
        if short > 0:
            self.issue("block", "missing_history", e.uid,
                       f"Cessione di {qty} {asset} ma ne risultano disponibili solo {qty - short}: "
                       f"mancano {short} (storico incompleto o trasferimento non registrato). "
                       f"Il mancante e' trattato a costo ZERO (intero corrispettivo = plusvalenza).")
            uses.append(LotUse("MANCANTE", e.ts, short, ZERO, False, False, ""))
        cost = sum((u.cost for u in uses), ZERO)
        d = Disposal(e.uid, e.ts, e.account, asset, self._class(asset, e.asset_hint if asset == e.asset else None),
                     kind, qty, proceeds, fee, cost, proceeds - cost, uses, source, e.src, note)
        self.disposals.append(d)
        return d

    def _fee_disposal(self, e: Event, fee_eur: Decimal) -> None:
        """Commissione pagata in cripto: cessione dell'asset usato (interpretazione letterale, vedi report)."""
        if not e.fee_asset or e.fee_qty == 0 or classify(e.fee_asset) == AssetClass.FIAT:
            return
        self._move(e, e.account, e.fee_asset, -e.fee_qty, fee_eur)
        self._dispose(e, e.fee_asset, e.fee_qty, fee_eur, ZERO, "fee", "commissione")

    # ------------------------------------------------------------------ preparazione
    def _prepare(self, events: List[Event]) -> List[Event]:
        out: List[Event] = []
        for idx, e in sorted(enumerate(events), key=lambda t: (t[1].ts, t[0])):
            r = self.cfg.resolutions.get(e.uid)
            if r:
                act = r.get("action")
                if act == "ignore":
                    self.issue("info", "resolved_ignore", e.uid, f"Evento ignorato su richiesta: {r.get('reason', '')}")
                    continue
                if act == "set_value":
                    e = replace(e, value=Decimal(str(r["value_eur"])), value_ccy="EUR")
                    self.issue("info", "resolved_value", e.uid, f"Valore EUR impostato manualmente: {r['value_eur']}")
            out.append(e)
        return out

    def _match_transfers(self, evs: List[Event]):
        outs = [e for e in evs if e.kind == Kind.TRANSFER_OUT]
        ins = [e for e in evs if e.kind == Kind.TRANSFER_IN]
        window = timedelta(hours=self.cfg.transfer_window_hours).total_seconds()
        used: set = set()
        pair_of: Dict[str, Event] = {}
        for o in outs:
            best = None
            for i in ins:
                if i.uid in used or i.account == o.account or i.asset != o.asset:
                    continue
                dt = abs((i.ts - o.ts).total_seconds())
                if dt > window or i.qty > o.qty:
                    continue
                fee = o.qty - i.qty
                if fee > o.qty * self.cfg.transfer_fee_tolerance:
                    continue
                key = (dt, fee)
                if best is None or key < best[0]:
                    best = (key, i)
            if best:
                used.add(best[1].uid)
                pair_of[o.uid] = best[1]
                pair_of[best[1].uid] = o
        return pair_of

    def _rebase(self) -> None:
        """Rideterminazione: ogni cripto detenuta al 1/1/2025 ha costo = valore a quella data."""
        self._rebased = True
        for asset, pool in self.pools.items():
            if self._class(asset) != AssetClass.CRYPTO or pool.balance == 0:
                continue
            p = self.prices.get_day(asset, REBASE_DATE)
            if p is None:
                self.missing_prices.add((asset.upper(), REBASE_DATE.isoformat()))
                self.issue("block", "missing_rebase_price", "",
                           f"Manca il prezzo di {asset} al 1/1/2025 per la rideterminazione del costo")
                continue
            for lot in pool.lots:
                lot.unit_cost = p
                lot.rebased = True
                lot.cost_documented = True
            self.rebase_total_value += pool.balance * p

    # ------------------------------------------------------------------ ciclo principale
    def run(self, events: List[Event]) -> "Engine":
        evs = self._prepare(events)
        pair_of = self._match_transfers(evs)
        for e in evs:
            if self.cfg.rebase_1_1_2025 and not self._rebased and tax_date(e.ts) >= REBASE_DATE:
                self._rebase()
            self.stats[e.kind.value] += 1
            self._handle(e, pair_of)
        if self.cfg.rebase_1_1_2025 and not self._rebased:
            self._rebase()
        return self

    def _handle(self, e: Event, pair_of: Dict[str, Event]) -> None:
        k = e.kind
        if k in (Kind.INFO, Kind.FIAT_IN, Kind.FIAT_OUT):
            return
        if k == Kind.UNRESOLVED:
            self.issue("block", "unrecognized_row", e.uid, e.note or "Riga non riconosciuta")
            return
        cls = self._class(e.asset, e.asset_hint) if e.asset else AssetClass.OTHER
        if k not in (Kind.TRANSFER_IN, Kind.TRANSFER_OUT) and cls in (AssetClass.OTHER, AssetClass.FIAT):
            self.issue("warn", "out_of_scope", e.uid,
                       f"{e.kind.value} su {e.asset} ({cls.value}) fuori perimetro: ignorato")
            return

        if k == Kind.BUY:
            v, src = self._value_eur(e)
            fee = self._fee_eur(e)
            self._acquire(e, e.asset, e.qty, v + fee)
            self._move(e, e.account, e.asset, e.qty, v + fee)
            self._fee_disposal(e, fee)
        elif k in (Kind.SELL, Kind.SPEND):
            v, src = self._value_eur(e)
            fee = self._fee_eur(e)
            self._move(e, e.account, e.asset, -e.qty, v)
            self._dispose(e, e.asset, e.qty, v - fee, fee, k.value, src, e.note)
            self._fee_disposal(e, fee)
        elif k == Kind.SWAP:
            if classify(e.counter_asset) == AssetClass.FIAT or not e.counter_asset:
                self.issue("block", "bad_swap", e.uid, "Permuta senza asset di destinazione valido")
                return
            v, src = self._value_eur(e)
            fee = self._fee_eur(e)
            if e.asset in STABLECOINS and e.counter_asset in STABLECOINS:
                self.issue("info", "stable_swap", e.uid,
                           f"Scambio tra stablecoin {e.asset}->{e.counter_asset}: trattato come permuta imponibile "
                           f"(scelta interpretativa: non applicata l'esclusione per 'eguali caratteristiche e funzioni')")
            self._move(e, e.account, e.asset, -e.qty, v)
            self._dispose(e, e.asset, e.qty, v - fee, fee, "swap", src, e.note)
            self._acquire(e, e.counter_asset, e.counter_qty, v)
            self._move(e, e.account, e.counter_asset, e.counter_qty, v)
            self._fee_disposal(e, fee)
        elif k == Kind.INCOME:
            v, src = self._value_eur(e)
            self._acquire(e, e.asset, e.qty, v)
            self._move(e, e.account, e.asset, e.qty, v)
            self.incomes.append(IncomeRec(e.uid, e.ts, e.account, e.asset, cls, e.qty, v,
                                          e.income_type or "other", src, e.src))
        elif k == Kind.FEE:
            fee = self._value_eur(e)[0]
            self._move(e, e.account, e.asset, -e.qty, fee)
            self._dispose(e, e.asset, e.qty, fee, ZERO, "fee", "commissione")
        elif k == Kind.TRANSFER_OUT:
            self._transfer_out(e, pair_of.get(e.uid))
        elif k == Kind.TRANSFER_IN:
            self._transfer_in(e, pair_of.get(e.uid))

    # ------------------------------------------------------------------ trasferimenti
    def _transfer_out(self, e: Event, other: Optional[Event]) -> None:
        if other is not None:
            self._move(e, e.account, e.asset, -e.qty)
            fee_qty = e.qty - other.qty
            if fee_qty > 0:
                v = (e.value * fee_qty / e.qty) if e.value is not None else None
                fe = replace(e, kind=Kind.FEE, qty=fee_qty, value=v, value_ccy=e.value_ccy,
                             note="commissione di rete su trasferimento tra conti propri")
                fee_eur = self._value_eur(fe)[0]
                self._dispose(fe, e.asset, fee_qty, fee_eur, ZERO, "transfer_fee", "commissione di rete")
                self._move(e, "(rete)", e.asset, fee_qty)   # la commissione esce dal perimetro
            return
        res = self.cfg.resolutions.get(e.uid, {})
        act = res.get("action")
        if act == "disposal":
            fe = replace(e, kind=Kind.SELL, value=Decimal(str(res["value_eur"])), value_ccy="EUR")
            v, src = self._value_eur(fe)
            self._move(e, e.account, e.asset, -e.qty, v)
            self._dispose(fe, e.asset, e.qty, v, ZERO, "sell", "risoluzione manuale", "uscita trattata come cessione")
            self.issue("info", "resolved_disposal", e.uid, "Uscita trattata come cessione su richiesta")
            return
        self._move(e, e.account, e.asset, -e.qty)
        self._move(e, "self_custody", e.asset, e.qty)
        if act == "self_custody":
            self.issue("info", "resolved_self_custody", e.uid, "Uscita verso wallet proprio (self-custody): nessuna cessione")
        else:
            self.issue("block", "transfer_out_unmatched", e.uid,
                       f"Uscita di {e.qty} {e.asset} dal conto {e.account} senza ingresso corrispondente su altro conto. "
                       f"Ipotesi provvisoria: wallet proprio. Risolvere con action=self_custody o action=disposal.")

    def _transfer_in(self, e: Event, other: Optional[Event]) -> None:
        if other is not None:
            self._move(e, e.account, e.asset, e.qty)
            return
        res = self.cfg.resolutions.get(e.uid, {})
        act = res.get("action")
        if act == "from_self_custody":
            self._move(e, "self_custody", e.asset, -e.qty)
            self._move(e, e.account, e.asset, e.qty)
            self.issue("info", "resolved_from_self_custody", e.uid, "Ingresso da wallet proprio: nessun nuovo lotto")
            return
        if act == "set_cost":
            ts = e.ts
            if res.get("acquired"):
                ts = datetime.strptime(res["acquired"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            self._acquire(e, e.asset, e.qty, Decimal(str(res["cost_eur"])), True, ts)
            self._move(e, e.account, e.asset, e.qty, Decimal(str(res["cost_eur"])))
            self.issue("info", "resolved_cost", e.uid, f"Costo impostato manualmente: {res['cost_eur']} EUR")
            return
        self._acquire(e, e.asset, e.qty, ZERO, documented=False)
        self._move(e, e.account, e.asset, e.qty, ZERO)
        self.issue("block", "transfer_in_unmatched", e.uid,
                   f"Ingresso di {e.qty} {e.asset} su {e.account} senza uscita corrispondente su altro conto. "
                   f"Provvisoriamente a costo ZERO. Risolvere con action=set_cost (cost_eur, acquired) o from_self_custody.")
