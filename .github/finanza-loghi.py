# Temporaneo: scarica l'icona ufficiale del sito di ogni banca elencata in
# finanza-personale/js/data/banks.js e la salva come PNG 96x96 in finanza-personale/icons/banks/.
import re, io, sys, pathlib, urllib.parse
import requests
from PIL import Image

ROOT = pathlib.Path('finanza-personale')
SRC = ROOT / 'js/data/banks.js'
OUT = ROOT / 'icons/banks'
OUT.mkdir(parents=True, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'it-IT,it;q=0.9'}
banks = re.findall(r"\['([a-z0-9]+)', '([a-z0-9.\-]+)'", SRC.read_text())

def get(url, **kw):
    try:
        r = requests.get(url, headers=UA, timeout=20, allow_redirects=True, **kw)
        return r if r.ok else None
    except Exception as e:
        print('   !', url, e)
        return None

def to_image(data, url):
    if data[:5] == b'<?xml' or b'<svg' in data[:400]:
        import cairosvg
        data = cairosvg.svg2png(bytestring=data, output_width=192, output_height=192)
    im = Image.open(io.BytesIO(data))
    if getattr(im, 'n_frames', 1) > 1 or im.format == 'ICO':
        try:
            sizes = sorted(im.info.get('sizes', []) or [im.size], key=lambda s: s[0])
            im.size = sizes[-1]
        except Exception:
            pass
    return im.convert('RGBA')

def candidates(domain):
    base = f'https://{domain}/'
    out = []
    r = get(base)
    if r is not None:
        html = r.text[:400000]
        for tag in re.findall(r'<link[^>]+>', html, re.I):
            rel = re.search(r'rel=["\']([^"\']+)["\']', tag, re.I)
            href = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
            if not rel or not href or 'icon' not in rel.group(1).lower():
                continue
            sizes = re.search(r'sizes=["\'](\d+)x\d+', tag, re.I)
            score = int(sizes.group(1)) if sizes else (180 if 'apple' in rel.group(1).lower() else (256 if href.group(1).lower().endswith('.svg') else 32))
            out.append((score, urllib.parse.urljoin(r.url, href.group(1))))
    out.sort(key=lambda x: -x[0])
    urls = [u for _, u in out]
    urls += [base + 'apple-touch-icon.png', base + 'apple-touch-icon-precomposed.png',
             f'https://www.google.com/s2/favicons?domain={domain}&sz=128', f'https://icons.duckduckgo.com/ip3/{domain}.ico', base + 'favicon.ico']
    return urls

found = []
for slug, domain in banks:
    print(slug, domain)
    best = None
    for url in candidates(domain):
        r = get(url)
        if r is None or not r.content:
            continue
        try:
            im = to_image(r.content, url)
        except Exception as e:
            print('   x', url, e)
            continue
        print('   ', im.size, url)
        if best is None or im.size[0] > best.size[0]:
            best = im
        if im.size[0] >= 96:
            break
    if best is None or best.size[0] < 24:
        print('   -> niente')
        continue
    # dentro un quadrato 96x96, senza deformare
    best.thumbnail((96, 96), Image.LANCZOS)
    sq = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
    sq.paste(best, ((96 - best.size[0]) // 2, (96 - best.size[1]) // 2), best)
    sq.save(OUT / f'{slug}.png', optimize=True)
    found.append(slug)

text = SRC.read_text()
text = re.sub(r'export const LOGOS = new Set\(\[.*?\]\);', 'export const LOGOS = new Set([' + ', '.join(f"'{s}'" for s in found) + ']);', text, flags=re.S)
SRC.write_text(text)
print('trovati', len(found), 'su', len(banks), ':', ' '.join(found))
missing = [s for s, _ in banks if s not in found]
print('mancano:', ' '.join(missing))
