"""Crypto.com App - export "Transaction history" (CSV).

!! PROVVISORIO !! La struttura e i valori di 'Transaction Kind' sono stati ricostruiti da fonti secondarie e
dalla memoria: NON sono stati verificati su un file reale. Ogni 'kind' non esplicitamente mappato diventa
una riga UNRESOLVED che blocca il report definitivo. Usare `python -m cryptotax inspect <file>` per vedere
l'elenco dei kind presenti nel proprio file e completare la mappa.

Colonne attese: Timestamp (UTC), Transaction Description, Currency, Amount, To Currency, To Amount,
Native Currency, Native Amount, Native Amount (in USD), Transaction Kind [, Transaction Hash]
Il segno di 'Amount' NON viene usato per decidere il tipo di operazione: si usa il 'kind'.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from ..models import FIAT, Event, Kind
from .base import (ImportFormatError, ParseResult, UidFactory, parse_decimal, parse_ts, read_table,
                   unresolved)

REQUIRED = ["Timestamp (UTC)", "Currency", "Amount", "Native Currency", "Native Amount", "Transaction Kind"]

BUY_KINDS = {"crypto_purchase", "viban_purchase"}
SELL_KINDS = {"crypto_viban_exchange"}
SWAP_KINDS = {"crypto_exchange"}
TRANSFER_OUT_KINDS = {"crypto_to_exchange_transfer", "crypto_withdrawal"}
TRANSFER_IN_KINDS = {"exchange_to_crypto_transfer", "crypto_deposit"}
SPEND_KINDS = {"crypto_payment"}
# kind -> tipo di provento
INCOME_KINDS = {
    "crypto_earn_interest_paid": "interest",
    "crypto_earn_extra_interest_paid": "interest",
    "mco_stake_reward": "staking",
    "staking_reward": "staking",
    "referral_card_cashback": "cashback",
    "reimbursement": "cashback",
    "referral_gift": "referral",
    "referral_bonus": "referral",
    "admin_wallet_credited": "other",
}
# movimenti interni senza effetto fiscale (blocco/sblocco in Earn/staking: la proprieta' non cambia)
INFO_KINDS = {
    "crypto_earn_program_created", "crypto_earn_program_withdrawn", "crypto_earn_program_extended",
    "lockup_lock", "lockup_upgrade", "supercharger_deposit", "supercharger_withdrawal",
}
FIAT_IN_KINDS = {"viban_deposit", "fiat_deposit"}
FIAT_OUT_KINDS = {"viban_withdrawal", "fiat_withdrawal"}


def _abs(d: Decimal | None) -> Decimal:
    return abs(d) if d is not None else Decimal(0)


def parse(path: str | Path, account: str = "cryptocom_app") -> ParseResult:
    headers, rows, hdr_line = read_table(path)
    missing = [h for h in REQUIRED if h not in headers]
    if missing:
        raise ImportFormatError(f"Crypto.com App: colonne mancanti {missing}. Trovate: {headers}")
    res = ParseResult(rows=len(rows))
    uids = UidFactory(account)
    for n, row in enumerate(rows, start=hdr_line + 1):
        uid = uids.make(row)
        src = f"{Path(path).name}:{n}"
        ts = parse_ts(row["Timestamp (UTC)"])
        kind = row["Transaction Kind"].strip().lower()
        cur = row["Currency"].strip().upper()
        amt = _abs(parse_decimal(row["Amount"]))
        to_cur = row.get("To Currency", "").strip().upper()
        to_amt = _abs(parse_decimal(row.get("To Amount", "")))
        n_ccy = row["Native Currency"].strip().upper() or "EUR"
        n_amt = parse_decimal(row["Native Amount"])
        n_amt = abs(n_amt) if n_amt is not None else None
        ref = row.get("Transaction Hash", "")
        common = dict(uid=uid, ts=ts, account=account, ref=ref, src=src, raw=row,
                      note=row.get("Transaction Description", ""))

        def swap_like() -> Event:
            """Decide BUY/SELL/SWAP dalla natura (fiat o cripto) delle due gambe."""
            if cur in FIAT and to_cur and to_cur not in FIAT:
                return Event(kind=Kind.BUY, asset=to_cur, qty=to_amt, value=amt, value_ccy=cur, **common)
            if to_cur in FIAT and cur not in FIAT:
                return Event(kind=Kind.SELL, asset=cur, qty=amt, value=to_amt, value_ccy=to_cur, **common)
            return Event(kind=Kind.SWAP, asset=cur, qty=amt, counter_asset=to_cur, counter_qty=to_amt,
                         value=n_amt, value_ccy=n_ccy, **common)

        if kind in BUY_KINDS:
            if to_cur and cur in FIAT:
                ev = Event(kind=Kind.BUY, asset=to_cur, qty=to_amt, value=amt, value_ccy=cur, **common)
            else:
                ev = Event(kind=Kind.BUY, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy, **common)
        elif kind in SELL_KINDS:
            if to_cur and to_cur in FIAT:
                ev = Event(kind=Kind.SELL, asset=cur, qty=amt, value=to_amt, value_ccy=to_cur, **common)
            else:
                ev = Event(kind=Kind.SELL, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy, **common)
        elif kind in SWAP_KINDS:
            ev = swap_like()
        elif kind in TRANSFER_OUT_KINDS:
            ev = Event(kind=Kind.TRANSFER_OUT, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy, **common)
        elif kind in TRANSFER_IN_KINDS:
            ev = Event(kind=Kind.TRANSFER_IN, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy, **common)
        elif kind in SPEND_KINDS:
            ev = Event(kind=Kind.SPEND, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy, **common)
        elif kind in INCOME_KINDS:
            ev = Event(kind=Kind.INCOME, asset=cur, qty=amt, value=n_amt, value_ccy=n_ccy,
                       income_type=INCOME_KINDS[kind], **common)
        elif kind in INFO_KINDS:
            ev = Event(kind=Kind.INFO, **common)
        elif kind in FIAT_IN_KINDS:
            ev = Event(kind=Kind.FIAT_IN, asset=cur, qty=amt, **common)
        elif kind in FIAT_OUT_KINDS:
            ev = Event(kind=Kind.FIAT_OUT, asset=cur, qty=amt, **common)
        else:
            ev = unresolved(uid, ts, account, src, f"Transaction Kind non riconosciuto: '{kind}'", row)
        res.events.append(ev)
    return res
