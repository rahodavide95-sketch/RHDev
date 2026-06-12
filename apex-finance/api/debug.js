export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker') || 'AAPL';
  const t = encodeURIComponent(ticker.toUpperCase());
  const modules = 'financialData,defaultKeyStatistics,summaryDetail,recommendationTrend';

  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${t}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${t}?range=1d&interval=1d`,
  ];

  const results = {};
  await Promise.all(urls.map(async url => {
    try {
      const r = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      results[url] = { status: r.status, ok: r.ok, bodyPreview: text.slice(0, 300) };
    } catch(e) {
      results[url] = { error: e.message };
    }
  }));

  return new Response(JSON.stringify(results, null, 2), { status: 200, headers: CORS });
}
