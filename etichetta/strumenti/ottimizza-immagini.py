#!/usr/bin/env python3
"""
Ottimizza le immagini del sito prima di pubblicarle.

Uso (dalla cartella "etichetta"):
    python3 strumenti/ottimizza-immagini.py

Serve una volta sola:  pip3 install pillow

Cosa fa, per ogni .jpg / .jpeg / .png / .tif in images/releases,
images/artists e images/merch:
  - la ridimensiona (copertine 800x800, foto artisti max 720x960,
    merch max 1000 px): sul sito non servono misure più grandi;
  - la salva in .webp (molto più leggero) con un nome senza spazi;
  - NON copia i metadati EXIF (modello di fotocamera, data, software
    e, se ci fossero, coordinate GPS dello scatto);
  - sposta l'originale in _originali/ (cartella esclusa da git, quindi
    non viene mai pubblicata).
Alla fine stampa i percorsi da incollare in content.js.
"""
import re
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Manca Pillow. Installalo con:  pip3 install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "images"
ORIGINALS = ROOT / "_originali"

# cartella -> (larghezza max, altezza max, qualità webp)
TARGETS = {
    "releases": (800, 800, 82),
    "artists": (720, 960, 80),
    "merch": (1000, 1000, 82),
}
SOURCE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "immagine"


def main() -> None:
    done = []
    for folder, (max_w, max_h, quality) in TARGETS.items():
        src_dir = IMAGES / folder
        if not src_dir.is_dir():
            continue
        for src in sorted(src_dir.iterdir()):
            if src.suffix.lower() not in SOURCE_EXT:
                continue
            dst = src_dir / f"{slug(src.stem)}.webp"
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)  # raddrizza le foto da smartphone
                im.thumbnail((max_w, max_h), Image.LANCZOS)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
                im.save(dst, "WEBP", quality=quality, method=6)  # nessun exif=… → metadati rimossi
            (ORIGINALS / folder).mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), ORIGINALS / folder / src.name)
            kb_before = (ORIGINALS / folder / src.name).stat().st_size // 1024
            kb_after = dst.stat().st_size // 1024
            done.append((f"images/{folder}/{dst.name}", kb_before, kb_after))

    if not done:
        print("Nessuna immagine da ottimizzare (cerco .jpg/.png in images/releases, artists, merch).")
        return
    print("Fatto. Percorsi da usare in content.js:\n")
    for path, before, after in done:
        print(f'  "{path}"   ({before} KB -> {after} KB)')
    print("\nGli originali sono in _originali/ (non vengono pubblicati).")


if __name__ == "__main__":
    main()
