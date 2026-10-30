/* Loghi delle banche e dei broker: le icone ufficiali dei loro siti, salvate nell'app
   (icons/banks/<slug>.png). L'app non chiede mai nulla ai siti delle banche: nessuno sa quali usi.
   Il logo si sceglie dal nome del conto o dall'istituto. */
export const BANKS = [
  // [slug, dominio, espressione sul nome]
  ['traderepublic', 'traderepublic.com', /trade ?republic/],
  ['scalable', 'scalable.capital', /scalable/],
  ['fineco', 'finecobank.com', /fineco/],
  ['intesa', 'intesasanpaolo.com', /intesa|sanpaolo/],
  ['isybank', 'isybank.com', /isybank|isy bank/],
  ['unicredit', 'unicredit.it', /unicredit/],
  ['buddybank', 'buddybank.com', /buddy ?bank/],
  ['bper', 'bper.it', /\bbper\b/],
  ['bancobpm', 'bancobpm.it', /banco ?bpm|\bbpm\b/],
  ['webank', 'webank.it', /webank/],
  ['mediolanum', 'bancamediolanum.it', /mediolanum/],
  ['ing', 'ing.it', /\bing\b|conto arancio/],
  ['bbva', 'bbva.it', /\bbbva\b/],
  ['n26', 'n26.com', /\bn26\b/],
  ['revolut', 'revolut.com', /revolut/],
  ['hype', 'hype.it', /\bhype\b/],
  ['paypal', 'paypal.com', /paypal/],
  ['poste', 'poste.it', /poste|bancoposta|postepay|libretto postale|buono fruttifero/],
  ['satispay', 'satispay.com', /satispay/],
  ['credem', 'credem.it', /credem/],
  ['mps', 'mps.it', /\bmps\b|monte dei paschi/],
  ['creditagricole', 'credit-agricole.it', /cr[eé]dit agricole/],
  ['widiba', 'widiba.it', /widiba/],
  ['illimity', 'illimity.com', /illimity/],
  ['bancaifis', 'bancaifis.it', /ifis|rendimax/],
  ['directa', 'directa.it', /directa/],
  ['degiro', 'degiro.it', /degiro/],
  ['mediobanca', 'mediobancapremier.com', /mediobanca|che ?banca/],
  ['sella', 'sella.it', /\bsella\b/],
  ['bnl', 'bnl.it', /\bbnl\b/],
  ['deutschebank', 'deutsche-bank.it', /deutsche bank/],
  ['popso', 'popso.it', /popolare di sondrio|\bpopso\b/],
  ['allianzbank', 'allianzbank.it', /allianz bank/],
  ['bancagenerali', 'bancagenerali.com', /banca generali/],
  ['fideuram', 'fideuram.it', /fideuram/],
  ['amex', 'americanexpress.com', /american express|\bamex\b/],
  ['nexi', 'nexi.it', /\bnexi\b/],
  ['moneyfarm', 'moneyfarm.com', /moneyfarm/],
  ['ibkr', 'interactivebrokers.com', /interactive brokers|\bibkr\b/],
  ['etoro', 'etoro.com', /etoro/],
  ['xtb', 'xtb.com', /\bxtb\b/],
  ['lightyear', 'lightyear.com', /lightyear/],
  ['wise', 'wise.com', /\bwise\b|transferwise/],
  ['bunq', 'bunq.com', /\bbunq\b/],
  ['binance', 'binance.com', /binance/],
  ['coinbase', 'coinbase.com', /coinbase/],
  ['youngplatform', 'youngplatform.com', /young ?platform/],
  ['bitpanda', 'bitpanda.com', /bitpanda/],
  ['kraken', 'kraken.com', /kraken/],
  ['cryptocom', 'crypto.com', /crypto\.com/],
];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Logo per un conto (dal nome o dall'istituto), o null. */
export function bankLogo(...names) {
  const t = names.map(norm).join(' ');
  if (!t.trim()) return null;
  const b = BANKS.find(([, , re]) => re.test(t));
  return b && LOGOS.has(b[0]) ? `icons/banks/${b[0]}.png` : null;
}

/* loghi davvero presenti nella cartella (riempito da tools/fetch-logos.py) */
export const LOGOS = new Set(['traderepublic', 'scalable', 'fineco', 'isybank', 'unicredit', 'buddybank', 'bper', 'bancobpm', 'mediolanum', 'ing', 'bbva', 'n26', 'revolut', 'hype', 'paypal', 'poste', 'satispay', 'credem', 'mps', 'creditagricole', 'widiba', 'illimity', 'bancaifis', 'directa', 'degiro', 'mediobanca', 'popso', 'allianzbank', 'bancagenerali', 'amex', 'nexi', 'moneyfarm', 'ibkr', 'etoro', 'xtb', 'lightyear', 'wise', 'bunq', 'binance', 'coinbase', 'youngplatform', 'bitpanda', 'kraken', 'cryptocom']);
