/* Grafici SVG fatti a mano: leggeri, nitidi, con i colori del tema e il dettaglio
   al passaggio del dito o del mouse. Linee 2 px, barre max 24 px con estremità
   arrotondate, griglia leggera, legenda quando le serie sono più di una. */

import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, style) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (style) Object.assign(el.style, style);
  return el;
};

function niceTicks(min, max, count = 4) {
  if (min === max) { const d = Math.abs(min) || 1; min -= d; max += d; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => span / x <= count + 0.5) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { lo, hi, ticks };
}

/** Contenitore che ridisegna il grafico quando cambia la larghezza. */
function responsive(cls, draw, height) {
  const box = h('div.chart', { class: cls });
  box.style.height = height + 'px';
  let lastW = 0;
  const ro = new ResizeObserver(entries => {
    if (!box.isConnected) { if (lastW) ro.disconnect(); return; }   // grafico tolto dalla pagina
    const w = Math.round(entries[0].contentRect.width);
    if (w > 0 && Math.abs(w - lastW) > 1) { lastW = w; draw(box, w); }
  });
  ro.observe(box);
  // primo disegno anche se ResizeObserver arriva tardi
  requestAnimationFrame(() => { const w = Math.round(box.clientWidth); if (w > 0 && !lastW) { lastW = w; draw(box, w); } });
  return box;
}

function tooltipEl(box) {
  let t = box.querySelector('.chart-tip');
  if (!t) { t = h('div.chart-tip', { role: 'presentation' }); box.append(t); }
  return t;
}
function placeTip(box, tip, x, y) {
  const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = x + 14;
  if (left + tw > bw) left = x - tw - 14;
  left = Math.max(0, left);
  const top = Math.max(0, Math.min(y - th / 2, box.clientHeight - th));
  tip.style.transform = `translate(${left}px, ${top}px)`;
}
function tipContent(tip, title, rows) {
  tip.replaceChildren(h('div.tip-title', title), ...rows.map(r => h('div.tip-row',
    r.color ? h('span.tip-key', { style: { background: r.color } }) : null,
    h('span.tip-name', r.name), h('span.tip-val', r.value))));
}

export function legend(items) {
  return h('div.legend', items.map(i => h('span.legend-item', h('span.legend-key', { class: i.dashed ? 'dashed' : i.line ? 'line' : '', style: { background: i.dashed || i.line ? 'none' : i.color, borderColor: i.color } }), i.label)));
}

/* ═══ Linee / aree ═══════════════════════════════════════════════════════
   spec: { labels, series:[{name, color, values, area, dashed}], band:{low,high,color},
           target:{value,label}, fmt, fmtAxis, height, zero, title } */
