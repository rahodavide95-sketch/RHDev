export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getCrumb() {
  // Step 1: get cookie from Yahoo consent
  const res1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  });
  const cookie = res1.headers.get('set-cookie') || '';

  // Step 2: get crumb using that cookie
  const res2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
    signal: AbortSignal.timeout(8000),
  });
  const crumb = await res2.text();
  return { crumb: crumb.trim(), cookie };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t = encodeURIComponent(ticker.toUpperCase());
  const modules = 'financialData,defaultKeyStatistics,summaryDetail,recommendationTrend';

  try {
    const { crumb, cookie } = await getCrumb();
    const headers = { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' };

    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${t}&crumb=${encodeURIComponent(crumb)}`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const data = await r.json();
        // Verify it has real data
        const hasData = data?.quoteSummary?.result?.[0] || data?.quoteResponse?.result?.[0];
        if (!hasData) continue;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      } catch { continue; }
    }
  } catch { /* crumb fetch failed, fall through */ }

  return new Response(JSON.stringify({ error: 'unavailable' }), {
    status: 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
