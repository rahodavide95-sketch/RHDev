export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  // Nessuna chiave configurata → il frontend usa l'analisi locale
  if (!key) return json({ error: 'no_key' }, 503);

  let m;
  try { m = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const holdings = (m.tickers || [])
    .map((t, i) => `${t} ${(m.weights || [])[i] ?? '?'}%`).join(', ');

  const prompt =
`Sei un analista finanziario. Analizza questo portafoglio e dai un parere chiaro e onesto in ITALIANO, rivolgendoti direttamente all'investitore ("tu"). Sii concreto e diretto.

Composizione: ${holdings}
Rendimento storico annuo (CAGR): ${m.annRet}%
Rendimento atteso usato per la proiezione: ${m.projRet}% ${m.projCustom ? '(ipotesi dell\'utente)' : '(storico)'}
Volatilità annua: ${m.vol}%
Sharpe: ${m.sharpe} | Sortino: ${m.sortino} | Calmar: ${m.calmar}
Max drawdown storico: ${m.maxdd}%
Diversificazione (asset effettivi): ${m.effN}${m.avgCorr != null ? ` | correlazione media: ${m.avgCorr}` : ''}
${m.beta != null ? `Beta: ${m.beta}` : ''}
Probabilità di perdita a ${m.horizon} anni: ${m.probLoss}%
Rendimento reale (netto inflazione): ${m.realRet}%
Capitale investito: ${m.invested}€ → scenario mediano a ${m.horizon} anni: ${m.medianFinal}€

Scrivi 4 brevi paragrafi:
1) Un giudizio complessivo sintetico (è solido? equilibrato? aggressivo?).
2) Punti di forza concreti.
3) Punti deboli o rischi concreti.
4) 2-3 suggerimenti pratici e specifici per migliorarlo.
Usa **grassetto** per le parole chiave. Massimo ~180 parole totali. Non inventare dati oltre a quelli forniti. Chiudi ricordando in una riga che non è una raccomandazione d'investimento personalizzata.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(28000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ error: 'upstream', status: r.status, detail: detail.slice(0, 200) }, 502);
    }
    const data = await r.json();
    const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return json({ error: 'empty' }, 502);
    return json({ text }, 200);
  } catch (e) {
    return json({ error: e.message || 'fetch_failed' }, 502);
  }
}
