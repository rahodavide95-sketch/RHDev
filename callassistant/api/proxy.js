export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
      },
    });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const fwdHeaders = new Headers();
  fwdHeaders.set('Content-Type', 'application/json');
  const key = req.headers.get('x-api-key');
  const ver = req.headers.get('anthropic-version');
  if (key) fwdHeaders.set('x-api-key', key);
  if (ver) fwdHeaders.set('anthropic-version', ver);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: fwdHeaders,
    body: req.body,
  });

  const out = new Headers(resp.headers);
  out.set('Access-Control-Allow-Origin', '*');
  return new Response(resp.body, { status: resp.status, headers: out });
}
