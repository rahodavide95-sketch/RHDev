"""Bitpanda - export storico transazioni (CSV).

!! PROVVISORIO !! Struttura ricostruita da fonti secondarie, non verificata su un file reale.
Il file Bitpanda ha alcune righe di testo prima dell'intestazione: l'intestazione viene cercata
come la prima riga che contiene 'Transaction ID'.
Colonne attese: Transaction ID, Timestamp, Transaction Type, In/Out, Amount Fiat, Fiat, Amount Asset,
Asset, Asset market price, Asset market price currency, Asset class, Product ID, Fee, Fee asset,
Spread, Spread Currency [, Tax Fiat]

IPOTESI DA VERIFICARE su estratto conto bancario / app:
  1. 'Amount Fiat' e' l'importo realmente addebitato (buy) o accreditato (sell), commissioni gia' comprese:
     in tal caso la colonna 'Fee' NON va sommata di nuovo. Se non fosse cosi', l'errore e' pari alla commissione.
  2. L'unita' di 'Amount Asset' per i metalli e' quella esposta da Bitpanda (di norma grammi).
  3. Il fuso orario di 'Timestamp' (se privo di offset viene assunto UTC).
"""
from __future__ import annotations

from pathlib import Path

from ..models import FIAT, AssetClass, Event, Kind, classify
from .base import (ImportFormatError, ParseResult, UidFactory, parse_decimal, parse_ts, read_table,
                   unresolved)

REQUIRED = ["Transaction ID", "Timestamp", "Transaction Type", "Amount Fiat", "Fiat", "Amount Asset", "Asset"]
METAL_NAMES = {"GOLD": "XAU", "SILVER": "XAG", "PLATINUM": "XPT", "PALLADIUM": "XPD"}
INCOME_TYPES = {"staking": "staking", "reward": "other", "bonus": "other", "cashback": "cashback",
                "referral": "referral", "interest": "interest", "airdrop": "airdrop"}


def parse(path: str | Path, account: str = "bitpanda") -> ParseResult:
    headers, rows, hdr_line = read_table(path, header_marker="Transaction ID")
    missing = [h for h in REQUIRED if h not in headers]
    if missing:
        raise ImportFormatError(f"Bitpanda: colonne mancanti {missing}. Trovate: {headers}")
    res = ParseResult(rows=len(rows))
    uids = UidFactory(account)
    for n, row in enumerate(rows, start=hdr_line + 1):
        uid = uids.make(row)
        src = f"{Path(path).name}:{n}"
        ts = parse_ts(row["Timestamp"])
        typ = row["Transaction Type"].strip().lower()
        direction = row.get("In/Out", "").strip().lower()
        asset_class = row.get("Asset class", "").strip()
        asset = row["Asset"].strip().upper()
        asset = METAL_NAMES.get(asset, asset)
        qty = abs(parse_decimal(row["Amount Asset"]) or 0)
        fiat_amt = parse_decimal(row["Amount Fiat"])
        fiat_amt = abs(fiat_amt) if fiat_amt is not None else None
        fiat = row["Fiat"].strip().upper() or "EUR"
        cls = classify(asset, asset_class) if asset_class else classify(asset)
        hint = asset_class or None
        common = dict(uid=uid, ts=ts, account=account, ref=row["Transaction ID"], src=src, raw=row, asset_hint=hint)

        if cls == AssetClass.FIAT or asset in FIAT:
            if typ == "deposit":
                ev = Event(kind=Kind.FIAT_IN, asset=asset, qty=qty or (fiat_amt or 0), **common)
            elif typ == "withdrawal":
                ev = Event(kind=Kind.FIAT_OUT, asset=asset, qty=qty or (fiat_amt or 0), **common)
            else:
                ev = unresolved(uid, ts, account, src, f"Movimento fiat di tipo non riconosciuto: '{typ}'", row)
        elif typ == "buy":
            ev = Event(kind=Kind.BUY, asset=asset, qty=qty, value=fiat_amt, value_ccy=fiat, **common)
        elif typ == "sell":
            ev = Event(kind=Kind.SELL, asset=asset, qty=qty, value=fiat_amt, value_ccy=fiat, **common)
        elif typ == "deposit":
            ev = Event(kind=Kind.TRANSFER_IN, asset=asset, qty=qty, **common)
        elif typ == "withdrawal":
            ev = Event(kind=Kind.TRANSFER_OUT, asset=asset, qty=qty, **common)
        elif typ == "transfer" and direction in ("incoming", "in"):
            ev = Event(kind=Kind.TRANSFER_IN, asset=asset, qty=qty, **common)
        elif typ == "transfer" and direction in ("outgoing", "out"):
            ev = Event(kind=Kind.TRANSFER_OUT, asset=asset, qty=qty, **common)
        elif typ in INCOME_TYPES:
            ev = Event(kind=Kind.INCOME, asset=asset, qty=qty, value=fiat_amt, value_ccy=fiat,
                       income_type=INCOME_TYPES[typ], **common)
        else:
            ev = unresolved(uid, ts, account, src,
                            f"Transaction Type non riconosciuto: '{typ}' (In/Out='{direction}', classe='{asset_class}')", row)
        res.events.append(ev)
    return res
