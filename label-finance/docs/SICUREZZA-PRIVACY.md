# Sicurezza e Privacy dei Dati
### Documento di progetto — allegato a PROGETTO.md (17 giugno 2026)

> Scritto per essere capito **anche da chi non è tecnico**. Tratta come
> proteggere i dati e come essere a norma di legge (GDPR), prima per la tua
> label e poi quando vendi il prodotto ad altri.

---

## 1. Perché è un tema serio (non rimandabile)

Il gestionale conserva tre tipi di dati delicati:

| Tipo di dato | Esempi | Perché è sensibile |
|---|---|---|
| **Dati finanziari** | vendite, incassi, royalty, conti | Riservati; un leak è un danno economico/reputazionale |
| **Dati personali** | nome artista, email, IBAN, codice fiscale | Protetti dal GDPR; richiedono regole precise |
| **Credenziali tecniche** | token API Bandcamp/Stripe/PayPal | Se rubati, danno accesso ai conti collegati |

Sbagliare qui non è come un bug grafico: può significare una **multa GDPR**, la
**perdita di fiducia** dei clienti e, nel peggiore dei casi, soldi rubati.

---

## 2. La buona notizia: gran parte è già risolta dai fornitori

Scegliendo lo stack consigliato (**Supabase + Vercel + Stripe**), molte protezioni
arrivano "incluse" e non devi costruirle tu:

- **Crittografia in transito** (HTTPS/TLS) → i dati viaggiano cifrati. Inclusa.
- **Crittografia a riposo** (database cifrato sul disco) → inclusa in Supabase.
- **Pagamenti a norma** (PCI-DSS) → li gestisce **Stripe**: tu **non tocchi mai**
  i numeri di carta. Inclusa.
- **Backup automatici** e infrastruttura in **data center UE**. Inclusi.

Quindi il tuo lavoro vero si concentra su **4 cose** (sezione 3) + i **documenti
legali** (sezione 5).

---

## 3. Le 4 cose di cui ci occupiamo NOI (le più importanti)

### 3.1 Isolamento tra clienti (il rischio n°1 di un SaaS)
Quando più label usano lo stesso sistema, il pericolo maggiore è che **una label
veda i dati di un'altra**. Si previene con una tecnica del database chiamata
**Row Level Security (RLS)**: ogni riga di dati è "marchiata" col proprietario, e
il database **rifiuta** di mostrarla a chiunque altro — anche se ci fosse un bug
nell'app. Supabase lo supporta nativamente. È la prima cosa da configurare bene.

### 3.2 Cifratura dei segreti delle API
I token di Bandcamp/Stripe/PayPal **non** vanno salvati "in chiaro" nel database.
Vanno **cifrati a livello applicativo** (una seconda serratura oltre a quella del
database), con accesso al minimo necessario (solo i permessi che servono, es. sola
lettura delle vendite) e possibilità di **revoca/rotazione** se qualcosa va storto.

### 3.3 Accesso sicuro (login)
- Password salvate **solo cifrate** con algoritmi moderni (bcrypt/argon2), mai in
  chiaro. Gestito da Supabase Auth.
- **Autenticazione a due fattori (2FA)** almeno per gli account amministratore.
- Protezione contro tentativi a forza bruta (rate limiting, blocco dopo N errori).

### 3.4 Minimo privilegio + tracciabilità
- Ruoli chiari: titolare label, collaboratore, **artista (sola lettura** dei propri
  guadagni). Ognuno vede solo ciò che gli serve.
- **Audit log**: registrare chi ha visto/modificato cosa e quando. Utile per fiducia
  e per indagare eventuali problemi.

---

## 4. GDPR: i ruoli cambiano quando vendi

Questo è il punto che molti dimenticano:

- **Finché lo usi solo per la tua label** → sei **Titolare del trattamento** dei
  tuoi dati. Obblighi limitati.
- **Quando lo vendi ad altre label** → per i *loro* dati diventi **Responsabile del
  trattamento (Data Processor)**. Questo comporta obblighi specifici, in particolare
  un **DPA** (Data Processing Agreement / Accordo art. 28 GDPR) da firmare con ogni
  cliente.

