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
      hue: 215,
      icon: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M10.5 18h3', 'M12 7.5l2.6 1.5v3L12 13.5 9.4 12V9z'],
      name: 'Crypto.com App',
      blurb: 'Acquisti, scambi, Earn e staking, carta Visa e cashback dell\'app.',
      account: 'Crypto.com App',
      native: true,
      types: ['cryptocom_app'],
      kinds: [{ type: 'cryptocom_app', label: 'Storico transazioni (CSV)' }],
      steps: [
        'Apri l\'app Crypto.com e vai in Contabilità → Cronologia transazioni.',
        'Scegli Esporta (CSV) e seleziona tutto il periodo, dall\'apertura del conto a oggi.',
        'L\'app crea due file per periodo: «contanti» (conto in euro) e «criptovaluta». Caricali entrambi: molte operazioni compaiono in tutti e due e vengono contate una volta sola; se ti chiede conferma su qualcuna, rispondi dopo aver guardato le date.',
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
      hue: 262,
      icon: ['M4 8h14', 'M15 4.5L18.5 8 15 11.5', 'M20 16H6', 'M9 12.5L5.5 16 9 19.5'],
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
      hue: 152,
      icon: ['M3.5 18.5l2-7.5h13l2 7.5z', 'M9 11l1-3.5h4l1 3.5', 'M8 15h8'],
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
      hue: 40,
      icon: ['M7 3.5v3', 'M7 17.5v3', 'M5 6.5h4v11H5z', 'M17 2.5v3', 'M17 15.5v4', 'M15 5.5h4v10h-4z'],
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
      hue: 196,
      icon: ['M3 9.5L12 4l9 5.5', 'M5.5 11v7', 'M10 11v7', 'M14 11v7', 'M18.5 11v7', 'M3.5 20.5h17'],
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
      hue: 18,
      icon: ['M4 7.5A1.5 1.5 0 0 1 5.5 6H17a1.5 1.5 0 0 1 1.5 1.5V9', 'M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5H19a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 19 8.5H5.5A1.5 1.5 0 0 1 4 7.5z', 'M16 14h2'],
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
