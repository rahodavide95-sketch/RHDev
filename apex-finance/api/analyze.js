export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });

// ── Protezioni best-effort (stato per-istanza edge) ──
const CACHE = new Map();          // key → { text, ts }
const CACHE_TTL = 60 * 60 * 1000; // 1 ora
const CACHE_MAX = 300;
const HITS = new Map();           // ip → [timestamps]
const RATE_MAX = 15;              // richieste
const RATE_WIN = 60 * 1000;       // per minuto

function rateLimited(ip, now) {
  const arr = (HITS.get(ip) || []).filter(t => now - t < RATE_WIN);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) { for (const k of HITS.keys()) { HITS.delete(k); if (HITS.size < 2500) break; } }
  return arr.length > RATE_MAX;
}
// chiave di cache stabile dai campi salienti del payload
function cacheKey(m) {
  if (m.kind === 'stock') return `s:${m.ticker}:${m.score}:${m.rsi}:${m.mo3m}:${m.aboveMA200}:${m.trendUp}`;
  return `p:${(m.tickers || []).join(',')}:${(m.weights || []).join(',')}:${m.projRet}:${m.horizon}:${m.sharpe}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  // Nessuna chiave configurata → il frontend usa l'analisi locale
  if (!key) return json({ error: 'no_key' }, 503);

  const now = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anon';
  if (rateLimited(ip, now)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });

  let m;
  try { m = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  // cache hit → risposta immediata, nessun costo API
  const ck = cacheKey(m);
  const cached = CACHE.get(ck);
  if (cached && now - cached.ts < CACHE_TTL) return json({ text: cached.text, cached: true }, 200);

  // ── Analisi di un SINGOLO TITOLO ──
  if (m.kind === 'stock') {
    const f = m.fund || {};
    const fundLine = (f.trailingPE != null || f.roe != null)
      ? `Fondamentali: ${[f.trailingPE != null ? `P/E ${f.trailingPE}` : '', f.forwardPE != null ? `P/E fwd ${f.forwardPE}` : '', f.roe != null ? `ROE ${(f.roe * 100).toFixed(0)}%` : '', f.pb != null ? `P/B ${f.pb}` : '', f.earningsGrowth != null ? `cresc. utili ${(f.earningsGrowth * 100).toFixed(0)}%` : '', f.revenueGrowth != null ? `cresc. ricavi ${(f.revenueGrowth * 100).toFixed(0)}%` : ''].filter(Boolean).join(', ')}`
      : 'Fondamentali: non disponibili (ETF/crypto/indice o dato mancante).';
    const sPrompt =
`Sei un analista finanziario. Analizza questo titolo e dai un parere chiaro, discorsivo e onesto in ITALIANO, rivolgendoti direttamente all'investitore ("tu"). Evita elenchi puntati: scrivi in prosa scorrevole.

Titolo: ${m.name} (${m.ticker}) — prezzo ${m.currency} ${m.price} (${m.chP >= 0 ? '+' : ''}${m.chP}% da ieri)
APEX Score (0-100): ${m.score}
RSI: ${m.rsi ?? 'n/d'} | sopra MA200: ${m.aboveMA200} | trend rialzista (MA50>MA200): ${m.trendUp}
Momentum: 3M ${m.mo3m ?? 'n/d'}% · 6M ${m.mo6m ?? 'n/d'}% · 12M ${m.mo12m ?? 'n/d'}%
Volatilità annua: ${m.vol ?? 'n/d'}% | max drawdown 1 anno: -${m.dd}%
Win rate storico: 30gg ${m.w30 ?? 'n/d'}% · 90gg ${m.w90 ?? 'n/d'}%
${fundLine}
${m.tool ? `\nVerdetto dello SCREENING AUTOMATICO del tool (regole meccaniche): ${m.tool.inZone ? 'in "zona opportunità" (ipervenduto + trend di fondo rialzista)' : 'NON in zona opportunità'}; raccomandazione automatica: "${m.tool.reco}"${m.tool.oppRate != null ? `; affidabilità storica del setto ${m.tool.oppRate}%` : ''}.` : ''}

Scrivi 3 brevi paragrafi in prosa: (1) il quadro tecnico e di trend; (2) rischio, momentum e valutazione fondamentale; (3) il TUO parere generale ONESTO, pesando TUTTI i dati che vedi qui sopra (trend, RSI, momentum 3/6/12M, volatilità, drawdown, win rate, fondamentali): di' ESPLICITAMENTE se secondo te conviene comprare ora, attendere o lasciar perdere, e perché — senza addolcire se i dati sono deboli.${m.tool ? ' Poi, in una riga, nota se il tuo giudizio COINCIDE o DIVERGE dallo screening automatico del tool qui sopra (che applica solo poche regole meccaniche) e spiega brevemente la differenza. Non sei vincolato al suo verdetto: forma prima il tuo, in autonomia.' : ''} Usa **grassetto** per le parole chiave. Massimo ~200 parole. Basati SOLO sui dati forniti, non inventarne altri. Chiudi con una riga che ricorda che non è una raccomandazione d'investimento personalizzata.`;
    return await callClaude(key, sPrompt, ck);
  }

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

  return await callClaude(key, prompt, ck);
}

async function callClaude(key, prompt, ck) {
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
    // salva in cache (con eviction FIFO grezza)
    if (ck) {
      CACHE.set(ck, { text, ts: Date.now() });
      if (CACHE.size > CACHE_MAX) { const first = CACHE.keys().next().value; CACHE.delete(first); }
    }
    return json({ text }, 200);
  } catch (e) {
    return json({ error: e.message || 'fetch_failed' }, 502);
  }
}
