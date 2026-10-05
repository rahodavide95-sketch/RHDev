"""Crypto.com Exchange - export CSV (SPOT_TRADE.csv e storico depositi/prelievi).

!! PROVVISORIO !! I nomi delle colonne non sono stati verificati su un file reale: si usano alias
(case-insensitive) e, se un campo obbligatorio non e' riconoscibile, l'import FALLISCE con l'elenco delle
intestazioni trovate. Nessun valore viene mai indovinato.
Sono importati solo i trade spot. I trade a margine/derivati (colonna 'Margin Order' = True, o strumenti
perpetui/futures) NON sono supportati e bloccano il report.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Optional, Tuple

from ..models import FIAT, STABLECOINS, Event, Kind
from .base import (ImportFormatError, ParseResult, UidFactory, parse_decimal, parse_ts, pick, read_table,
                   unresolved)

QUOTES = sorted(list(FIAT) + list(STABLECOINS) + ["BTC", "ETH", "CRO", "BNB"], key=len, reverse=True)

TRADE_ALIASES = {
    "time": ["trade date", "create time (utc)", "time (utc)", "trade time", "create time", "timestamp", "date"],
    "instrument": ["instrument", "instrument name", "symbol", "pair", "market"],
    "side": ["side"],
    "qty": ["traded quantity", "quantity", "qty", "filled quantity", "executed quantity"],
    "price": ["traded price", "price", "avg price", "average price", "executed price"],
    "fee": ["fee", "fees", "trading fee"],
    "fee_ccy": ["fee currency", "fees currency", "fee asset", "fee currency/instrument"],
    "id": ["trade id", "order id"],
    "margin": ["margin order"],
}

TRANSFER_ALIASES = {
    "time": ["time (utc)", "create time (utc)", "timestamp", "date", "time", "create time"],
    "asset": ["currency", "asset", "coin", "instrument"],
    "amount": ["amount", "quantity", "qty"],
    "type": ["type", "transaction type", "direction", "side"],
    "fee": ["fee", "fees", "network fee"],
    "id": ["id", "txid", "tx id", "transaction id", "hash"],
}


def split_pair(s: str) -> Tuple[str, str]:
    t = s.strip().upper().replace("-", "_").replace("/", "_")
    if "_" in t:
        base, quote = t.split("_", 1)
        return base, quote
    for q in QUOTES:
        if t.endswith(q) and len(t) > len(q):
            return t[: -len(q)], q
    raise ImportFormatError(f"Coppia di trading non interpretabile: {s!r}")


def _map(headers, aliases, required):
    out = {}
    for key, al in aliases.items():
        out[key] = pick(headers, al)
    miss = [k for k in required if not out.get(k)]
    if miss:
        raise ImportFormatError(f"Crypto.com Exchange: campi non riconosciuti {miss}. Intestazioni trovate: {headers}")
    return out


def parse_trades(path: str | Path, account: str = "cryptocom_exchange") -> ParseResult:
    headers, rows, hdr_line = read_table(path)
    m = _map(headers, TRADE_ALIASES, ["time", "instrument", "side", "qty", "price"])
    res = ParseResult(rows=len(rows))
    uids = UidFactory(account + ":trade")
    for n, row in enumerate(rows, start=hdr_line + 1):
        uid = uids.make(row)
        src = f"{Path(path).name}:{n}"
        ts = parse_ts(row[m["time"]])
        if m["margin"] and row.get(m["margin"], "").strip().lower() in ("true", "1", "yes"):
            res.events.append(unresolved(uid, ts, account, src, "Trade a margine: non supportato", row))
            continue
        try:
            base, quote = split_pair(row[m["instrument"]])
        except ImportFormatError as exc:
            res.events.append(unresolved(uid, ts, account, src, str(exc), row))
            continue
        side = row[m["side"]].strip().upper()
        qty = parse_decimal(row[m["qty"]])
        price = parse_decimal(row[m["price"]])
        if side not in ("BUY", "SELL") or qty is None or price is None:
            res.events.append(unresolved(uid, ts, account, src, f"Side/quantita'/prezzo non validi: {side} {qty} {price}", row))
            continue
        qty, price = abs(qty), abs(price)
        quote_amt = qty * price
        fee = parse_decimal(row[m["fee"]]) if m["fee"] else None
        fee_ccy = row.get(m["fee_ccy"], "").strip().upper() if m["fee_ccy"] else ""
        fee = abs(fee) if fee else Decimal(0)
        if fee and not fee_ccy:
            res.events.append(unresolved(uid, ts, account, src, "Commissione senza valuta", row))
            continue
        common = dict(uid=uid, ts=ts, account=account, ref=row.get(m["id"], "") if m["id"] else "", src=src, raw=row,
                      fee_asset=fee_ccy if fee else "", fee_qty=fee)
        if side == "BUY":
            if quote in FIAT:
                ev = Event(kind=Kind.BUY, asset=base, qty=qty, value=quote_amt, value_ccy=quote, **common)
            else:   # si cede la valuta di quotazione per ricevere la base: permuta
                ev = Event(kind=Kind.SWAP, asset=quote, qty=quote_amt, counter_asset=base, counter_qty=qty, **common)
        else:
            if quote in FIAT:
                ev = Event(kind=Kind.SELL, asset=base, qty=qty, value=quote_amt, value_ccy=quote, **common)
            else:
                ev = Event(kind=Kind.SWAP, asset=base, qty=qty, counter_asset=quote, counter_qty=quote_amt, **common)
        res.events.append(ev)
    return res


def parse_transfers(path: str | Path, account: str = "cryptocom_exchange") -> ParseResult:
    """Depositi e prelievi. Direzione: colonna tipo ('deposit'/'withdraw...') oppure segno dell'importo."""
    headers, rows, hdr_line = read_table(path)
    m = _map(headers, TRANSFER_ALIASES, ["time", "asset", "amount"])
    res = ParseResult(rows=len(rows))
    uids = UidFactory(account + ":xfer")
    for n, row in enumerate(rows, start=hdr_line + 1):
        uid = uids.make(row)
        src = f"{Path(path).name}:{n}"
        ts = parse_ts(row[m["time"]])
        asset = row[m["asset"]].strip().upper()
        amt = parse_decimal(row[m["amount"]])
        if amt is None:
            res.events.append(unresolved(uid, ts, account, src, "Importo mancante", row))
            continue
        typ = row.get(m["type"], "").strip().lower() if m["type"] else ""
        if "deposit" in typ:
            outgoing = False
        elif "withdraw" in typ:
            outgoing = True
        elif not typ:
            outgoing = amt < 0
        else:
            res.events.append(unresolved(uid, ts, account, src, f"Tipo di movimento non riconosciuto: '{typ}'", row))
            continue
        qty = abs(amt)
        common = dict(uid=uid, ts=ts, account=account, asset=asset, qty=qty,
                      ref=row.get(m["id"], "") if m["id"] else "", src=src, raw=row)
        # La colonna commissione NON viene usata: la commissione di rete emerge dall'abbinamento
        # uscita/ingresso (quantita' in uscita - quantita' in ingresso). Se l'importo esportato non include
        # la commissione, il saldo risultera' inferiore al reale e il motore segnalera' lo scostamento.
        if asset in FIAT:
            res.events.append(Event(kind=Kind.FIAT_OUT if outgoing else Kind.FIAT_IN, **common))
        elif outgoing:
            res.events.append(Event(kind=Kind.TRANSFER_OUT, **common))
        else:
            res.events.append(Event(kind=Kind.TRANSFER_IN, **common))
    return res
