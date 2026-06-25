# Attivare i pagamenti (Stripe) — guida click-by-click

> Seguiamo questi passi **uno alla volta**. Tu fai i click nei pannelli web;
> il codice è già pronto nel progetto. Useremo prima la **modalità Test** di
> Stripe (soldi finti) e solo alla fine passeremo a quella reale.

Il codice già pronto in questo repo:
- `supabase/subscriptions.sql` — la tabella del piano di ogni utente
- `supabase/functions/create-checkout/` — apre la pagina di pagamento
- `supabase/functions/stripe-webhook/` — riceve la conferma e attiva il piano
- `supabase/functions/create-portal/` — il cliente gestisce/disdice l'abbonamento

---

## Passo 1 — Crea l'account Stripe
1. Vai su **https://stripe.com** → **Sign up**. Usa la tua email.
2. Conferma l'email e accedi alla **Dashboard**.
3. In alto a destra controlla che l'interruttore sia su **Test mode** (Modalità test) — attivo.
4. (Per ora basta così. La verifica dell'attività/IBAN serve solo quando vorrai incassare davvero.)

## Passo 2 — Crea i 3 prodotti (i piani)
Dashboard Stripe → **Catalog / Prodotti** → **+ Add product**. Creane 3:
- **Big Label** → prezzo **69 €**, ricorrente **mensile** → Save.
- **Company** → prezzo **150 €**, ricorrente **mensile** → Save.
- **Enterprise** → (saltalo per ora, lo aggiungi quando apri quel piano).

Per ogni prodotto creato, apri il prezzo e **copia il Price ID** (inizia con
`price_...`). Mandami questi ID, oppure annotali: ci servono al Passo 4.

## Passo 3 — Crea la tabella nel database
1. Apri la Dashboard **Supabase** → il tuo progetto → **SQL Editor** → **New query**.
2. Apri il file `supabase/subscriptions.sql`, copia **tutto** il contenuto, incollalo e premi **Run**.
3. Deve dire "Success". (Hai creato la tabella che tiene il piano di ogni cliente.)

## Passo 4 — Imposta le "chiavi segrete" su Supabase
Servono perché le funzioni parlino con Stripe. In Supabase:
**Project Settings → Edge Functions → Secrets** (o **Edge Functions → Secrets**),
aggiungi queste voci (nome = valore):
- `STRIPE_SECRET_KEY` = la tua *Secret key* di Stripe (Dashboard Stripe → Developers → API keys → **sk_test_...**)
- `STRIPE_PRICE_BIGLABEL` = il Price ID di Big Label (`price_...`)
- `STRIPE_PRICE_STUDIO` = il Price ID di Company (`price_...`)
- `STRIPE_PRICE_AGENCY` = (opzionale, per Enterprise)
- `APP_URL` = l'indirizzo dell'app (per ora il tuo link GitHub Pages; poi il dominio)

## Passo 5 — Pubblica le 3 funzioni
Le funzioni stanno in `supabase/functions/`. Si pubblicano con un comando, ma
**lo posso preparare io**: ti dirò esattamente cosa lanciare (o le incolliamo
dall'editor di funzioni nel pannello Supabase). Risultato: 3 funzioni online
(`create-checkout`, `stripe-webhook`, `create-portal`).

## Passo 6 — Collega il webhook di Stripe
1. Dashboard Stripe → **Developers → Webhooks → + Add endpoint**.
2. URL endpoint: `https://<tuo-progetto>.supabase.co/functions/v1/stripe-webhook`
3. Eventi da ascoltare: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
4. Salva, poi **copia il "Signing secret"** (`whsec_...`) e aggiungilo ai Secrets
   di Supabase come `STRIPE_WEBHOOK_SECRET`.

## Passo 7 — Collego i pulsanti nell'app (lo faccio io)
Quando il backend è pronto, modifico io l'app: i pulsanti "Abbonati" dei piani
apriranno la pagina Stripe, e il piano verrà letto dalla tabella `subscriptions`
(non più scelto dall'utente). Aggiungo anche un pulsante "Gestisci abbonamento".

## Passo 8 — Prova con una carta di test
Stripe fornisce la carta di prova **4242 4242 4242 4242**, data futura, CVC
qualsiasi. Fai un acquisto finto: il piano deve attivarsi da solo nell'app.

## Passo 9 — Vai in modalità reale (live)
Quando tutto funziona in test: completa la verifica attività su Stripe, rifai i
prodotti in **Live mode**, sostituisci le chiavi `sk_test_`→`sk_live_` e il
Price/webhook con quelli live. Fine: incassi davvero.
