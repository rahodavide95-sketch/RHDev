export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker   = searchParams.get('ticker');
  const range    = searchParams.get('range')    || '2y';
  const interval = searchParams.get('interval') || '1d';

  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t = encodeURIComponent(ticker.toUpperCase());
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${t}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(12000),
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
