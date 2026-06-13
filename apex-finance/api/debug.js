export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async function handler(req) {
  const results = {};

  // Test A: get cookies from v8/chart itself, then use for crumb
  try {
    const r1 = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const rawCookie = r1.headers.get('set-cookie') || '';
    const cookieParts = rawCookie.split(',').map(c => c.trim().split(';')[0]).filter(Boolean).join('; ');
    const data = await r1.json();
    const meta = data?.chart?.result?.[0]?.meta || {};

    results.v8CookiePreview = cookieParts.slice(0, 150);
    results.v8MetaKeys = Object.keys(meta);
    results.v8MetaFinancials = {
      trailingPE: meta.trailingPE,
      forwardPE: meta.forwardPE,
      marketCap: meta.marketCap,
      priceToBook: meta.priceToBook,
      pegRatio: meta.pegRatio,
      '52WeekHigh': meta['52WeekHigh'],
      '52WeekLow': meta['52WeekLow'],
    };

    // Now try crumb with v8/chart cookie
    if (cookieParts) {
      const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, 'Cookie': cookieParts, 'Accept': '*/*' },
        signal: AbortSignal.timeout(8000),
      });
      const crumbText = await r2.text();
      results.crumbWithV8Cookie_status = r2.status;
      results.crumbWithV8Cookie = crumbText.slice(0, 60);

      if (r2.ok && !crumbText.includes('<') && crumbText.length < 20) {
        const crumb = encodeURIComponent(crumbText.trim());
        const r3 = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=financialData,defaultKeyStatistics&crumb=${crumb}`, {
          headers: { 'User-Agent': UA, 'Cookie': cookieParts, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        const body = await r3.text();
        results.quoteSummaryWithV8Cookie_status = r3.status;
        results.quoteSummaryWithV8Cookie_preview = body.slice(0, 300);
      }
    }
  } catch(e) { results.v8Error = e.message; }

  // Test B: query2 chart cookies
  try {
    const r = await fetch('https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const rawCookie = r.headers.get('set-cookie') || '';
    const cookieParts = rawCookie.split(',').map(c => c.trim().split(';')[0]).filter(Boolean).join('; ');
    results.query2CookiePreview = cookieParts.slice(0, 150);
  } catch(e) { results.query2Error = e.message; }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
