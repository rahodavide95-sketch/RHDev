/* Colonne allargabili come in Excel: si trascina il bordo destro dell'intestazione; doppio clic
   per tornare alla larghezza di partenza. Le larghezze restano su questo dispositivo (rhf-tables):
   solo numeri di pixel, nessun dato. Vale per le tabelle con data-tid. */

import { h } from './dom.js';
import { S as Store } from '../session.js';
import { setColName } from '../actions.js';

/* Nomi delle intestazioni a piacere (D: "i nomi delle intestazioni delle tabelle li voglio centrali. ma
   anche qui, dammi la possibilità di modificarli come voglio"): si tocca l'intestazione, si scrive il
   nome nuovo. Si salvano nei dati (settings.colNames, "tabella|colonna"), quindi anche sugli altri
   dispositivi. La colonna è data-col (Net Worth, Entrate e uscite) o il nome di partenza. */
let pop = null;
const closePop = () => { if (pop) { pop.remove(); pop = null; } };
addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target)) closePop(); }, true);
// si chiude scorrendo solo se l'intestazione si è davvero spostata (non per il piccolo scorrimento del trackpad)
addEventListener('scroll', e => { if (pop && !pop.contains(e.target) && pop.anchor && Math.abs(pop.anchor.getBoundingClientRect().top - pop.anchorTop) > 60) closePop(); }, true);
function renamePop(th, key, orig) {
  closePop();
  const now = Store.state?.settings?.colNames?.[key] || orig;
  const inp = h('input.input', { type: 'text', value: now, maxlength: 40, 'aria-label': 'Nome della colonna' });
  const save = v => { closePop(); setColName(key, v === orig ? '' : v); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(inp.value.trim()); } });
  pop = h('div.name-pop', { role: 'dialog', 'aria-label': 'Rinomina la colonna' },
    h('div.name-pop-t', 'Nome della colonna'),
    inp,
    h('div.name-pop-b',
      Store.state?.settings?.colNames?.[key] ? h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => save('') }, `Torna a «${orig || 'vuoto'}»`) : null,
      h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => save(inp.value.trim()) }, 'Salva')));
  document.body.append(pop);
  const r = th.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.anchor = th; pop.anchorTop = r.top;
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  pop.style.top = (r.bottom + ph + 12 > innerHeight ? Math.max(8, r.top - ph - 8) : r.bottom + 8) + 'px';
  inp.focus(); inp.select();
}

let saved = null;
const load = () => { if (!saved) { try { saved = JSON.parse(localStorage.getItem('rhf-tables') || '{}') || {}; } catch { saved = {}; } } return saved; };
const store = () => { try { localStorage.setItem('rhf-tables', JSON.stringify(saved)); } catch { /* navigazione privata */ } };
const setW = (th, w) => { for (const k of ['width', 'minWidth', 'maxWidth']) th.style[k] = w ? w + 'px' : ''; };

export function enhanceTables(root) {
  const S = load();
  for (const t of root.querySelectorAll('table[data-tid]')) {
    const id = t.dataset.tid;
    t.querySelectorAll('thead tr:first-child > th').forEach((th, i) => {
      // nome scelto da D al posto di quello di partenza, e un tocco per cambiarlo
      if (th.dataset.orig == null) th.dataset.orig = th.textContent.trim();
      const orig = th.dataset.orig;
      if (orig || th.dataset.col) {
        const key = `${id.replace(/-fit$/, '')}|${th.dataset.col || orig}`;
        const name = Store.state?.settings?.colNames?.[key];
        if (name && !th.querySelector('.col-grip')) th.textContent = name;
        if (!th.classList.contains('th-rename')) {
          th.classList.add('th-rename');
          th.title = (th.title ? th.title + ' · ' : '') + 'Tocca per rinominare la colonna';
          th.addEventListener('click', e => { if (!e.target.closest('.col-grip')) renamePop(th, key, orig); });
        }
      }
      const w = S[id]?.[i];
      if (w) setW(th, w);
      if (th.querySelector('.col-grip')) return;
      const g = document.createElement('span');
      g.className = 'col-grip';
      g.title = 'Trascina per allargare · doppio clic per tornare com\'era';
      g.addEventListener('click', e => e.stopPropagation());
      g.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
        g.setPointerCapture(e.pointerId);
        t.classList.add('resizing');
        const move = ev => setW(th, Math.max(56, Math.round(w0 + ev.clientX - x0)));
        const up = () => {
          g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
          t.classList.remove('resizing');
          (S[id] = S[id] || {})[i] = Math.round(th.getBoundingClientRect().width);
          store();
        };
        g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
      });
      g.addEventListener('dblclick', e => { e.stopPropagation(); setW(th, 0); if (S[id]) delete S[id][i]; store(); });
      th.append(g);
    });
  }
}
