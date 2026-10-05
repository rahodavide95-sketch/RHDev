/* Lettura di file .zip nel browser (l'export di Crypto.com Exchange e' uno zip con piu' CSV). Nessuna libreria:
   usa DecompressionStream('deflate-raw') disponibile nei browser moderni. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** ArrayBuffer -> [{name, text}] (solo file di testo non vuoti, niente cartelle). */
  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('File ZIP non valido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP danneggiato');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      const raw = u8.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error(`Compressione ZIP non supportata (${method}) in ${name}`);
      out.push({ name: name.split('/').pop(), text: new TextDecoder('utf-8').decode(data) });
    }
    return out;
  }

  CT.unzip = unzip;
  if (typeof module !== 'undefined') module.exports = { unzip };
})();
