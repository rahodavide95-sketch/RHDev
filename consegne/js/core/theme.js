/* Aspetto di un modulo: colori, caratteri, forme, immagine di testata.
   Solo valori controllati (colori #rrggbb, caratteri da una lista, numeri in un intervallo):
   diventano variabili CSS impostate da JavaScript, mai testo inserito in un foglio di stile. */

import { COLOR_RE } from './richtext.js';

export const FONTS = {
  inter: { label: 'Inter (moderno)', css: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  system: { label: 'Sistema', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  grotesk: { label: 'Grottesco stretto', css: "'Arial Narrow', 'Helvetica Neue Condensed', 'Roboto Condensed', 'Inter', sans-serif" },
  serif: { label: 'Serif elegante', css: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  classic: { label: 'Serif classico', css: "Georgia, 'Times New Roman', Times, serif" },
  mono: { label: 'Macchina da scrivere', css: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
  rounded: { label: 'Arrotondato', css: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Inter', system-ui, sans-serif" },
};

export const PRESETS = {
  notte: { label: 'Notte', bg: '#0b0b0f', bg2: '#1c1630', card: '#16161d', text: '#f2f1f6', accent: '#a78bfa', bgStyle: 'glow', cardStyle: 'glass' },
  carta: { label: 'Carta', bg: '#f3efe7', bg2: '#e9e1d2', card: '#fffdf8', text: '#1d1a16', accent: '#b4532a', bgStyle: 'solid', cardStyle: 'border', titleFont: 'serif' },
  acido: { label: 'Acido', bg: '#050505', bg2: '#0f1a05', card: '#0d0d0d', text: '#eaffd0', accent: '#c6ff3d', bgStyle: 'gradient', cardStyle: 'border', titleFont: 'grotesk', titleCase: 'upper' },
  studio: { label: 'Studio', bg: '#eceef5', bg2: '#e2ecff', card: '#ffffff', text: '#11131a', accent: '#6d28d9', bgStyle: 'glow', cardStyle: 'shadow' },
  mono: { label: 'Bianco e nero', bg: '#ffffff', bg2: '#f2f2f2', card: '#ffffff', text: '#0a0a0a', accent: '#0a0a0a', bgStyle: 'solid', cardStyle: 'border', titleFont: 'grotesk', titleCase: 'upper', radius: 0 },
};

export const DEFAULT_THEME = {
  preset: 'notte', bg: '#0b0b0f', bg2: '#1c1630', card: '#16161d', text: '#f2f1f6', accent: '#a78bfa',
  bgStyle: 'glow', cardStyle: 'glass', button: 'fill',
  titleFont: 'inter', bodyFont: 'inter', titleCase: 'normal', size: 'm', radius: 16, width: 'm',
  header: '', headerHeight: 180, headerFit: 'cover', logo: true,
};

const pick = (v, allowed, d) => allowed.includes(v) ? v : d;
const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
const color = (v, d) => typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : d;
export const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMAGE = 700000;
export const safeImage = s => typeof s === 'string' && s.length <= MAX_IMAGE && IMAGE_RE.test(s) ? s : '';

export function sanitizeTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  const d = DEFAULT_THEME;
  return {
    preset: typeof t.preset === 'string' && (PRESETS[t.preset] || t.preset === 'custom') ? t.preset : 'custom',
    bg: color(t.bg, d.bg), bg2: color(t.bg2, d.bg2), card: color(t.card, d.card), text: color(t.text, d.text), accent: color(t.accent, d.accent),
    bgStyle: pick(t.bgStyle, ['solid', 'gradient', 'glow'], d.bgStyle),
    cardStyle: pick(t.cardStyle, ['shadow', 'border', 'flat', 'glass'], d.cardStyle),
    button: pick(t.button, ['fill', 'outline', 'pill'], d.button),
    titleFont: pick(t.titleFont, Object.keys(FONTS), d.titleFont),
    bodyFont: pick(t.bodyFont, Object.keys(FONTS), d.bodyFont),
    titleCase: pick(t.titleCase, ['normal', 'upper'], d.titleCase),
    size: pick(t.size, ['s', 'm', 'l'], d.size),
    radius: num(t.radius, 0, 28, d.radius),
    width: pick(t.width, ['s', 'm', 'l'], d.width),
    header: safeImage(t.header),
    headerHeight: num(t.headerHeight, 80, 420, d.headerHeight),
    headerFit: pick(t.headerFit, ['cover', 'contain'], d.headerFit),
    logo: t.logo !== false,
  };
}

export function applyPreset(theme, key) {
  const p = PRESETS[key];
  if (!p) return sanitizeTheme(theme);
  const { label, ...vals } = p;
  return sanitizeTheme({ ...theme, titleFont: 'inter', titleCase: 'normal', radius: DEFAULT_THEME.radius, ...vals, preset: key });
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
    '--f-size': { s: '15px', m: '16px', l: '17.5px' }[t.size],
    '--f-width': { s: '620px', m: '720px', l: '860px' }[t.width],
    '--f-header-h': t.headerHeight + 'px',
    '--f-scheme': dark ? 'dark' : 'light',
  };
}
