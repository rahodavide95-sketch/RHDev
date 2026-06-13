export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getCrumb() {
  // Fetch Yahoo Finance homepage to get consent cookie
  const res1 = await fetch('https://finance.yahoo.com', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  });
  const rawCookie = res1.headers.get('set-cookie') || '';
  // Extract just the cookie values (name=value pairs before semicolons)
  const cookieParts = rawCookie.split(',').map(c => c.trim().split(';')[0]).join('; ');

  const res2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieParts, 'Accept': '*/*' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res2.ok) throw new Error('crumb failed');
  const crumb = (await res2.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('invalid crumb');
  return { crumb, cookie: cookieParts };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t = encodeURIComponent(ticker.toUpperCase());
  const modules = 'financialData,defaultKeyStatistics,summaryDetail,recommendationTrend';

  // Strategy 1: crumb-authenticated quoteSummary
  try {
    const { crumb, cookie } = await getCrumb();
    const hdrs = { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' };
    const crumbEnc = encodeURIComponent(crumb);

    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}&crumb=${crumbEnc}`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}&crumb=${crumbEnc}`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const data = await r.json();
        if (data?.quoteSummary?.result?.[0]) {
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
          });
        }
      } catch { continue; }
    }
  } catch { /* crumb approach failed */ }

  // Strategy 2: v11 quoteSummary (sometimes crumb-free)
  try {
    const hdrs = { 'User-Agent': UA, 'Accept': 'application/json' };
    const urls = [
      `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${t}?modules=${modules}`,
      `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${t}?modules=${modules}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const data = await r.json();
        if (data?.quoteSummary?.result?.[0]) {
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
          });
        }
      } catch { continue; }
    }
  } catch { /* v11 failed */ }

  // Strategy 3: v7/quote (basic data, no crumb needed sometimes)
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${t}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data?.quoteResponse?.result?.[0]) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      }
    }
  } catch { /* v7 failed */ }

  return new Response(JSON.stringify({ error: 'unavailable' }), {
    status: 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
