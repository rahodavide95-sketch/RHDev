export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function findDeep(obj, key, depth = 0) {
  if (depth > 8 || obj == null || typeof obj !== 'object') return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findDeep(v, key, depth + 1);
    if (found != null) return found;
  }
  return null;
}

export default async function handler(req) {
  const results = {};

  try {
    const r = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    results.pageStatus = r.status;

    const html = await r.text();
    results.htmlLength = html.length;

    const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    results.nextDataFound = !!match;

    if (match) {
      const nextData = JSON.parse(match[1]);
      const fd = findDeep(nextData, 'financialData');
      const ks = findDeep(nextData, 'defaultKeyStatistics');
      const sd = findDeep(nextData, 'summaryDetail');

      results.financialDataKeys = fd ? Object.keys(fd).slice(0, 15) : null;
      results.keyStatsKeys = ks ? Object.keys(ks).slice(0, 15) : null;
      results.summaryDetailKeys = sd ? Object.keys(sd).slice(0, 15) : null;

      results.sampleValues = {
        trailingPE: sd?.trailingPE ?? ks?.trailingPE,
        forwardPE: sd?.forwardPE ?? ks?.forwardPE,
        returnOnEquity: fd?.returnOnEquity,
        operatingMargins: fd?.operatingMargins,
        priceToBook: ks?.priceToBook,
        pegRatio: ks?.pegRatio,
      };
    }
  } catch(e) {
    results.error = e.message;
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
