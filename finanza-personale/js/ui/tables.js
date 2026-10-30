/* Colonne allargabili come in Excel: si trascina il bordo destro dell'intestazione; doppio clic
   per tornare alla larghezza di partenza. Le larghezze restano su questo dispositivo (rhf-tables):
   solo numeri di pixel, nessun dato. Vale per le tabelle con data-tid. */

let saved = null;
const load = () => { if (!saved) { try { saved = JSON.parse(localStorage.getItem('rhf-tables') || '{}') || {}; } catch { saved = {}; } } return saved; };
const store = () => { try { localStorage.setItem('rhf-tables', JSON.stringify(saved)); } catch { /* navigazione privata */ } };
const setW = (th, w) => { for (const k of ['width', 'minWidth', 'maxWidth']) th.style[k] = w ? w + 'px' : ''; };

export function enhanceTables(root) {
  const S = load();
  for (const t of root.querySelectorAll('table[data-tid]')) {
    const id = t.dataset.tid;
    t.querySelectorAll('thead tr:first-child > th').forEach((th, i) => {
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
