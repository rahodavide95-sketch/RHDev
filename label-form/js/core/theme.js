/* Aspetto di un modulo e del contratto: colori, caratteri, forme, misure, immagine di testata.
   Solo valori controllati (colori #rrggbb, caratteri da una lista, numeri in un intervallo):
   diventano variabili CSS impostate da JavaScript, mai testo inserito in un foglio di stile. */

import { COLOR_RE } from './richtext.js';

export const FONTS = {
  inter: { label: 'Inter (moderno)', css: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  dmsans: { label: 'DM Sans', css: "'DM Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  syne: { label: 'Syne (titoli)', css: "'Syne', 'DM Sans', 'Inter', system-ui, sans-serif" },
  system: { label: 'Sistema', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  grotesk: { label: 'Grottesco stretto', css: "'Arial Narrow', 'Helvetica Neue Condensed', 'Roboto Condensed', 'Inter', sans-serif" },
  serif: { label: 'Serif elegante', css: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  classic: { label: 'Serif classico', css: "Georgia, 'Times New Roman', Times, serif" },
  mono: { label: 'Macchina da scrivere', css: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
  rounded: { label: 'Arrotondato', css: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Inter', system-ui, sans-serif" },
};

export const PRESETS = {
  notte: { label: 'Scuro', bg: '#0b0b0f', bg2: '#1c1630', card: '#16161d', text: '#f2f1f6', accent: '#a78bfa', bgStyle: 'glow', cardStyle: 'glass' },
  chiaro: { label: 'Chiaro', bg: '#f4f4f7', bg2: '#ece8fb', card: '#ffffff', text: '#16161d', accent: '#6d28d9', bgStyle: 'solid', cardStyle: 'shadow' },
  minimal: { label: 'Minimal', bg: '#ffffff', bg2: '#ffffff', card: '#ffffff', text: '#0a0a0a', accent: '#0a0a0a', bgStyle: 'solid', cardStyle: 'flat', titleFont: 'dmsans', bodyFont: 'dmsans', radius: 2, button: 'outline' },
  carta: { label: 'Carta', bg: '#f3efe7', bg2: '#e9e1d2', card: '#fffdf8', text: '#1d1a16', accent: '#b4532a', bgStyle: 'solid', cardStyle: 'border', titleFont: 'serif' },
  acido: { label: 'Acido', bg: '#050505', bg2: '#0f1a05', card: '#0d0d0d', text: '#eaffd0', accent: '#c6ff3d', bgStyle: 'gradient', cardStyle: 'border', titleFont: 'grotesk', titleCase: 'upper' },
  studio: { label: 'Studio', bg: '#eceef5', bg2: '#e2ecff', card: '#ffffff', text: '#11131a', accent: '#6d28d9', bgStyle: 'glow', cardStyle: 'shadow' },
  mono: { label: 'Bianco e nero', bg: '#ffffff', bg2: '#f2f2f2', card: '#ffffff', text: '#0a0a0a', accent: '#0a0a0a', bgStyle: 'solid', cardStyle: 'border', titleFont: 'grotesk', titleCase: 'upper', radius: 0 },
};

const SIZE_PX = { s: 15, m: 16, l: 18 };
const WIDTH_PX = { s: 620, m: 720, l: 860 };

export const DEFAULT_THEME = {
  preset: 'notte', bg: '#0b0b0f', bg2: '#1c1630', card: '#16161d', text: '#f2f1f6', accent: '#a78bfa',
  bgStyle: 'glow', cardStyle: 'glass', button: 'fill',
  titleFont: 'inter', bodyFont: 'inter', titleCase: 'normal', size: 'm', radius: 16, width: 'm',
  fontPx: 16, widthPx: 720, titlePx: 32, titleAlign: 'left', cardPad: 24, fieldGap: 14,
  header: '', headerHeight: 180, headerFit: 'cover', logo: true, logoShape: 'square', logoSize: 48,
};

const pick = (v, allowed, d) => allowed.includes(v) ? v : d;
const num = (v, min, max, d) => { const n = Number(v); return v !== '' && v !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
const dec = (v, min, max, d) => { const n = Number(v); return v !== '' && v !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : d; };
const color = (v, d) => typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : d;
export const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMAGE = 700000;
export const safeImage = s => typeof s === 'string' && s.length <= MAX_IMAGE && IMAGE_RE.test(s) ? s : '';

export function sanitizeTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  const d = DEFAULT_THEME;
  const size = pick(t.size, ['s', 'm', 'l'], d.size);
  const width = pick(t.width, ['s', 'm', 'l'], d.width);
  return {
    preset: typeof t.preset === 'string' && (PRESETS[t.preset] || t.preset === 'custom') ? t.preset : 'custom',
    bg: color(t.bg, d.bg), bg2: color(t.bg2, d.bg2), card: color(t.card, d.card), text: color(t.text, d.text), accent: color(t.accent, d.accent),
    bgStyle: pick(t.bgStyle, ['solid', 'gradient', 'glow'], d.bgStyle),
    cardStyle: pick(t.cardStyle, ['shadow', 'border', 'flat', 'glass'], d.cardStyle),
    button: pick(t.button, ['fill', 'outline', 'pill'], d.button),
    titleFont: pick(t.titleFont, Object.keys(FONTS), d.titleFont),
    bodyFont: pick(t.bodyFont, Object.keys(FONTS), d.bodyFont),
    titleCase: pick(t.titleCase, ['normal', 'upper'], d.titleCase),
    size, width,
    radius: num(t.radius, 0, 28, d.radius),
    fontPx: num(t.fontPx, 12, 22, SIZE_PX[size]),
    widthPx: num(t.widthPx, 420, 1280, WIDTH_PX[width]),
    titlePx: num(t.titlePx, 18, 80, d.titlePx),
    titleAlign: pick(t.titleAlign, ['left', 'center', 'right'], d.titleAlign),
    cardPad: num(t.cardPad, 6, 64, d.cardPad),
    fieldGap: num(t.fieldGap, 0, 48, d.fieldGap),
    header: safeImage(t.header),
    headerHeight: num(t.headerHeight, 60, 600, d.headerHeight),
    headerFit: pick(t.headerFit, ['cover', 'contain'], d.headerFit),
    logo: t.logo !== false,
    logoShape: pick(t.logoShape, ['square', 'rounded', 'circle'], d.logoShape),
    logoSize: num(t.logoSize, 20, 240, d.logoSize),
  };
}

export function applyPreset(theme, key) {
  const p = PRESETS[key];
  if (!p) return sanitizeTheme(theme);
  const { label, ...vals } = p;
  return sanitizeTheme({ ...theme, titleFont: 'inter', bodyFont: 'inter', titleCase: 'normal', radius: DEFAULT_THEME.radius, button: 'fill', ...vals, preset: key });
}

/* ─── Colori ─── */
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(hex) {
  const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
/** Colore del testo sopra un colore pieno (bianco o quasi nero, quello che si legge meglio). */
export const onColor = hex => contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111';
export const isDark = hex => lum(hex) < 0.2;
export function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; }

/** Avvisi di leggibilità per chi disegna il modulo. */
export function themeWarnings(t) {
  const w = [];
  if (contrast(t.text, t.card) < 4.5) w.push('Il testo si legge poco sullo sfondo dei riquadri: scegli colori più diversi.');
  if (contrast(t.accent, t.card) < 2.2) w.push('Il colore principale si vede poco sui riquadri.');
  return w;
}

export const LOGO_RADIUS = { square: '0', rounded: '22%', circle: '50%' };

/** Variabili CSS del tema (valori già controllati). */
export function themeVars(theme) {
  const t = sanitizeTheme(theme);
  const dark = isDark(t.card);
  return {
    '--f-bg': t.bg, '--f-bg2': t.bg2, '--f-card': t.card, '--f-text': t.text, '--f-accent': t.accent,
    '--f-on-accent': onColor(t.accent),
    '--f-muted': rgba(t.text, 0.66), '--f-faint': rgba(t.text, 0.42),
    '--f-line': rgba(t.text, dark ? 0.14 : 0.16), '--f-field': rgba(t.text, dark ? 0.06 : 0.035),
    '--f-accent-soft': rgba(t.accent, dark ? 0.18 : 0.12),
    '--f-card-glass': rgba(t.card, 0.72),
    '--f-radius': t.radius + 'px', '--f-radius-sm': Math.max(0, Math.round(t.radius * 0.62)) + 'px',
    '--f-title-font': FONTS[t.titleFont].css, '--f-body-font': FONTS[t.bodyFont].css,
    '--f-title-case': t.titleCase === 'upper' ? 'uppercase' : 'none',
    '--f-title-spacing': t.titleCase === 'upper' ? '.04em' : '-.015em',
    '--f-size': t.fontPx + 'px',
    '--f-width': t.widthPx + 'px',
    '--f-title-size': t.titlePx + 'px',
    '--f-title-align': t.titleAlign,
    '--f-card-pad': t.cardPad + 'px',
    '--f-gap': t.fieldGap + 'px',
    '--f-header-h': t.headerHeight + 'px',
    '--f-logo-size': t.logoSize + 'px',
    '--f-logo-radius': LOGO_RADIUS[t.logoShape],
    '--f-scheme': dark ? 'dark' : 'light',
  };
}

/* ─── Formattazione del contratto ───
   Valori predefiniti = il contratto dell'etichetta (stesso testo, stessa impaginazione). */
export const CONTRACT_STYLE = {
  font: 'dmsans', titleFont: 'dmsans', size: 13.12, line: 162, align: 'j',
  text: '#333333', heading: '#15131f', accent: '#7c3aed',
  titleUpper: true, titleAlign: 'c', titleBar: true, titleSize: 132,
  headSize: 116, logoPos: 'r', logoH: 60, logoBg: 'auto', headLine: true, lineColor: '#d8d4e6',
  pad: 52, signs: 'row', paper: true,
};
export function sanitizeContractStyle(s) {
  s = s && typeof s === 'object' ? s : {};
  const d = CONTRACT_STYLE;
  return {
    font: pick(s.font, Object.keys(FONTS), d.font),
    titleFont: pick(s.titleFont, Object.keys(FONTS), d.titleFont),
    size: dec(s.size, 9, 20, d.size),
    line: num(s.line, 110, 240, d.line),
    align: pick(s.align, ['j', 'l'], d.align),
    text: color(s.text, d.text), heading: color(s.heading, d.heading), accent: color(s.accent, d.accent),
    titleUpper: s.titleUpper !== false,
    titleAlign: pick(s.titleAlign, ['c', 'l'], d.titleAlign),
    titleBar: s.titleBar !== false,
    titleSize: num(s.titleSize, 90, 260, d.titleSize),
    headSize: num(s.headSize, 80, 200, d.headSize),
    logoPos: pick(s.logoPos, ['l', 'c', 'r'], d.logoPos),
    logoH: num(s.logoH, 20, 160, d.logoH),
    logoBg: pick(s.logoBg, ['auto', 'none', 'dark', 'light'], d.logoBg),
    headLine: s.headLine !== false,
    lineColor: color(s.lineColor, d.lineColor),
    pad: num(s.pad, 12, 90, d.pad),
    signs: pick(s.signs, ['row', 'col'], d.signs),
    paper: s.paper !== false,
  };
}
export function contractVars(style) {
  const s = sanitizeContractStyle(style);
  return {
    '--cd-font': FONTS[s.font].css, '--cd-title-font': FONTS[s.titleFont].css,
    '--cd-size': s.size + 'px', '--cd-line': String(s.line / 100),
    '--cd-text': s.text, '--cd-heading': s.heading, '--cd-accent': s.accent, '--cd-rule': s.lineColor,
    '--cd-title-size': (s.titleSize / 100) + 'em', '--cd-head-size': (s.headSize / 100) + 'em',
    '--cd-logo-h': s.logoH + 'px', '--cd-pad-x': s.pad + 'px', '--cd-pad-y': Math.round(s.pad * 0.81) + 'px',
  };
}
