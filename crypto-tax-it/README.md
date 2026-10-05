# cryptotax - calcolo fiscale 2025 (Italia): Crypto.com App/Exchange + oro Bitpanda

Strumento a riga di comando, **senza dipendenze esterne** (solo Python >= 3.11), che legge gli export delle
piattaforme e produce: plus/minusvalenze con lotti LIFO, proventi, imposta sostitutiva per paniere
(cripto c-sexies / metalli preziosi c-ter), prospetto RW/IVCA e un **audit lotto per lotto**.

> **STATO: PROTOTIPO NON VALIDATO.** Il motore di calcolo e' coperto da test con casi calcolati a mano, ma gli
> **importatori sono scritti su formati ricostruiti da fonti secondarie e NON ancora verificati su file reali**, e le
> regole fiscali sono marcate `da_verificare` (vedi `cryptotax/rules.py`). Non usare i numeri per la dichiarazione
> finche' il report non e' privo di problemi bloccanti **e** rivisto da un commercialista.

## ATTENZIONE: questo repository pubblica su GitHub Pages

Il workflow `.github/workflows/deploy-pages.yml` pubblica **l'intera cartella radice** a ogni push su `main`.
Perciò: **non fare il merge di questo branch su `main`**, non committare mai export, chiavi API o report
(il `.gitignore` di questa cartella li esclude, ma controlla sempre con `git status`). Meglio spostare il
progetto in un repository **privato** dedicato.

## Uso

```bash
cd crypto-tax-it
# 1. Struttura dei tuoi file, SENZA importi (puoi incollarla in chat per validare i parser):
python3 -m cryptotax inspect data/cryptocom_app.csv
python3 -m cryptotax inspect data/bitpanda.csv

# 2. Configurazione
cp config.example.json config.json      # e adatta i percorsi

# 3. Calcolo (exit code 2 se ci sono problemi bloccanti; --draft per ottenere comunque il report)
python3 -m cryptotax run --config config.json --draft
```

Output in `out/`: `riepilogo_2025.md`, `cessioni_2025.csv`, `cessioni_2025_dettaglio_lotti.csv`,
`proventi_2025.csv`, `rw_2025.csv`, `problemi.csv`, `prezzi_mancanti.csv`.

Test: `python3 -m unittest discover -s tests -t .`

## File di input (tutti CSV)

| File | Contenuto |
|---|---|
| export Crypto.com App | storico transazioni (CSV) |
| export Crypto.com Exchange | `SPOT_TRADE.csv` + storico depositi/prelievi |
| export Bitpanda | storico transazioni (CSV, anche con righe di testo iniziali) |
| `prices_eur.csv` | `date,symbol,eur_price` - prezzo EUR giornaliero; serve per 1/1 e 31/12 (RW), per le permute senza controvalore e per la rideterminazione. L'elenco di cio' che manca e' in `prezzi_mancanti.csv` |
| `fx_eur.csv` | `date,currency,rate` - cambi BCE (unita' di valuta per 1 EUR), solo se ci sono operazioni in valuta diversa da EUR |
| `resolutions.json` | decisioni esplicite per i casi ambigui (vedi sotto) |

### Risoluzione dei casi ambigui (`resolutions.json`)

Il programma **non indovina mai**. Un trasferimento senza controparte, una riga non riconosciuta o un prezzo
mancante generano un problema *bloccante*; il calcolo prosegue con l'ipotesi piu' prudente (costo/valore zero) e
il report resta una BOZZA. Si risolve per `uid` (visibile in `problemi.csv`):

```json
{
  "cryptocom_app:a28e97238f": {"action": "self_custody"},
  "cryptocom_app:bb11cc22dd": {"action": "disposal", "value_eur": "130.50"},
  "cryptocom_exchange:xfer:1234abcd56": {"action": "set_cost", "cost_eur": "40", "acquired": "2023-05-01"},
  "bitpanda:99aa88bb77": {"action": "ignore", "reason": "duplicato"},
  "cryptocom_exchange:trade:0f0f0f0f0f": {"action": "set_value", "value_eur": "250"}
}
```

## Cosa e' implementato

Vedi `docs/SPECIFICA.md` per il perimetro, le regole applicate, le scelte interpretative e cio' che manca.
