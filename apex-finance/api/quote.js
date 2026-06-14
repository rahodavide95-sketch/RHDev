export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const sym = ticker.toUpperCase();
  const key = process.env.FINNHUB_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }), {
      status: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch profile + basic financials in parallel
    const [profileRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${key}`, {
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${key}`, {
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    if (!profileRes.ok || !metricsRes.ok) throw new Error('Finnhub fetch failed');

    const [profile, metrics] = await Promise.all([profileRes.json(), metricsRes.json()]);
    const m = metrics?.metric || {};

    // Map to quoteSummary-compatible shape so the frontend parser works unchanged
    const result = {
      quoteSummary: {
        result: [{
          financialData: {
            returnOnEquity: { raw: m.roeTTM != null ? m.roeTTM / 100 : null },
            operatingMargins: { raw: m.operatingMarginTTM != null ? m.operatingMarginTTM / 100 : null },
            earningsGrowth: { raw: m.epsGrowthTTMYoy != null ? m.epsGrowthTTMYoy / 100 : null },
            revenueGrowth: { raw: m.revenueGrowthTTMYoy != null ? m.revenueGrowthTTMYoy / 100 : null },
          },
          defaultKeyStatistics: {
            trailingPE: { raw: m.peTTM ?? null },
            forwardPE: { raw: m.forwardPE ?? null },
            priceToBook: { raw: m.pbAnnual ?? null },
            pegRatio: { raw: m.pegNormalizedAnnual ?? null },
          },
          summaryDetail: {
            trailingPE: { raw: m.peTTM ?? null },
            forwardPE: { raw: m.forwardPE ?? null },
          },
          recommendationTrend: { trend: [] },
        }],
        error: null,
      },
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}
