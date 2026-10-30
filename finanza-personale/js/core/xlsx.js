/* Lettura dei file Excel (.xlsx) senza librerie: un .xlsx è uno zip di file XML.
   Si leggono solo i valori delle celle (niente formule, macro o collegamenti esterni),
   con limiti di dimensione contro i file costruiti per bloccare il browser. */

export class XlsxError extends Error {}

const MAX_ENTRY = 64 * 1024 * 1024;      // 64 MB per file interno, una volta scompattato
const MAX_TOTAL = 160 * 1024 * 1024;     // e 160 MB in tutto
const MAX_ROWS = 50000, MAX_COLS = 300;

/** Scompatta i file dello zip che servono (`want(nome)`). */
export async function unzip(buf, want = () => true) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError('Il file non è un Excel (.xlsx) valido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError('Il file Excel è rovinato.');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    if (csize === 0xffffffff || off === 0xffffffff) throw new XlsxError('File Excel troppo grande.');
    if (off + 30 > b.length || dv.getUint32(off, true) !== 0x04034b50) throw new XlsxError('Il file Excel è rovinato.');
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = b.subarray(start, start + csize);
    let file;
    if (method === 0) file = data.slice();
    else if (method === 8) file = await inflate(data);
    else throw new XlsxError('Formato di compressione non supportato: salva il file di nuovo da Excel.');
    total += file.length;
    if (total > MAX_TOTAL) throw new XlsxError('File Excel troppo grande.');
    out.set(name, file);
  }
  return out;
}

async function inflate(data) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY) { reader.cancel().catch(() => {}); throw new XlsxError('File Excel troppo grande.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unesc(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()];
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });
}
const attr = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)(?:\\w+:)?' + name + '="([^"]*)"')); return m ? unesc(m[1]) : null; };
/** Tutto il testo dei <t> (anche spezzato in più pezzi formattati), senza la pronuncia giapponese. */
const texts = s => [...s.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => unesc(m[1])).join('');

/** "AB" → 27 (da 0). */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [], nums = [];
  let rowSeq = 0;
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rn = Number(attr(rm[1], 'r')) || rowSeq + 1;
    rowSeq = rn;
    if (rn > MAX_ROWS) break;
    if (!rm[2]) continue;
    const cells = [];
    let colSeq = -1;
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cm[1], 'r');
      const ci = ref ? colIndex(ref) : colSeq + 1;
      colSeq = ci;
      if (ci < 0 || ci >= MAX_COLS || !cm[2]) continue;
      const t = attr(cm[1], 't') || 'n';
      const vm = cm[2].match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
      const v = vm ? unesc(vm[1]) : null;
      let val = null;
      if (t === 's') val = v != null ? shared[Number(v)] ?? null : null;
      else if (t === 'inlineStr') val = texts(cm[2]);
      else if (t === 'str' || t === 'd') val = v;
      else if (t === 'b') val = v === '1' ? 'VERO' : 'FALSO';
      else if (t === 'e') val = null;
      else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? n : null; }
      if (val === '' ) val = null;
      if (val != null) cells[ci] = val;
    }
    if (cells.some(x => x != null)) {
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
      rows.push(cells);
      nums.push(rn);
    }
  }
  return { rows, nums };
}

/** Legge un .xlsx: { sheets: [{ name, rows, nums }], date1904 }.
    rows: righe non vuote, celle come numeri o testi; nums: numero di riga in Excel. */
export async function readXlsx(buf) {
  const files = await unzip(buf, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const dec = new TextDecoder();
  const txt = n => (files.has(n) ? dec.decode(files.get(n)) : '');
  const wb = txt('xl/workbook.xml');
  if (!wb) throw new XlsxError('Il file non è un Excel (.xlsx) valido.');
  const shared = [...txt('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => texts(m[1]));
  const rels = new Map([...txt('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const sheets = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name') || 'Foglio';
    const target = rels.get(attr(m[1], 'id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (!files.has(path)) continue;
    sheets.push({ name, ...parseSheet(txt(path), shared) });
  }
  if (!sheets.length) throw new XlsxError('Nel file non ci sono fogli da leggere.');
  return { sheets, date1904: /date1904="(1|true)"/.test(wb) };
}

/** Numero di serie di Excel → data AAAA-MM-GG. */
export function excelDate(n, date1904 = false) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + (Math.floor(n) + (date1904 ? 1462 : 0)) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** È uno zip (quindi forse un .xlsx)? */
export const isZip = buf => { const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength)); return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; };
