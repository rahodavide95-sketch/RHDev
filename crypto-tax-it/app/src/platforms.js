/* Catalogo delle piattaforme: cosa si puo' aggiungere (file / API), come si ottiene e cosa non e' gestito.
   Le istruzioni sui menu delle piattaforme sono indicative: i nomi possono cambiare. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});

  const API_PLANNED = (name) => ({
    status: 'planned',
    text: `Per ora ${name} si aggiunge con i file. Il collegamento diretto richiede una chiave in sola lettura creata nella piattaforma e una verifica con un account reale, che non è ancora stata fatta. Finché non è provato non lo attivo: uno storico incompleto darebbe tasse sbagliate.`,
    points: [
      'La chiave dovrà essere di sola lettura, senza permesso di prelievo né di trading.',
      'Le piattaforme di solito limitano quanto indietro si può leggere via API: per la dichiarazione il file con lo storico completo resta la via più sicura.',
      'Quando sarà attivo, la chiave resterà nel tuo browser e verrà inviata solo alla piattaforma.',
    ],
  });

  const API_CONNECTOR = (name, connector) => ({
    status: 'experimental',
    connector,
    text: `Il collegamento diretto a ${name} scarica lo storico con una chiave di sola lettura. È sperimentale: costruito sulla documentazione ufficiale e provato solo su risposte simulate, non ancora con un account reale.`,
    points: [
      'La chiave dovrà essere di sola lettura, senza permesso di prelievo né di trading.',
      'Le piattaforme di solito limitano quanto indietro si può leggere via API: per la dichiarazione il file con lo storico completo resta la via più sicura.',
    ],
  });

  const UNIVERSAL_STEPS = [
    'Scarica il modello universale (pulsante qui sotto): è un file CSV con le colonne già pronte e qualche riga di esempio.',
    'Compila una riga per ogni operazione: data, tipo (acquisto, vendita, scambio, provento, trasferimento…), asset, quantità e valore in euro.',
    'Trascina qui il file compilato.',
  ];

  const PLATFORMS = {
    cryptocom_app: {
      name: 'Crypto.com App',
      blurb: 'Acquisti, scambi, Earn e staking, carta Visa e cashback dell\'app.',
      account: 'Crypto.com App',
      native: true,
      types: ['cryptocom_app'],
      kinds: [{ type: 'cryptocom_app', label: 'Storico transazioni (CSV)' }],
      steps: [
        'Apri l\'app Crypto.com e vai in Contabilità → Cronologia transazioni.',
        'Scegli Esporta (CSV) e seleziona tutto il periodo, dall\'apertura del conto a oggi.',
        'Se l\'app ti fa scegliere un intervallo, fai più esportazioni e carica tutti i file: le righe presenti in più file vengono contate una volta sola.',
        'Trascina qui i file scaricati.',
      ],
      limits: [
        'I trasferimenti tra App ed Exchange vengono abbinati se aggiungi anche l\'Exchange.',
        'Non sono gestiti DeFi Wallet, derivati e prodotti che non compaiono nell\'export: le righe sconosciute vengono segnalate.',
      ],
      api: { status: 'none', text: 'L\'App di Crypto.com non offre un\'API pubblica per scaricare lo storico: l\'unica via è il file.', points: [] },
    },
    cryptocom_exchange: {
      name: 'Crypto.com Exchange',
      blurb: 'Trading spot, depositi e prelievi sull\'Exchange.',
      account: 'Crypto.com Exchange',
      native: true,
      types: ['cryptocom_exchange_trades', 'cryptocom_exchange_transfers'],
      kinds: [
        { type: 'cryptocom_exchange_trades', label: 'Operazioni di trading (SPOT_TRADE.csv)' },
        { type: 'cryptocom_exchange_transfers', label: 'Depositi e prelievi' },
      ],
      steps: [
        'Accedi all\'Exchange e apri Ordini → Cronologia ordini (Spot).',
        'Premi Esporta cronologia, scegli «Spot Wallet - Order History» e il periodo, poi esporta in CSV: ricevi uno .zip.',
        'Trascina qui lo .zip così com\'è: il programma usa solo il file delle operazioni (SPOT_TRADE.csv) e ignora gli altri.',
        'Poi scarica anche lo storico di depositi e prelievi (Portafoglio → Cronologia) e caricalo: serve ad abbinare i trasferimenti con l\'App.',
      ],
      zipPolicy: (name) => /trade/i.test(name),
      limits: [
        'Margine, futures e altri derivati non sono gestiti: le righe vengono segnalate.',
        'Senza il file di depositi e prelievi i trasferimenti verso altri conti non vengono riconosciuti.',
      ],
      api: API_CONNECTOR('Crypto.com Exchange', 'cryptocom_exchange'),
    },
    bitpanda: {
      name: 'Bitpanda',
      blurb: 'Cripto, oro e altri metalli preziosi. Azioni ed ETF non ancora calcolati.',
      account: 'Bitpanda',
      native: true,
      types: ['bitpanda'],
      kinds: [{ type: 'bitpanda', label: 'Storico transazioni (CSV)' }],
      steps: [
        'Accedi a Bitpanda (sito o app) e apri il profilo → Cronologia transazioni.',
        'Scarica lo storico completo in CSV, non solo l\'anno in corso: serve per calcolare il costo di acquisto.',
        'Trascina qui il file: le righe di testo all\'inizio vengono ignorate da sole.',
      ],
      limits: [
        'Azioni ed ETF acquistati su Bitpanda non sono ancora calcolati: vengono segnalati e ignorati.',
        'L\'oro è trattato come metallo prezioso (art. 67, c. 1, lett. c-ter): la qualificazione va confermata con il commercialista.',
      ],
      api: API_CONNECTOR('Bitpanda', 'bitpanda'),
    },
    binance: {
      name: 'Binance',
      blurb: 'Spot, convert, Earn e altri prodotti Binance.',
      account: 'Binance',
      native: false,
      types: ['generic'],
      kinds: [{ type: 'generic', label: 'Modello universale compilato' }],
      steps: [
        'Il formato nativo dei file Binance non è ancora validato, quindi per ora si usa il modello universale.',
        ...UNIVERSAL_STEPS,
        'Se vuoi caricare direttamente l\'export di Binance (Ordini → Cronologia transazioni): provalo qui. Se non viene riconosciuto premi «Copia diagnostica» e mandala a chi sviluppa l\'app: il formato verrà aggiunto.',
      ],
      limits: ['Il formato nativo di Binance non è ancora supportato.'],
      api: API_CONNECTOR('Binance', 'binance'),
    },
    coinbase: {
      name: 'Coinbase',
      blurb: 'Acquisti, vendite, convert e rendite su Coinbase.',
      account: 'Coinbase',
      native: false,
      types: ['generic'],
      kinds: [{ type: 'generic', label: 'Modello universale compilato' }],
      steps: [
        'Il formato nativo dei file Coinbase non è ancora validato, quindi per ora si usa il modello universale.',
        ...UNIVERSAL_STEPS,
        'Se vuoi caricare direttamente l\'export di Coinbase (Rapporti → Cronologia transazioni): provalo qui. Se non viene riconosciuto premi «Copia diagnostica» e mandala a chi sviluppa l\'app: il formato verrà aggiunto.',
      ],
      limits: ['Il formato nativo di Coinbase non è ancora supportato.'],
      api: API_PLANNED('Coinbase'),
    },
    other: {
      name: 'Altra piattaforma o wallet personale',
      blurb: 'Qualsiasi altra piattaforma, wallet personali o operazioni che mancano nei file.',
      account: '',
      native: false,
      types: ['generic'],
      kinds: [{ type: 'generic', label: 'Modello universale compilato' }],
      steps: UNIVERSAL_STEPS,
      limits: ['Il programma non può dedurre nulla: vale solo ciò che inserisci.'],
      api: { status: 'none', text: 'Per i wallet personali e le piattaforme non elencate si usa il modello universale o l\'inserimento a mano.', points: [] },
      manual: true,
    },
  };

  const TYPE_TO_PLATFORM = { cryptocom_app: 'cryptocom_app', cryptocom_exchange_trades: 'cryptocom_exchange', cryptocom_exchange_transfers: 'cryptocom_exchange', bitpanda: 'bitpanda', generic: 'other' };
  CT.PLATFORMS = PLATFORMS;
  CT.platformOfType = (t) => {
    if (TYPE_TO_PLATFORM[t]) return TYPE_TO_PLATFORM[t];
    if (typeof t === 'string' && t.startsWith('api_')) { const c = CT.api && CT.api[t.slice(4)]; return c ? c.platform : null; }
    return null;
  };
  if (typeof module !== 'undefined') module.exports = { PLATFORMS };
})();
