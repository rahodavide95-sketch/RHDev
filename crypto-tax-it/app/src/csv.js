/* Lettura CSV tollerante (virgolette, separatori , ; tab, BOM, righe di testo prima dell'intestazione). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});

  class FormatError extends Error {}

  function splitRows(text, delim) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function detectDelim(line) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const c of line) { if (c === '"') q = !q; else if (!q && c in counts) counts[c]++; }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  /** Ritorna { headers, rows:[{col:valore}], headerLine } oppure lancia FormatError. */
  function readTable(text, headerMarker) {
    text = String(text).replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/);
    let h = 0;
    if (headerMarker) {
      h = lines.findIndex((l) => l.toLowerCase().includes(headerMarker.toLowerCase()));
      if (h < 0) throw new FormatError(`Intestazione "${headerMarker}" non trovata`);
    } else {
      while (h < lines.length && !lines[h].trim()) h++;
    }
    if (h >= lines.length) throw new FormatError('File vuoto');
    const delim = detectDelim(lines[h]);
    const grid = splitRows(lines.slice(h).join('\n'), delim);
    const headers = grid[0].map((x) => x.trim());
    const rows = [];
    for (let r = 1; r < grid.length; r++) {
      const cells = grid[r];
      if (!cells.some((c) => c.trim() !== '')) continue;
      const obj = {};
      headers.forEach((k, i) => { obj[k] = (cells[i] || '').trim(); });
      obj.__line = h + r + 1;
      rows.push(obj);
    }
    return { headers, rows, headerLine: h + 1 };
  }

  CT.csv = { readTable, FormatError, detectDelim };
  if (typeof module !== 'undefined') module.exports = CT.csv;
})();
