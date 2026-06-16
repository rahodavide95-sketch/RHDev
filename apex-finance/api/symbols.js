export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Finnhub exchange codes
const EXCH = {
  US: 'US',   // NYSE + Nasdaq
  MI: 'MI',   // Borsa Italiana (Milano)
  DE: 'DE',   // Xetra / Frankfurt
  L:  'L',    // London Stock Exchange
  PA: 'PA',   // Euronext Paris
};

// Yahoo suffix per exchange (per rendere i ticker analizzabili)
const SUFFIX = { US: '', MI: '.MI', DE: '.DE', L: '.L', PA: '.PA' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const exch = searchParams.get('exchange') || 'US';
  const code = EXCH[exch];
  if (!code) return new Response(JSON.stringify({ error: 'exchange non valido' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'no key' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/symbol?exchange=${code}&token=${key}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const items = await r.json();
    const suffix = SUFFIX[exch];

    const list = (Array.isArray(items) ? items : [])
      .filter(x => x.symbol && (x.type === 'Common Stock' || x.type === 'ETP' || x.type === '' || !x.type))
      .map(x => {
        // Per US il symbol Finnhub è già il ticker Yahoo. Per altre borse aggiunge il suffisso.
        let sym = x.symbol;
        if (exch !== 'US') {
          const base = (x.symbol.split('.')[0]) || x.symbol;
          sym = base + suffix;
        }
        return { sym, name: x.description || x.symbol };
      })
      // dedup
      .filter((x, i, arr) => arr.findIndex(y => y.sym === x.sym) === i)
      .sort((a, b) => a.sym.localeCompare(b.sym));

    return new Response(JSON.stringify(list), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
