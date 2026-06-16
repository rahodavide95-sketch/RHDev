export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0';

// ISIN pattern: 2 letters + 10 alphanumeric
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/;

async function searchFinnhub(q, key) {
  const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${key}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d?.result || [])
    .filter(x => x.type !== 'ETP_NAV' && x.symbol)
    .slice(0, 10)
    .map(x => ({
      sym: x.displaySymbol || x.symbol,
      name: x.description || x.symbol,
      cat: x.type || '—',
      exch: '',
    }));
}

async function resolveISIN(isin) {
  // OpenFIGI: free, no key needed for basic use
  const r = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin, exchCode: '' }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const results = d?.[0]?.data;
  if (!results?.length) return null;
  // Prefer primary listing (US exchanges first, then others)
  const sorted = results.sort((a, b) => {
    const usExch = ['US', 'UN', 'UA', 'UR', 'UQ', 'UT'];
    const aUS = usExch.includes(a.exchCode) ? 0 : 1;
    const bUS = usExch.includes(b.exchCode) ? 0 : 1;
    return aUS - bUS;
  });
  const best = sorted[0];
  return {
    sym: best.ticker,
    name: best.name || best.ticker,
    cat: best.securityType || 'Azione',
    exch: best.exchCode || '',
  };
}

async function searchYahoo(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d?.quotes || [])
    .filter(x => x.symbol && x.quoteType !== 'OPTION' && x.quoteType !== 'MUTUALFUND')
    .slice(0, 8)
    .map(x => ({
      sym: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      cat: x.typeDisp || x.quoteType || '—',
      exch: x.exchDisp || x.exchange || '',
    }));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  if (!q) return new Response(JSON.stringify([]), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const key = process.env.FINNHUB_API_KEY;
  const isISIN = ISIN_RE.test(q.toUpperCase());

  try {
    if (isISIN) {
      // Resolve ISIN via OpenFIGI, then also search for confirmation
      const [figiResult, yahooResult] = await Promise.allSettled([
        resolveISIN(q.toUpperCase()),
        searchYahoo(q),
      ]);
      const results = [];
      if (figiResult.status === 'fulfilled' && figiResult.value) results.push(figiResult.value);
      if (yahooResult.status === 'fulfilled') {
        yahooResult.value.forEach(r => {
          if (!results.find(x => x.sym === r.sym)) results.push(r);
        });
      }
      return new Response(JSON.stringify(results.slice(0, 8)), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Normal search: Finnhub + Yahoo in parallel
    const [finnhubRes, yahooRes] = await Promise.allSettled([
      key ? searchFinnhub(q, key) : Promise.resolve([]),
      searchYahoo(q),
    ]);

    const finnhub = finnhubRes.status === 'fulfilled' ? finnhubRes.value : [];
    const yahoo = yahooRes.status === 'fulfilled' ? yahooRes.value : [];

    // Merge: Yahoo first (better names), then Finnhub extras
    const seen = new Set(yahoo.map(r => r.sym));
    const extras = finnhub.filter(r => !seen.has(r.sym));
    const merged = [...yahoo, ...extras].slice(0, 10);

    return new Response(JSON.stringify(merged), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
