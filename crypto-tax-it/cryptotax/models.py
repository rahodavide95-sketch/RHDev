"""Modello dati canonico. Tutti gli importi sono Decimal: mai float."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, getcontext
from enum import Enum
from typing import Optional
from zoneinfo import ZoneInfo

getcontext().prec = 50
ZERO = Decimal(0)
ROME = ZoneInfo("Europe/Rome")

FIAT = {
    "EUR", "USD", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK",
    "PLN", "CZK", "HUF", "TRY", "BRL",
}
METAL_SYMBOLS = {"XAU", "XAG", "XPT", "XPD", "GOLD", "SILVER", "PLATINUM", "PALLADIUM"}
# Solo informativo: gli scambi tra stablecoin vengono segnalati (interpretazione "eguali caratteristiche").
STABLECOINS = {"USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "EURC", "EURT", "PYUSD", "FDUSD", "USDD"}


class AssetClass(str, Enum):
    CRYPTO = "crypto"  # art. 67 c. 1 lett. c-sexies TUIR
    METAL = "metal"    # art. 67 c. 1 lett. c-ter TUIR
    FIAT = "fiat"
    OTHER = "other"    # azioni, ETF, ecc.: fuori perimetro


def classify(symbol: str, hint: Optional[str] = None) -> AssetClass:
    """Classifica un asset. `hint` e' la classe dichiarata dalla fonte (es. Bitpanda 'Asset class')."""
    s = symbol.upper()
    if hint:
        h = hint.strip().lower()
        if h in ("cryptocurrency", "crypto", "cryptocoin", "token"):
            return AssetClass.CRYPTO
        if h in ("metal", "metals", "precious metal", "precious metals"):
            return AssetClass.METAL
        if h == "fiat":
            return AssetClass.FIAT
        return AssetClass.OTHER
    if s in FIAT:
        return AssetClass.FIAT
    if s in METAL_SYMBOLS:
        return AssetClass.METAL
    return AssetClass.CRYPTO


class Kind(str, Enum):
    BUY = "buy"                    # fiat -> asset
    SELL = "sell"                  # asset -> fiat
    SWAP = "swap"                  # asset -> asset (permuta, imponibile)
    INCOME = "income"              # asset ricevuto a titolo gratuito (staking, interessi, airdrop, cashback...)
    SPEND = "spend"                # asset usato per pagare beni/servizi (cessione)
    TRANSFER_OUT = "transfer_out"  # asset in uscita da un conto
    TRANSFER_IN = "transfer_in"    # asset in ingresso su un conto
    FEE = "fee"                    # commissione pagata in asset (cessione)
    FIAT_IN = "fiat_in"
    FIAT_OUT = "fiat_out"
    INFO = "info"                  # riga nota e senza effetti fiscali (es. blocco/sblocco Earn)
    UNRESOLVED = "unresolved"      # riga non riconosciuta: blocca il report definitivo


@dataclass(frozen=True)
class Event:
    uid: str
    ts: datetime                   # UTC, timezone-aware
    account: str                   # custode: es. 'cryptocom_app', 'cryptocom_exchange', 'bitpanda'
    kind: Kind
    asset: str = ""                # gamba principale (acquistata / venduta / ceduta / ricevuta / spostata)
    qty: Decimal = ZERO
    asset_hint: Optional[str] = None
    counter_asset: str = ""        # per SWAP: asset ricevuto
    counter_qty: Decimal = ZERO
    value: Optional[Decimal] = None   # controvalore della gamba principale (valore normale / corrispettivo)
    value_ccy: str = "EUR"
    fee_asset: str = ""
    fee_qty: Decimal = ZERO
    fee_value: Optional[Decimal] = None
    fee_value_ccy: str = "EUR"
    income_type: str = ""          # staking | interest | airdrop | cashback | referral | other
    ref: str = ""
    note: str = ""
    src: str = ""                  # file:riga, per l'audit
    raw: dict = field(default_factory=dict, compare=False, hash=False, repr=False)

    def local_date(self) -> date:
        return tax_date(self.ts)


def tax_date(ts: datetime) -> date:
    """Data fiscale = data di calendario in Italia (Europe/Rome)."""
    return ts.astimezone(ROME).date()


def utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class Issue:
    level: str   # 'block' | 'warn' | 'info'
    code: str
    uid: str
    message: str
