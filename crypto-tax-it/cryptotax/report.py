"""Scrittura dei risultati: riepilogo (Markdown) + file CSV di audit."""
from __future__ import annotations

import csv
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import List

from .models import ZERO, tax_date
from .tax import BasketResult

Q2 = Decimal("0.01")

INTERPRETATIONS = [
    "Costo dei lotti: LIFO, un unico pool per asset su tutti i conti (Circ. AdE 30/E 2023, regime dichiarativo).",
    "Permuta cripto->cripto, cripto->stablecoin e pagamenti in cripto: cessioni imponibili al valore normale del giorno.",
    "Scambi tra stablecoin: trattati come permute imponibili (non applicata l'esclusione 'eguali caratteristiche e funzioni').",
    "Commissioni in cripto: costituiscono cessione dell'asset usato e, per il loro controvalore, onere accessorio dell'operazione.",
    "Proventi (staking, interessi, cashback, airdrop, referral): tassati al valore normale alla percezione; "
    "il valore diventa costo del lotto; NON compensabili con minusvalenze da cessione.",
    "Metalli preziosi (c-ter): paniere separato; le minusvalenze cripto non lo compensano e viceversa.",
    "Data fiscale = data di calendario in Italia (Europe/Rome) dell'orario UTC dell'export.",
    "Cambi: BCE del giorno; se assente (festivi) ultimo disponibile entro 7 giorni (segnalato). Prezzi cripto: del giorno, nessuna interpolazione.",
    "Importi arrotondati all'unita' di euro solo ai totali di quadro (non alle singole operazioni).",
]


def eur(x) -> str:
    return "" if x is None else str(Decimal(x).quantize(Q2))


def qty(x) -> str:
    if x is None:
        return ""
    s = format(Decimal(x).normalize(), "f")
    return s


