# Temporaneo: loghi ufficiali delle crypto (CoinGecko, prime 100) e delle banche mancanti.
import re, io, pathlib, urllib.parse
import requests
from PIL import Image

ROOT = pathlib.Path('finanza-personale')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'it-IT,it;q=0.9'}

def get(url):
    try:
        r = requests.get(url, headers=UA, timeout=25, allow_redirects=True)
        return r if r.ok else None
    except Exception as e:
        print('   !', url, e); return None

def square(im, size):
    im = im.convert('RGBA'); im.thumbnail((size, size), Image.LANCZOS)
    sq = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sq.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2), im)
    return sq

# ── crypto ──
out = ROOT / 'icons/crypto'; out.mkdir(parents=True, exist_ok=True)
coins = []
r = get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1')
for c in (r.json() if r is not None else []):
    sym = re.sub(r'[^a-z0-9]', '', str(c.get('symbol', '')).lower())
    if not sym or sym in coins: continue
    img = get(c.get('image') or '')
    if img is None: continue
    try:
        square(Image.open(io.BytesIO(img.content)), 64).save(out / f'{sym}.png', optimize=True)
        coins.append(sym)
    except Exception as e:
        print('   x', sym, e)
src = ROOT / 'js/data/coins.js'
t = src.read_text()
t = re.sub(r'export const COIN_LOGOS = new Set\(\[.*?\]\);', 'export const COIN_LOGOS = new Set([' + ', '.join(f"'{s}'" for s in coins) + ']);', t, flags=re.S)
src.write_text(t)
print('crypto:', len(coins), ' '.join(coins))

# ── banche mancanti, con indirizzi alternativi ──
ALT = {'intesa': ['www.intesasanpaolo.com', 'group.intesasanpaolo.com'], 'webank': ['www.webank.it'], 'bnl': ['www.bnl.it', 'bnpparibas.it'],
       'deutschebank': ['www.deutsche-bank.it', 'www.deutsche-bank.de'], 'fideuram': ['www.fideuram.it'], 'sella': ['www.sella.it']}
bsrc = ROOT / 'js/data/banks.js'
btxt = bsrc.read_text()
have = set(re.findall(r"'([a-z0-9]+)'", re.search(r'export const LOGOS = new Set\(\[(.*?)\]\)', btxt, re.S).group(1)))
for slug, domains in ALT.items():
    if slug in have: continue
    best = None
    for dom in domains:
        base = f'https://{dom}/'
        urls = []
        h = get(base)
        if h is not None:
            for tag in re.findall(r'<link[^>]+>', h.text[:400000], re.I):
                rel = re.search(r'rel=["\']([^"\']+)["\']', tag, re.I); href = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
                if rel and href and 'icon' in rel.group(1).lower(): urls.append(urllib.parse.urljoin(h.url, href.group(1)))
        urls += [base + 'apple-touch-icon.png', f'https://www.google.com/s2/favicons?domain={dom}&sz=256', base + 'favicon.ico']
        for u in urls:
            x = get(u)
            if x is None: continue
            try: im = Image.open(io.BytesIO(x.content))
            except Exception: continue
            print('  ', slug, im.size, u)
            if best is None or im.size[0] > best.size[0]: best = im
            if im.size[0] >= 96: break
        if best is not None and best.size[0] >= 64: break
    if best is not None and best.size[0] >= 48:
        square(best, 96).save(ROOT / f'icons/banks/{slug}.png', optimize=True)
        have.add(slug); print('banca ok', slug)
btxt = re.sub(r'export const LOGOS = new Set\(\[.*?\]\);', 'export const LOGOS = new Set([' + ', '.join(f"'{s}'" for s in sorted(have)) + ']);', btxt, flags=re.S)
bsrc.write_text(btxt)
