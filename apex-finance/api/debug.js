export const config = { runtime: 'edge', regions: ['iad1'] };

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
    // Try bypassing GDPR consent with cookie + US locale params
    const r = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'GUC=AQABCAFn; GUCS=AQABCAFn; A1=d=AQABBCFnX2UCEPi5; tbla_id=us',
      },
      signal: AbortSignal.timeout(15000),
    });
    results.pageStatus = r.status;

    const html = await r.text();
    results.htmlLength = html.length;

    const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    results.nextDataFound = !!match;
    results.htmlPreview = html.slice(0, 500);
    // Check for other data patterns
    results.hasReactData = html.includes('root.App.main');
    results.hasYfData = html.includes('QuoteSummaryStore');
    results.hasConsentPage = html.includes('consent') || html.includes('guce');
    const scriptMatches = [...html.matchAll(/<script[^>]+type="application\/json"[^>]*>/g)].map(m => m[0]);
    results.jsonScriptTags = scriptMatches.slice(0, 5);

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
