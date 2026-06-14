export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function translate(text) {
  try {
    const r = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|it`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!r.ok) return text;
    const d = await r.json();
    const t = d?.responseData?.translatedText;
    return (t && d?.responseStatus === 200) ? t : text;
  } catch { return text; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: 'no key' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const items = await r.json();

    const top = (Array.isArray(items) ? items : []).slice(0, 10);

    // Translate all headlines in parallel with global timeout
    const translateAll = Promise.all(
      top.map(async n => ({
        headline: await translate(n.headline || ''),
        url: n.url,
        source: n.source,
        datetime: n.datetime,
      }))
    );
    const timeout = new Promise(res => setTimeout(() => res(
      top.map(n => ({ headline: n.headline, url: n.url, source: n.source, datetime: n.datetime }))
    ), 12000));
    const translated = await Promise.race([translateAll, timeout]);

    return new Response(JSON.stringify(translated), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
