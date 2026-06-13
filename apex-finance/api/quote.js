export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function extractRaw(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k]?.raw != null) return obj[k].raw;
    if (obj?.[k] != null && typeof obj[k] === 'number') return obj[k];
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const sym = ticker.toUpperCase();

  try {
    // Fetch Yahoo Finance quote page — contains __NEXT_DATA__ with all financials
    const r = await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const html = await r.text();

    // Extract __NEXT_DATA__ JSON
    const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('__NEXT_DATA__ not found');

    const nextData = JSON.parse(match[1]);

    // Navigate to financial data — structure varies by Yahoo Finance version
    const stores = nextData?.props?.pageProps?.financialData
      || nextData?.props?.initialState
      || nextData?.props?.pageProps?.stores;

    // Try multiple paths in the Next.js data
    const quoteType = findDeep(nextData, 'quoteType');
    const financialData = findDeep(nextData, 'financialData');
    const keyStats = findDeep(nextData, 'defaultKeyStatistics');
    const summaryDetail = findDeep(nextData, 'summaryDetail');
    const recTrend = findDeep(nextData, 'recommendationTrend');

    const fd = financialData || {};
    const ks = keyStats || {};
    const sd = summaryDetail || {};
    const rt = (recTrend?.trend || [])[0] || {};

    const result = {
      quoteSummary: {
        result: [{
          financialData: fd,
          defaultKeyStatistics: ks,
          summaryDetail: sd,
          recommendationTrend: recTrend || {},
        }],
        error: null,
      }
    };

    // Verify we have at least some data
    const pe = extractRaw(sd, 'trailingPE') ?? extractRaw(ks, 'trailingPE') ?? extractRaw(fd, 'trailingPE');
    const roe = extractRaw(fd, 'returnOnEquity');
    const margin = extractRaw(fd, 'operatingMargins');

    if (pe == null && roe == null && margin == null) {
      throw new Error('no financial data extracted');
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

// Recursively find first object that has a given key
function findDeep(obj, key, depth = 0) {
  if (depth > 8 || obj == null || typeof obj !== 'object') return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findDeep(v, key, depth + 1);
    if (found != null) return found;
  }
  return null;
}