def _write_csv(path: Path, header: List[str], rows: List[list]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def write_all(engine, baskets: List[BasketResult], rw_rows, cfg, rules, out_dir: Path, source_notes: List[str],
              extra_issues) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    y = cfg.target_year
    issues = list(extra_issues) + list(engine.issues)
    blocking = [i for i in issues if i.level == "block"]

    ds = sorted([d for d in engine.disposals if d.year == y], key=lambda d: (d.ts, d.uid))
    _write_csv(out_dir / f"cessioni_{y}.csv",
               ["uid", "data_it", "conto", "asset", "classe", "tipo", "quantita", "corrispettivo_netto_eur",
                "commissioni_eur", "costo_eur", "plus_minus_eur", "fonte_valore", "origine"],
               [[d.uid, tax_date(d.ts).isoformat(), d.account, d.asset, d.asset_class.value, d.kind, qty(d.qty),
                 eur(d.proceeds), eur(d.fee), eur(d.cost), eur(d.gain), d.value_source, d.src] for d in ds])
    _write_csv(out_dir / f"cessioni_{y}_dettaglio_lotti.csv",
               ["uid_cessione", "data_it", "asset", "lotto", "data_acquisto", "quantita_dal_lotto", "costo_eur",
                "costo_documentato", "rideterminato_1_1_2025", "uid_acquisto"],
               [[d.uid, tax_date(d.ts).isoformat(), d.asset, u.lot_id, tax_date(u.acquired_ts).isoformat(),
                 qty(u.qty), eur(u.cost), "si" if u.cost_documented else "NO", "si" if u.rebased else "no", u.origin]
                for d in ds for u in d.uses])
    inc = sorted([i for i in engine.incomes if i.year == y], key=lambda i: (i.ts, i.uid))
    _write_csv(out_dir / f"proventi_{y}.csv",
               ["uid", "data_it", "conto", "asset", "classe", "tipo", "quantita", "valore_normale_eur", "fonte_valore", "origine"],
               [[i.uid, tax_date(i.ts).isoformat(), i.account, i.asset, i.asset_class.value, i.income_type,
                 qty(i.qty), eur(i.value), i.value_source, i.src] for i in inc])
    _write_csv(out_dir / f"rw_{y}.csv",
               ["custode", "asset", "classe", "qta_1_1", "qta_31_12", "giorni", "valore_iniziale_eur",
                "valore_finale_eur", "ivca_indicativa_eur", "note"],
               [[r.account, r.asset, r.asset_class.value, qty(r.qty_start), qty(r.qty_end), r.days,
                 eur(r.value_initial), eur(r.value_final), eur(r.ivca), r.notes] for r in rw_rows])
    _write_csv(out_dir / "problemi.csv", ["livello", "codice", "uid", "messaggio"],
               [[i.level, i.code, i.uid, i.message] for i in sorted(issues, key=lambda i: ("block", "warn", "info").index(i.level))])
    _write_csv(out_dir / "prezzi_mancanti.csv", ["symbol", "date"], sorted(engine.missing_prices))

    L: List[str] = []
    L.append(f"# Riepilogo fiscale {y} - cripto e metalli preziosi")
    L.append("")
    if blocking:
        L.append(f"> **BOZZA - NON UTILIZZARE PER LA DICHIARAZIONE.** {len(blocking)} problemi bloccanti "
                 f"(vedi `problemi.csv`). I numeri sotto includono ipotesi provvisorie (costo zero, valore zero).")
    else:
        L.append("> Nessun problema bloccante rilevato. Questo NON equivale a un calcolo corretto: "
                 "serve comunque la verifica dei punti in 'Verifiche richieste' e la revisione di un professionista.")
    L.append("")
    L.append(f"Regole anno {y}: stato `{rules.status}` - fonti: {'; '.join(rules.sources)}")
    L.append("")
    L.append("## Imposta sostitutiva per paniere")
    for b in baskets:
        L.append("")
        L.append(f"### {b.name}  (aliquota {b.rate * 100:.0f}%)")
        L.append(f"- Cessioni nell'anno: {b.n_disposals}")
        L.append(f"- Corrispettivi (netti commissioni): {eur(b.proceeds)}  |  Costi: {eur(b.costs)}")
        L.append(f"- Plusvalenze: {eur(b.gains)}  |  Minusvalenze: {eur(b.losses)}  |  Saldo: {eur(b.net)}")
        L.append(f"- Proventi (staking/interessi/ecc., non compensabili): {eur(b.income)}")
        for yr, a in b.carry_used:
            L.append(f"- Minusvalenza {yr} utilizzata: {eur(a)}")
        for yr, a in b.carry_unused:
            L.append(f"- Minusvalenza {yr} ancora riportabile: {eur(a)}")
        for yr, a in b.carry_expired:
            L.append(f"- Minusvalenza {yr} SCADUTA (oltre il 4o anno): {eur(a)}")
        if b.new_loss:
            L.append(f"- **Nuova minusvalenza {y} da riportare (da indicare in dichiarazione): {b.new_loss}**")
        L.append(f"- **Imponibile (arrotondato): {b.taxable}  ->  imposta sostitutiva: {b.tax}**")
    total = sum((b.tax for b in baskets), ZERO)
    L.append("")
    L.append(f"**Totale imposta sostitutiva da versare (stima): {total} EUR**")
    if cfg.rebase_1_1_2025:
        L.append("")
        L.append(f"Rideterminazione al 1/1/2025 attiva: valore rideterminato {eur(engine.rebase_total_value)} EUR "
                 f"(imposta sostitutiva 18% = {eur(engine.rebase_total_value * Decimal('0.18'))} EUR, da pagare/gia' pagata a parte).")
    L.append("")
    L.append("## Monitoraggio (RW) e IVCA - bozza")
    L.append(f"IVCA indicativa totale: {eur(sum((r.ivca for r in rw_rows), ZERO))} EUR (vedi `rw_{y}.csv`; formula e codici da verificare sulle istruzioni).")
    L.append("")
    L.append("## Scelte interpretative applicate")
    for s in INTERPRETATIONS:
        L.append(f"- {s}")
    L.append("")
    L.append("## Problemi rilevati")
    cnt = Counter((i.level, i.code) for i in issues)
    if not cnt:
        L.append("- nessuno")
    for (lvl, code), n in sorted(cnt.items(), key=lambda t: (("block", "warn", "info").index(t[0][0]), t[0][1])):
        L.append(f"- [{lvl}] {code}: {n}")
    L.append("")
    L.append("## Origine dei dati")
    for s in source_notes:
        L.append(f"- {s}")
    L.append("")
    L.append("## Verifiche richieste prima di usare i numeri")
    L.append("- Confrontare i saldi finali per conto con quelli mostrati dalle piattaforme al 31/12.")
    L.append("- Verificare le ipotesi indicate nei docstring degli importatori (commissioni, unita' dei metalli, fuso orario).")
    L.append("- Verificare aliquote, righi del quadro RT/RW e criterio IVCA sulle istruzioni ufficiali Redditi PF dell'anno.")
    L.append("- Far rivedere a un commercialista la qualificazione dell'oro Bitpanda (c-ter) e l'obbligo/codice RW.")
    (out_dir / f"riepilogo_{y}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    return {"blocking": len(blocking), "total_tax": total}
