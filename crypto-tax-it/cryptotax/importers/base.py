"""Utilita' comuni agli importatori. Principio: formato sconosciuto => errore esplicito, mai ipotesi."""
from __future__ import annotations

import csv
import hashlib
import io
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from ..models import Event, Issue, Kind


class ImportFormatError(Exception):
    """Il file non ha la struttura attesa."""


@dataclass
class ParseResult:
    events: List[Event] = field(default_factory=list)
    issues: List[Issue] = field(default_factory=list)
    rows: int = 0


def parse_decimal(s: Optional[str]) -> Optional[Decimal]:
    """'1,234.56' e '1.234,56' e '1,5' (virgola sola = decimale) -> Decimal. Vuoto -> None."""
    if s is None:
        return None
    t = s.strip().replace(" ", "").replace(" ", "")
    if t in ("", "-", "N/A", "n/a"):
        return None
    if "," in t and "." in t:
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")
        else:
            t = t.replace(",", "")
    elif "," in t:
        t = t.replace(",", ".")
    try:
        return Decimal(t)
    except InvalidOperation:
        raise ImportFormatError(f"Numero non interpretabile: {s!r}")


def parse_ts(s: str, assume_utc: bool = True) -> datetime:
    t = s.strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
                "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.fromisoformat(t) if fmt is None else datetime.strptime(t, fmt)
            break
        except ValueError:
            continue
    else:
        raise ImportFormatError(f"Data/ora non interpretabile: {s!r}")
    if dt.tzinfo is None:
        if not assume_utc:
            raise ImportFormatError(f"Data senza fuso orario: {s!r}")
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def read_table(path: str | Path, header_marker: Optional[str] = None) -> Tuple[List[str], List[Dict[str, str]], int]:
    """Legge un CSV. Se `header_marker` e' dato, la riga di intestazione e' la prima che lo contiene
    (Bitpanda antepone righe di testo). Ritorna (intestazioni, righe, numero_riga_intestazione)."""
    text = Path(path).read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    hdr_idx = 0
    if header_marker:
        for i, ln in enumerate(lines):
            if header_marker.lower() in ln.lower():
                hdr_idx = i
                break
        else:
            raise ImportFormatError(f"Intestazione con '{header_marker}' non trovata in {path}")
    else:
        while hdr_idx < len(lines) and not lines[hdr_idx].strip():
            hdr_idx += 1
    if hdr_idx >= len(lines):
        raise ImportFormatError(f"File vuoto: {path}")
    head = lines[hdr_idx]
    delim = max((",", ";", "\t"), key=head.count)
    reader = csv.DictReader(io.StringIO("\n".join(lines[hdr_idx:])), delimiter=delim)
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = []
    for row in reader:
        clean = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        if any(clean.values()):
            rows.append(clean)
    return headers, rows, hdr_idx + 1


def pick(headers: Sequence[str], aliases: Sequence[str]) -> Optional[str]:
    low = {h.lower(): h for h in headers}
    for a in aliases:
        if a.lower() in low:
            return low[a.lower()]
    return None


class UidFactory:
    """UID deterministici: hash del contenuto della riga + contatore per righe identiche."""

    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self.seen: Counter = Counter()

    def make(self, row: Dict[str, str]) -> str:
        h = hashlib.sha1("|".join(f"{k}={row[k]}" for k in sorted(row)).encode()).hexdigest()[:10]
        self.seen[h] += 1
        return f"{self.prefix}:{h}" + (f"#{self.seen[h]}" if self.seen[h] > 1 else "")


def unresolved(uid: str, ts: datetime, account: str, src: str, message: str, row: Dict[str, str]) -> Event:
    return Event(uid=uid, ts=ts, account=account, kind=Kind.UNRESOLVED, note=message, src=src, raw=row)
