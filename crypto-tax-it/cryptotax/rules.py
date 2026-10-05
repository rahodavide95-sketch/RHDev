"""Parametri fiscali per anno d'imposta.

ATTENZIONE: i valori sotto sono stati raccolti da fonti secondarie (stampa specializzata) perche' il sito
dell'Agenzia delle Entrate non era raggiungibile quando sono stati scritti. Ogni voce ha `status`.
Prima di usare il report per la dichiarazione vanno verificati sulle fonti primarie
(L. 197/2022, L. 207/2024, L. 199/2025, Circolare AdE 30/E del 27/10/2023, istruzioni Redditi PF dell'anno).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

D = Decimal


@dataclass(frozen=True)
class YearRules:
    year: int
    crypto_rate: Decimal
    crypto_threshold_eur: Optional[Decimal]   # franchigia 2.000 EUR (abolita dal 2025)
    metals_rate: Decimal                      # art. 67 c. 1 lett. c-ter
    ivca_rate: Decimal                        # imposta sul valore delle cripto-attivita' (quadro RW)
    loss_carry_years: int                     # minusvalenze riportabili nei N periodi successivi
    status: str
    sources: tuple


RULES = {
    2023: YearRules(2023, D("0.26"), D("2000"), D("0.26"), D("0.002"), 4, "da_verificare",
                    ("L. 197/2022 art. 1 c. 126-147",)),
    2024: YearRules(2024, D("0.26"), D("2000"), D("0.26"), D("0.002"), 4, "da_verificare",
                    ("L. 197/2022", "Circ. AdE 30/E 2023")),
    2025: YearRules(2025, D("0.26"), None, D("0.26"), D("0.002"), 4, "da_verificare",
                    ("L. 207/2024 (abolita franchigia 2.000 EUR dal 2025)",
                     "Circ. AdE 30/E 2023", "Istruzioni Redditi PF 2026")),
}


def rules_for(year: int) -> YearRules:
    try:
        return RULES[year]
    except KeyError:
        raise ValueError(f"Nessuna regola definita per l'anno {year}")
