export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async function handler(req) {
  const results = {};

  // Test 1: finance.yahoo.com cookie + crumb flow
  try {
    const r1 = await fetch('https://finance.yahoo.com', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    const rawCookie = r1.headers.get('set-cookie') || '';
    const cookieParts = rawCookie.split(',').map(c => c.trim().split(';')[0]).join('; ');
    results.cookieStatus = r1.status;
    results.cookiePreview = cookieParts.slice(0, 120);

    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Cookie': cookieParts },
      signal: AbortSignal.timeout(8000),
    });
    const crumbText = await r2.text();
    results.crumbStatus = r2.status;
    results.crumb = crumbText.slice(0, 60);

    if (r2.ok && crumbText && !crumbText.includes('<')) {
      const crumb = encodeURIComponent(crumbText.trim());
      const r3 = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=financialData,defaultKeyStatistics&crumb=${crumb}`, {
        headers: { 'User-Agent': UA, 'Cookie': cookieParts, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      const body = await r3.text();
      results.quoteSummaryStatus = r3.status;
      results.quoteSummaryPreview = body.slice(0, 300);
    }
  } catch(e) {
    results.cookieError = e.message;
  }

  // Test 2: v11 without crumb
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v11/finance/quoteSummary/AAPL?modules=financialData', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    results.v11Status = r.status;
    results.v11Preview = (await r.text()).slice(0, 200);
  } catch(e) { results.v11Error = e.message; }

  // Test 3: v7/quote
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    results.v7Status = r.status;
    results.v7Preview = (await r.text()).slice(0, 200);
  } catch(e) { results.v7Error = e.message; }

  // Test 4: v8/chart (works for price, check if modules param returns fundamentals)
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d&modules=financialData,defaultKeyStatistics', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    results.v8Status = r.status;
    results.v8Preview = (await r.text()).slice(0, 300);
  } catch(e) { results.v8Error = e.message; }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
