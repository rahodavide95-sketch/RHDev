# Gestionale Entrate/Uscite per Etichette Discografiche
### Documento di progetto — versione 1.0 (17 giugno 2026)

> Documento pensato per essere letto **anche da chi non è tecnico**. I termini
> tecnici sono spiegati la prima volta che compaiono. Niente codice qui dentro:
> è il "progetto su carta" da valutare prima di costruire.

---

## 1. In una frase: si può fare?

**Sì.** Si può costruire un tool che registra in automatico le entrate (vendite)
di una label con data, prodotto, catalogo, artista, importo, ecc. — e che gestisce
anche le uscite (spese).

**Ma** non funziona come molti immaginano ("mi collego con un'API a ogni
piattaforma e prendo tutto"). La parte automatica seria si basa su **due meccanismi
combinati**:

1. **Import di file CSV/Excel** (il motore principale) — ogni piattaforma o
   distributore ti dà un file di vendite scaricabile; il tool lo legge e lo
   trasforma in dati ordinati.
2. **Connettori API** dove esistono davvero (Bandcamp, Stripe, PayPal) — qui sì,
   automazione completa senza scaricare nulla a mano.

Questo non è un compromesso: è **esattamente come lavorano i prodotti professionali
del settore**. Te lo spiego sotto.

---

## 2. Il problema che risolviamo

Oggi una label indipendente gestisce i soldi così:
- Apre 5-6 pannelli diversi (Bandcamp, il distributore, PayPal, la banca…).
- Scarica report in formati diversi.
- Li incolla a mano in un foglio Excel.
- Calcola a mano quanto spetta a ogni artista.
- Non ha mai una vista chiara del **guadagno reale per release**.

È lento, pieno di errori, e non scala. Il tool elimina questo lavoro manuale.

---

## 3. Come funzionano DAVVERO le fonti dati (la parte onesta)

Questa tabella è il cuore della fattibilità. È importante capirla bene.

| Fonte | C'è un'API ufficiale per le vendite? | Come prendiamo i dati nella pratica |
|---|---|---|
| **Bandcamp** | ✅ **Sì** | API ufficiale "Sales Report" (autenticazione OAuth2, restituisce JSON e CSV). Va richiesto l'accesso a Bandcamp. **Automazione vera.** |
| **Beatport** | ⚠️ No (non pubblica per le vendite) | Le vendite Beatport arrivano tramite il **distributore** o dal pannello "Beatport for Labels", in **CSV**. |
| **Spotify / Apple Music / Deezer / Tidal** | ❌ No (non vendono loro) | Non ti pagano le piattaforme: ti paga il **distributore**. La fonte vera è il **report CSV del distributore**. |
| **Distributori** (DistroKid, Believe, Symphonic, Labelcamp, IDOL…) | ⚠️ Raramente API | Quasi sempre **CSV/Excel** scaricabile dal pannello. È la fonte n°1 di dati per una label. |
| **Traxsource / Juno Download** | ❌ Per lo più no | CSV / statement del distributore. |
| **PayPal / Stripe** | ✅ Sì | API + CSV. Utile per entrate dirette e per **riconciliare** i pagamenti reali. |
| **Banca** | ⚠️ Dipende (PSD2/open banking) | CSV dell'estratto conto; API bancarie possibili ma complesse. |

### La conclusione che guida tutto il progetto

> Per una label, la fonte di verità del ~90% delle entrate **non è la singola
> piattaforma di streaming, è il distributore** — e i distributori danno **CSV**.

Quindi il prodotto **non** è "tante integrazioni API". Il prodotto è:

- un **motore di import CSV universale** (la parte che dà valore e che è difficile
  da fare bene), **più**
- **connettori API** dove convengono davvero (Bandcamp, Stripe, PayPal).

**Vantaggio commerciale enorme:** il CSV funziona con *qualunque* piattaforma —
oggi e in futuro, anche quelle che non esistono ancora. Le API invece cambiano e
si rompono. Costruire sul CSV rende il prodotto **a prova di futuro**.

---

## 4. La soluzione, spiegata semplice

Immagina un imbuto:

```
  Bandcamp CSV ─┐
  Distributore ─┤
  Beatport CSV ─┤──►  [ MOTORE DI NORMALIZZAZIONE ]  ──►  Database unico ordinato
  PayPal/Stripe─┤         (riconosce il formato,            (schema canonico)
  Bandcamp API ─┘          mappa le colonne)                      │
                                                                   ▼
                                              Dashboard · Report · Royalty · Export
```

- **Tu carichi** (o il sistema scarica via API) i file delle vendite.
- Il **motore di normalizzazione** capisce "questa colonna è la data, questa è il
  catalogo, questa è il netto…" e mette tutto in un formato unico.
- Tutto finisce in un **database** (archivio ordinato) con uno **schema canonico**
  (un modo standard di descrivere ogni vendita, uguale per tutte le fonti).
- Da lì nascono **dashboard, report, calcolo royalty, export per il commercialista**.

La "magia" che il cliente paga è il motore di normalizzazione: caricare un file
disordinato e ritrovarlo perfetto nel gestionale.

---

## 5. Funzionalità

### MVP (versione minima utile — prima per la TUA label)
- Caricamento file CSV/Excel di vendite.
- Riconoscimento/mappatura colonne (Bandcamp e 1 distributore per iniziare).
- **Entrate** registrate con: data, piattaforma, prodotto, **catalogo**, artista,
  ISRC/UPC, quantità, lordo, commissioni, **netto**, valuta.
- **Uscite** (spese): mastering, artwork, promo, anticipi artisti, PR, ecc.
- **Dashboard**: entrate vs uscite, per mese, per release, per piattaforma.
- Export CSV/PDF.

### Versione completa (prodotto vendibile)
- **Connettore Bandcamp API** (download automatico, niente file a mano).
- Connettori Stripe/PayPal.
- **Calcolo royalty/split per artista** (vedi §8) — la *killer feature*.
- **Multi-valuta** con cambio storico.
- Gestione **anticipi** e recupero anticipi (recoupment).
- **Multi-utente / multi-label** (un account per ogni label cliente).
- Inviti per artisti (vista in sola lettura dei propri guadagni).
- Report fiscali / export per commercialista.
- Avvisi (es. "nuovo report disponibile", "release X è andata in profitto").

---

## 6. Lo schema canonico (il "formato unico")

Ogni vendita, da qualsiasi fonte, viene salvata con questi campi standard:

| Campo | Significato | Esempio |
|---|---|---|
| data | quando è avvenuta la vendita | 2026-05-12 |
| piattaforma | dove | Bandcamp |
| tipo | digitale / fisico / streaming / merch | digitale |
| catalogo | codice catalogo release | SC003 |
| titolo_prodotto | nome traccia/release/merch | "Nightform EP" |
| artista | artista principale | Raho |
| isrc / upc | codici univoci traccia/release | ITXXX2600123 |
| quantita | numero di unità | 3 |
| lordo | incasso prima delle fee | 8,70 € |
| commissioni | fee piattaforma/distributore | 1,30 € |
| netto | quanto incassi davvero | 7,40 € |
| valuta | moneta originale | EUR |
| netto_eur | netto convertito in euro | 7,40 € |

Avere questo formato unico è ciò che rende possibili dashboard e royalty affidabili.

---

## 7. Architettura tecnica (spiegata per non tecnici)

Oggi il sito della label è **statico**: pagine che non ricordano nulla. Un
gestionale deve **ricordare i dati** e **fare calcoli**, quindi serve qualcosa in
più. In parole semplici servono tre pezzi:

1. **Interfaccia (front-end)** — ciò che vedi e usi nel browser: caricamento file,
   dashboard, grafici.
2. **Cervello (back-end)** — il programma che legge i CSV, fa i calcoli, parla con
   le API di Bandcamp ecc. Gira "nel cloud", non sul tuo computer.
3. **Archivio (database)** — dove i dati restano salvati e protetti per ogni label.

### Stack consigliato (tecnologie), scelto per essere economico e gestibile
- **Front-end:** stesso stile del sito attuale, oppure framework moderno (React).
- **Back-end + Database:** **Supabase** (database Postgres + login già pronti) o
  soluzioni serverless su **Vercel** (dove già pubblichi il sito). Costo iniziale
  ~0 €, cresce solo quando crescono i clienti.
- **Vantaggio:** parte gratis, e la stessa base regge sia l'uso personale sia il
  futuro prodotto multi-label.

> Nota per il non-tecnico: non devi gestire server tu. Questi servizi sono
> "chiavi in mano": ci pensano loro a tenerli accesi e sicuri.

---

## 8. Royalty / Split artisti (la funzione che fa vendere il prodotto)

Per ogni release definisci le quote: es. su SC003 → 50% Raho, 30% Jacom, 20% label.
Il tool, ogni volta che arriva una vendita di SC003, **calcola e accumula** in
automatico quanto spetta a ciascuno, gestisce gli **anticipi** (se hai pagato un
anticipo all'artista, lo recuperi prima di pagargli le royalty) e genera lo
**statement** pronto da inviare. Questa è la cosa che le label oggi fanno a mano in
Excel e che pagherebbero per automatizzare.

---

## 9. Roadmap a fasi (con stime indicative)

Le stime presuppongono sviluppo assistito (come questo) e possono variare.

| Fase | Cosa | Risultato | Tempo indicativo |
|---|---|---|---|
| **0** | Questo documento + decisioni | Progetto chiaro | fatto |
| **1 — MVP personale** | Upload CSV, schema canonico, entrate/uscite, dashboard, export | Tu smetti di usare Excel | 1–2 settimane |
| **2 — Automazione** | Connettore Bandcamp API + Stripe/PayPal | Vendite che entrano da sole | +1–2 settimane |
| **3 — Royalty** | Split artisti, anticipi, statement | Feature che vende | +1–2 settimane |
| **4 — SaaS** | Multi-label, login, inviti, pricing, pagamenti | Prodotto vendibile | +3–4 settimane |

**Strategia consigliata: costruire in quest'ordine.** Prima risolvi il *tuo*
problema (Fase 1-2), usi il tool sul campo, scopri cosa serve davvero, e *poi* lo
trasformi in prodotto (Fase 4). Evita di costruire il "palazzo SaaS" prima delle
fondamenta.

---

## 10. Da uso personale a prodotto vendibile (SaaS)

- **Multi-tenant:** ogni label è un "inquilino" separato; vede solo i suoi dati.
- **Login e ruoli:** titolare label, collaboratore, artista (sola lettura).
- **Pricing possibile:** abbonamento mensile a scaglioni (es. base / pro), oppure
  in base al numero di release o di artisti gestiti.
- **Onboarding:** la prima esperienza è "carica il tuo CSV Bandcamp e guarda la
  magia" — deve funzionare in 2 minuti.

---

## 11. Mercato e concorrenti (onestà commerciale)

Non sei in un vuoto. Esistono già: **Curve Royalty Systems, Reprtoir, Label Engine,
Vampr, Labelcamp (Believe)**. Però sono spesso **cari, complessi e tarati su label
grandi**.

**Lo spazio reale per te:** un tool **moderno, semplice ed economico per label
indipendenti** (soprattutto elettroniche — il tuo mondo), che oggi usano fogli
Excel. Posizionamento difendibile: *"il gestionale royalty che un'etichetta
indipendente sa usare in 10 minuti, al prezzo di un caffè a settimana."*

---

## 12. Aspetti legali e privacy (da non sottovalutare se vendi)

- **GDPR:** gestisci dati personali (artisti) e dati finanziari → servono privacy
  policy, termini di servizio, e dati salvati in UE.
- **Dati finanziari:** sicurezza, backup, accessi protetti.
- **Termini delle API:** rispettare i termini di Bandcamp ecc. quando usi i loro
  dati per un prodotto a pagamento (da verificare prima del lancio commerciale).
- **Fatturazione:** se vendi abbonamenti, serve gestione fiscale (P.IVA, Stripe
  Billing, ecc.).

---

## 13. Rischi e come mitigarli

| Rischio | Mitigazione |
|---|---|
| Bandcamp non concede l'accesso API | Il CSV resta sempre disponibile come fallback |
| Formati CSV che cambiano | Mappatura flessibile e salvata per ogni fonte |
| Beatport/streaming senza API | Si lavora sui report del distributore (è la norma) |
| Troppa complessità subito | Si parte dall'MVP personale, non dal SaaS |
| Concorrenza affermata | Focus su semplicità + nicchia indie elettronica |

---

## 14. Decisioni ancora aperte (da concordare prima di costruire)

1. **Nome del prodotto** (per la versione vendibile).
2. **Primo distributore da supportare** oltre a Bandcamp (quale usi tu oggi?).
3. **Valuta principale** e se serve multi-valuta subito.
4. **Quali piattaforme** vendi davvero oggi (per dare priorità ai connettori).
5. Conferma stack: **Supabase** (consigliato) o tutto su **Vercel**.

---

## 15. Prossimo passo proposto

Approvato questo documento, il passo 1 è la **Fase 1 (MVP personale)**: un'app dove
carichi un CSV Bandcamp + un CSV del tuo distributore e vedi subito entrate, uscite
e margine per release. Da lì, tutto il resto si aggiunge sopra senza buttare lavoro.

> Per partire mi serve sapere: **quale distributore usi** e, se possibile, **un
> esempio di CSV** (anche con pochi dati finti) di Bandcamp e del distributore, così
> costruisco il motore di import sui formati reali.
