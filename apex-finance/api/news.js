export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'no key' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${key}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const items = await r.json();

    // Return top 15, only headline + url + source + datetime
    const news = (Array.isArray(items) ? items : [])
      .slice(0, 15)
      .map(n => ({ headline: n.headline, url: n.url, source: n.source, datetime: n.datetime }));

    return new Response(JSON.stringify(news), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
