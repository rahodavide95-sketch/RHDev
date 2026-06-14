export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RSS_FEEDS = [
  { url: 'https://www.ilsole24ore.com/rss/finanza-e-mercati.xml', source: 'Il Sole 24 Ore' },
  { url: 'https://www.ilsole24ore.com/rss/economia.xml', source: 'Il Sole 24 Ore' },
  { url: 'https://www.borsaitaliana.it/notizie/rss.xml', source: 'Borsa Italiana' },
];

function parseRSS(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(item) || /<title>([\s\S]*?)<\/title>/.exec(item) || [])[1]?.trim();
    const link = (/<link>([\s\S]*?)<\/link>/.exec(item) || [])[1]?.trim();
    const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(item) || [])[1]?.trim();
    if (title) {
      items.push({
        headline: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#039;/g,"'").replace(/&quot;/g,'"'),
        url: link || '#',
        source,
        datetime: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000),
      });
    }
  }
  return items;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`${source} HTTP ${r.status}`);
      const xml = await r.text();
      return parseRSS(xml, source);
    })
  );

  const allNews = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 20);

  if (!allNews.length) {
    return new Response(JSON.stringify({ error: 'nessuna notizia disponibile' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(allNews), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
  });
}
