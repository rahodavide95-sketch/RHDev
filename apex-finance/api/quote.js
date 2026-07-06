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

    // helper: primo valore non nullo, diviso 100 (i margini/crescite Finnhub sono in %)
    const pick = (...v) => { for (const x of v) if (x != null) return x; return null; };
    const pct = (...v) => { const x = pick(...v); return x != null ? x / 100 : null; };

    // Map to quoteSummary-compatible shape so the frontend parser works unchanged.
    // Uso più chiavi Finnhub come fallback per massimizzare la copertura dati.
    const result = {
      quoteSummary: {
        result: [{
          financialData: {
            returnOnEquity: { raw: pct(m.roeTTM, m.roeRfy, m.roe5Y) },
            operatingMargins: { raw: pct(m.operatingMarginTTM, m.operatingMarginAnnual, m.operatingMargin5Y) },
            earningsGrowth: { raw: pct(m.epsGrowthTTMYoy, m.epsGrowthQuarterlyYoy, m.epsGrowth3Y, m.epsGrowth5Y) },
            revenueGrowth: { raw: pct(m.revenueGrowthTTMYoy, m.revenueGrowthQuarterlyYoy, m.revenueGrowth3Y, m.revenueGrowth5Y) },
          },
          defaultKeyStatistics: {
            trailingPE: { raw: pick(m.peTTM, m.peBasicExclExtraTTM, m.peAnnual, m.peExclExtraAnnual) },
            forwardPE: { raw: pick(m.forwardPE, m.forwardPe) },
            priceToBook: { raw: pick(m.pbAnnual, m.pbQuarterly, m.ptbvAnnual) },
            pegRatio: { raw: pick(m.pegNormalizedAnnual, m.pegTTM, m.pegRatio) },
          },
          summaryDetail: {
            trailingPE: { raw: pick(m.peTTM, m.peBasicExclExtraTTM, m.peAnnual) },
            forwardPE: { raw: pick(m.forwardPE, m.forwardPe) },
          },
          recommendationTrend: { trend: [] },
        }],
        error: null,
      },
      // Scheda strumento (stile justETF) — profilo + metriche estese
      _profile: {
        name: profile?.name ?? null,
        country: profile?.country ?? null,
        currency: profile?.currency ?? null,
        exchange: profile?.exchange ?? null,
        industry: profile?.finnhubIndustry ?? null,
        ipo: profile?.ipo ?? null,
        marketCap: profile?.marketCapitalization ?? null, // in milioni
        sharesOut: profile?.shareOutstanding ?? null,
        weburl: profile?.weburl ?? null,
        logo: profile?.logo ?? null,
        phone: profile?.phone ?? null,
      },
      _ext: {
        week52High: m['52WeekHigh'] ?? null,
        week52Low: m['52WeekLow'] ?? null,
        divYield: m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM ?? null,
        beta: m.beta ?? null,
        psTTM: m.psTTM ?? null,
        currentRatio: m.currentRatioQuarterly ?? null,
        debtToEquity: m['totalDebt/totalEquityQuarterly'] ?? null,
        grossMargin: m.grossMarginTTM ?? null,
        netMargin: m.netProfitMarginTTM ?? null,
        roa: m.roaTTM ?? null,
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
