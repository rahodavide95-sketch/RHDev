export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function yfChart(ticker, range = '5d', interval = '1d') {
  const t = encodeURIComponent(ticker);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=${range}&interval=${interval}&includePrePost=false`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${t}?range=${range}&interval=${interval}&includePrePost=false`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.chart?.result?.[0]) return d.chart.result[0];
    } catch { continue; }
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const YC = ['^IRX', '^FVX', '^TNX', '^TYX'];
  const SECS = ['XLK','XLF','XLE','XLV','XLI','XLRE','XLY','XLP','XLU','XLB','XLC'];

  // Fetch all in parallel server-side
  const [ycData, secData, dxyData, eurData] = await Promise.all([
    Promise.all(YC.map(s => yfChart(s))),
    Promise.all(SECS.map(s => yfChart(s))),
    yfChart('DX-Y.NYB'),
    yfChart('EURUSD=X'),
  ]);

  const getClose = res => {
    if (!res) return null;
    const cl = res.indicators?.quote?.[0]?.close || [];
    const v = cl.filter(x => x != null && !isNaN(x) && x > 0);
    return v.length ? v[v.length - 1] : null;
  };

  const getPctChange = res => {
    if (!res) return null;
    const cl = res.indicators?.quote?.[0]?.close || [];
    const v = cl.filter(x => x != null && !isNaN(x) && x > 0);
    if (v.length < 2) return null;
    return (v[v.length - 1] - v[v.length - 2]) / v[v.length - 2] * 100;
  };

  const result = {
    yc: ycData.map(getClose),
    sectors: secData.map(getPctChange),
    dxy: getClose(dxyData),
    dxyPct: getPctChange(dxyData),
    eur: getClose(eurData),
    eurPct: getPctChange(eurData),
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' },
  });
}