### Cosa serve a norma GDPR
| Adempimento | Cosa significa |
|---|---|
| **Privacy Policy** | Spiega quali dati raccogli e perché |
| **Termini di Servizio** | Regole d'uso del prodotto |
| **DPA (art. 28)** | Contratto col cliente-label sul trattamento dei suoi dati |
| **Dati in UE** | Server/data center in Unione Europea (Supabase/Vercel EU) |
| **Diritti degli utenti** | Poter esportare e **cancellare** i dati su richiesta |
| **Registro dei trattamenti** | Documento interno che elenca cosa tratti |
| **Notifica data breach** | In caso di violazione, avvisare il Garante **entro 72 ore** |
| **Minimizzazione** | Raccogliere solo i dati che servono davvero |

> Per la parte legale (Privacy Policy, ToS, DPA) conviene un **template
> professionale o un consulente**: sono documenti standard, non serve reinventarli,
> ma è bene che siano corretti prima del lancio commerciale.

---

## 5. Sicurezza operativa (le buone abitudini)

Anche con ottimi strumenti, i guai spesso entrano dalla porta di servizio:

- **2FA attiva** sui tuoi account chiave: GitHub, Vercel, Supabase, Stripe.
- **Dipendenze aggiornate**: aggiornare le librerie per chiudere falle note.
- **Niente segreti nel codice**: token e password vanno in variabili d'ambiente
  protette, **mai** scritti nei file salvati su GitHub.
- **Backup testati**: avere backup è inutile se non si è mai provato a ripristinarli.
- **Piano incidenti**: sapere in anticipo cosa fare se qualcosa va storto.

---

## 6. Cosa NON fare (errori comuni e costosi)

- ❌ Salvare numeri di **carta di credito** → mai; usa Stripe.
- ❌ Salvare token API o IBAN **in chiaro** nel database.
- ❌ Affidare l'isolamento tra clienti **solo al codice dell'app** → serve RLS nel
  database come rete di sicurezza.
- ❌ Mettere chiavi/segreti **dentro al codice** caricato su GitHub.
- ❌ Lanciare a pagamento **senza** Privacy Policy, ToS e DPA.
- ❌ Raccogliere dati personali "perché magari servono" (viola la minimizzazione).

---

## 7. Livello di sforzo per fase (non serve tutto subito)

| Fase | Sicurezza/Privacy necessaria |
|---|---|
| **MVP personale** (solo tu) | Login sicuro, HTTPS, backup, segreti fuori dal codice. Leggero. |
| **+ Connettori API** | Cifratura dei token, permessi minimi, possibilità di revoca. |
| **+ Royalty/IBAN artisti** | Cifratura dati personali, informativa agli artisti, ruoli/permessi. |
| **SaaS multi-label** | RLS rigoroso, DPA, Privacy Policy, ToS, audit log, 2FA obbligatoria admin, piano data breach. |

**Conclusione:** all'inizio (uso personale) il carico è leggero. Il grosso degli
adempimenti scatta **quando vendi ad altri** — ed è lì che vanno fatti per bene.
Il design del database (RLS, cifratura segreti) va però **previsto fin da subito**,
perché rifarlo dopo è costoso.

---

## 8. Checklist sintetica

**Tecnica**
- [ ] HTTPS ovunque · [ ] DB cifrato a riposo · [ ] RLS multi-tenant
- [ ] Token API e IBAN cifrati a livello app · [ ] permessi API minimi + revoca
- [ ] Password con hashing moderno · [ ] 2FA admin · [ ] rate limiting
- [ ] Audit log · [ ] backup automatici **testati** · [ ] segreti in env, non nel codice
- [ ] dipendenze aggiornate · [ ] pagamenti via Stripe (no carte salvate)

**Legale/GDPR (prima della vendita)**
- [ ] dati in UE · [ ] Privacy Policy · [ ] Termini di Servizio · [ ] DPA art. 28
- [ ] registro trattamenti · [ ] export+cancellazione dati su richiesta
- [ ] procedura notifica breach 72h