export function lineChart(spec) {
  const H = spec.height || 220;
  const box = responsive('chart-line', (box, W) => {
    box.querySelector('svg')?.remove();
    const tip = tooltipEl(box);
    tip.classList.remove('show');
    const padL = spec.yAxis === false ? 8 : 52, padR = 12, padT = 12, padB = 26;
    const n = spec.labels.length;
    const all = spec.series.flatMap(x => x.values).filter(v => v != null && Number.isFinite(v));
    if (spec.band) all.push(...spec.band.low, ...spec.band.high);
    if (spec.target) all.push(spec.target.value);
    if (spec.zero !== false) all.push(0);
    if (!all.length) all.push(0, 1);
    const { lo, hi, ticks } = niceTicks(Math.min(...all), Math.max(...all), H < 180 ? 3 : 4);
    const x = i => padL + (n <= 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': spec.title || 'Grafico' });
    // griglia
    for (const t of ticks) {
      svg.append(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }));
      if (spec.yAxis !== false) {
        const tx = s('text', { x: padL - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' });
        tx.textContent = spec.mask ? '•••' : (spec.fmtAxis || spec.fmt || String)(t);
        svg.append(tx);
      }
    }
    // etichette in basso, senza sovrapporsi
    const maxLabels = Math.max(2, Math.floor((W - padL - padR) / 64));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = 0; i < n; i += every) {
      const tx = s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 && n > 1 ? 'start' : 'middle', class: 'tick' });
      tx.textContent = spec.labels[i];
      svg.append(tx);
    }
    // fascia (scenari)
    if (spec.band) {
      let d = '';
      spec.band.high.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
      for (let i = spec.band.low.length - 1; i >= 0; i--) d += 'L' + x(i).toFixed(1) + ',' + y(spec.band.low[i]).toFixed(1);
      svg.append(s('path', { d: d + 'Z', class: 'band' }, { fill: spec.band.color || 'var(--c1)' }));
    }
    for (const se of spec.series) {
      const pts = se.values.map((v, i) => (v == null || !Number.isFinite(v) ? null : [x(i), y(v)]));
      let d = '', started = false;
      pts.forEach(p => { if (!p) { started = false; return; } d += (started ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); started = true; });
      if (se.area) {
        const valid = pts.filter(Boolean);
        if (valid.length > 1) {
          const base = y(Math.max(lo, Math.min(hi, 0)));
          svg.append(s('path', { d: d + `L${valid[valid.length - 1][0].toFixed(1)},${base}L${valid[0][0].toFixed(1)},${base}Z`, class: 'area' }, { fill: se.color }));
        }
      }
      svg.append(s('path', { d, class: 'line' + (se.dashed ? ' dashed' : '') }, { stroke: se.color }));
      // punto finale
      const last = [...pts].reverse().find(Boolean);
      if (last && spec.endDot !== false && !se.dashed) svg.append(s('circle', { cx: last[0], cy: last[1], r: 4, class: 'end-dot' }, { fill: se.color }));
    }
    if (spec.target) {
      svg.append(s('line', { x1: padL, x2: W - padR, y1: y(spec.target.value), y2: y(spec.target.value), class: 'target' }));
      const tx = s('text', { x: W - padR, y: y(spec.target.value) - 6, 'text-anchor': 'end', class: 'tick strong' });
      tx.textContent = spec.target.label;
      svg.append(tx);
    }
    // livello interattivo
    const cross = s('line', { y1: padT, y2: H - padB, class: 'cross' });
    cross.style.display = 'none';
    const dots = spec.series.map(se => { const c = s('circle', { r: 5, class: 'hover-dot' }, { fill: se.color }); c.style.display = 'none'; return c; });
    svg.append(cross, ...dots);
    const hit = s('rect', { x: padL, y: 0, width: Math.max(1, W - padL - padR), height: H, fill: 'transparent' });
    svg.append(hit);
    const show = e => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - padL) / ((W - padL - padR) / (n - 1)))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      let ty = H / 2;
      spec.series.forEach((se, k) => {
        const v = se.values[i];
        if (v == null) { dots[k].style.display = 'none'; return; }
        dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); dots[k].style.display = '';
        if (k === 0) ty = y(v);
      });
      const rows = spec.series.filter(se => se.values[i] != null).map(se => ({ name: se.name, color: se.color, value: spec.mask ? '•••' : (spec.fmt || String)(se.values[i]) }));
      if (spec.band) rows.push({ name: 'Scenari', value: spec.mask ? '•••' : `${(spec.fmt || String)(spec.band.low[i])} – ${(spec.fmt || String)(spec.band.high[i])}` });
      tipContent(tip, spec.tipLabels ? spec.tipLabels[i] : spec.labels[i], rows);
      tip.classList.add('show');
      placeTip(box, tip, x(i), ty);
    };
    const hide = () => { cross.style.display = 'none'; dots.forEach(d => { d.style.display = 'none'; }); tip.classList.remove('show'); };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
    box.prepend(svg);
  }, H);
  return box;
}

/* ═══ Barre (anche negative e impilate) ══════════════════════════════════
   spec: { labels, series:[{name,color,values}], stacked, fmt, fmtAxis, height, highlight } */
