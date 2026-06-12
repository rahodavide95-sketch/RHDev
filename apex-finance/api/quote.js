export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const type   = searchParams.get('type') || 'quote'; // 'quote' | 'summary'

  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t = encodeURIComponent(ticker.toUpperCase());
  const modules = 'financialData,defaultKeyStatistics,summaryDetail,recommendationTrend';

  const urls = type === 'summary'
    ? [
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}`,
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}`,
        `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${t}?modules=${modules}`,
        `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${t}?modules=${modules}`,
      ]
    : [
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${t}`,
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${t}`,
      ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    } catch { continue; }
  }

  return new Response(JSON.stringify({ error: 'unavailable' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
