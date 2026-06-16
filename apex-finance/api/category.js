export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUFFIX = { US: '', MI: '.MI', DE: '.DE', L: '.L', PA: '.PA', SW: '.SW', AS: '.AS', MC: '.MC', ST: '.ST' };

async function exchangeSymbols(code, key) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/symbol?exchange=${code}&token=${key}`, { signal: AbortSignal.timeout(14000) });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function cryptoSymbols(key) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/crypto/symbol?exchange=BINANCE&token=${key}`, { signal: AbortSignal.timeout(14000) });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

// keyword per distinguere ETF obbligazionari da azionari
const BOND_RE = /\b(bond|treasury|govt|government|gilt|bund|btp|oat|corporate|aggregate|fixed income|duration|maturity|yield|credit|tips|inflation.?linked|money market|ultrashort|short.?term|floating rate|muni|municipal|sukuk|obblig)\b/i;

function mapSym(x, exch) {
  let sym = x.symbol;
  if (exch !== 'US') {
    const base = (x.symbol.split('.')[0]) || x.symbol;
    sym = base + (SUFFIX[exch] || '');
  }
  return { sym, name: x.description || x.symbol };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'stocks';
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'no key' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // borse principali su cui aggregare ETF e azioni
  const STOCK_EXCH = ['US', 'MI', 'DE', 'L', 'PA', 'SW', 'AS', 'MC', 'ST'];

  try {
    let out = [];

    if (type === 'crypto') {
      const list = await cryptoSymbols(key);
      out = list.map(x => {
        // BINANCE:BTCUSDT → BTC-USD (compatibile Yahoo)
        const ds = (x.displaySymbol || x.symbol || '').replace('BINANCE:', '');
        const base = ds.replace(/USDT$|USD$|BUSD$/i, '');
        return { sym: base + '-USD', name: (x.description || base) };
      }).filter(x => x.sym && x.sym !== '-USD');

    } else if (type === 'stocks') {
      const all = await Promise.all(STOCK_EXCH.map(e => exchangeSymbols(e, key).then(list =>
        list.filter(x => x.type === 'Common Stock' || x.type === '').map(x => mapSym(x, e)))));
      out = all.flat();

    } else if (type === 'etf-equity' || type === 'etf-bond') {
      const wantBond = type === 'etf-bond';
      const all = await Promise.all(STOCK_EXCH.map(e => exchangeSymbols(e, key).then(list =>
        list.filter(x => x.type === 'ETP' || /ETF/i.test(x.type || '')).map(x => mapSym(x, e)))));
      out = all.flat().filter(x => BOND_RE.test(x.name) === wantBond);

    } else {
      return new Response(JSON.stringify({ error: 'type non valido' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // dedup + sort
    const seen = new Set();
    out = out.filter(x => { if (!x.sym || seen.has(x.sym)) return false; seen.add(x.sym); return true; })
      .sort((a, b) => a.sym.localeCompare(b.sym));

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