export function barChart(spec) {
  const H = spec.height || 220;
  const box = responsive('chart-bar', (box, W) => {
    box.querySelector('svg')?.remove();
    const tip = tooltipEl(box);
    tip.classList.remove('show');
    const padL = 52, padR = 8, padT = 12, padB = 26;
    const n = spec.labels.length, k = spec.series.length;
    let vals = [0];
    if (spec.stacked) {
      for (let i = 0; i < n; i++) {
        let pos = 0, neg = 0;
        for (const se of spec.series) { const v = se.values[i] || 0; if (v >= 0) pos += v; else neg += v; }
        vals.push(pos, neg);
      }
    } else vals = vals.concat(spec.series.flatMap(se => se.values.map(v => v || 0)));
    if (spec.line) vals = vals.concat(spec.line.values.filter(v => v != null));
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals), H < 180 ? 3 : 4);
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
    const band = (W - padL - padR) / n;
    const groupW = Math.min(band * 0.72, spec.stacked ? 28 : 24 * k + 2 * (k - 1));
    const barW = spec.stacked ? Math.min(groupW, 24) : Math.min(24, (groupW - 2 * (k - 1)) / k);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': spec.title || 'Grafico a barre' });
    for (const t of ticks) {
      svg.append(s('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }));
      const tx = s('text', { x: padL - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' });
      tx.textContent = spec.mask ? '•••' : (spec.fmtAxis || spec.fmt || String)(t);
      svg.append(tx);
    }
    const maxLabels = Math.max(2, Math.floor((W - padL - padR) / 44));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    const R = 4;
    // rettangolo con gli angoli arrotondati solo dal lato del valore
    const bar = (x0, v0, v1, color, dim) => {
      const top = Math.min(y(v0), y(v1)), bot = Math.max(y(v0), y(v1));
      const hgt = bot - top;
      if (hgt < 0.5) return null;
      const up = v1 >= v0;
      const r = Math.min(R, hgt, barW / 2);
      const d = up
        ? `M${x0},${bot}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${bot}Z`
        : `M${x0},${top}V${bot - r}Q${x0},${bot} ${x0 + r},${bot}H${x0 + barW - r}Q${x0 + barW},${bot} ${x0 + barW},${bot - r}V${top}Z`;
      return s('path', { d, class: 'barmark' + (dim ? ' dim' : '') }, { fill: color });
    };
    for (let i = 0; i < n; i++) {
      const cx = padL + band * i + band / 2;
      const dim = spec.highlight != null && spec.highlight !== i;
      if (spec.stacked) {
        let pos = 0, neg = 0;
        spec.series.forEach((se, j) => {
          const v = se.values[i] || 0;
          if (!v) return;
          const from = v >= 0 ? pos : neg, to = from + v;
          // 2 px di stacco tra i pezzi
          const gap = j > 0 ? (v >= 0 ? 1 : -1) * (hi - lo) * 2 / (H - padT - padB) : 0;
          const m = bar(cx - barW / 2, from + gap, to, se.color, dim);
          if (m) svg.append(m);
          if (v >= 0) pos = to; else neg = to;
        });
      } else {
        spec.series.forEach((se, j) => {
          const x0 = cx - groupW / 2 + j * (barW + 2);
          const m = bar(x0, 0, se.values[i] || 0, se.color, dim);
          if (m) svg.append(m);
        });
      }
      if (i % every === 0) {
        const tx = s('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'tick' + (spec.highlight === i ? ' strong' : '') });
        tx.textContent = spec.labels[i];
        svg.append(tx);
      }
    }
    if (spec.line) {
      let d = '';
      spec.line.values.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + (padL + band * i + band / 2).toFixed(1) + ',' + y(v).toFixed(1); });
      svg.append(s('path', { d, class: 'line' }, { stroke: spec.line.color }));
      spec.line.values.forEach((v, i) => { if (v != null) svg.append(s('circle', { cx: padL + band * i + band / 2, cy: y(v), r: 3.5, class: 'end-dot' }, { fill: spec.line.color })); });
    }
    const hl = s('rect', { y: padT, height: H - padT - padB, width: band, class: 'col-hover', rx: 8 });
    hl.style.display = 'none';
    svg.prepend(hl);
    const hit = s('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent' });
    svg.append(hit);
    const show = e => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - padL) / band)));
      hl.setAttribute('x', padL + band * i); hl.style.display = '';
      const rows = spec.series.map(se => ({ name: se.name, color: se.color, value: spec.mask ? '•••' : (spec.fmt || String)(se.values[i] || 0) }));
      if (spec.line) rows.push({ name: spec.line.name, color: spec.line.color, value: spec.mask ? '•••' : (spec.line.fmt || spec.fmt || String)(spec.line.values[i]) });
      tipContent(tip, spec.tipLabels ? spec.tipLabels[i] : spec.labels[i], rows);
      tip.classList.add('show');
      placeTip(box, tip, padL + band * i + band / 2, H / 3);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { hl.style.display = 'none'; tip.classList.remove('show'); });
    if (spec.onPick) hit.addEventListener('click', e => {
      const r = svg.getBoundingClientRect();
      spec.onPick(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - padL) / band))));
    });
    box.prepend(svg);
  }, H);
  return box;
}

/* ═══ Ciambella ══════════════════════════════════════════════════════════
   spec: { items:[{label,value,color}], size, thickness, center:{value,label}, fmt, onPick } */
export function donut(spec) {
  const size = spec.size || 180, th = spec.thickness || 22;
  const total = spec.items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const r = (size - th) / 2, cx = size / 2, cy = size / 2;
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': spec.title || 'Composizione' });
  svg.append(s('circle', { cx, cy, r, fill: 'none', 'stroke-width': th, class: 'donut-track' }));
  const box = h('div.donut', { style: { width: size + 'px', height: size + 'px' } });
  const cVal = h('div.donut-val', spec.center?.value ?? '');
  const cLab = h('div.donut-lab', spec.center?.label ?? '');
  if (total > 0) {
    let a0 = -Math.PI / 2;
    const gap = spec.items.filter(i => i.value > 0).length > 1 ? Math.min(0.06, 2.2 / r) : 0;
    for (const it of spec.items) {
      if (it.value <= 0) continue;
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.001, a1 - gap / 2);
      const large = s1 - s0 > Math.PI ? 1 : 0;
      const d = frac >= 0.9999
        ? `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}`
        : `M${cx + r * Math.cos(s0)},${cy + r * Math.sin(s0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(s1)},${cy + r * Math.sin(s1)}`;
      const p = s('path', { d, fill: 'none', 'stroke-width': th, class: 'donut-seg' }, { stroke: it.color });
      p.addEventListener('pointerenter', () => {
        cVal.textContent = spec.mask ? '•••' : (spec.fmt || String)(it.value);
        cLab.textContent = `${it.label} · ${(frac * 100).toFixed(frac < 0.1 ? 1 : 0).replace('.', ',')}%`;
        p.classList.add('on');
      });
      p.addEventListener('pointerleave', () => { cVal.textContent = spec.center?.value ?? ''; cLab.textContent = spec.center?.label ?? ''; p.classList.remove('on'); });
      if (spec.onPick) p.addEventListener('click', () => spec.onPick(it));
      svg.append(p);
      a0 = a1;
    }
  }
  box.append(svg, h('div.donut-center', cVal, cLab));
  return box;
}

/** Linea piccola per le righe e i riquadri. */
export function sparkline(values, { color = 'var(--c1)', width = 72, height = 28, area = true } = {}) {
  const v = values.filter(x => x != null && Number.isFinite(x));
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' });
  if (v.length < 2) return svg;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * (width - 4) + 2, height - 3 - ((x - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  if (area) svg.append(s('path', { d: d + `L${pts[pts.length - 1][0]},${height}L${pts[0][0]},${height}Z`, class: 'area' }, { fill: color }));
  svg.append(s('path', { d, class: 'line' }, { stroke: color }));
  return svg;
}

/** Colori delle serie (variabili del tema, già scelti per daltonici e per i due temi). */
export const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
