/* Unione dei dati modificati su due dispositivi (sincronizzazione).
   Unione "a tre vie": si confrontano la versione locale e quella online con l'ultima
   versione comune (base). Per ogni elemento (conto, movimento, scadenza…):
   - cambiato solo da una parte → vince quella parte;
   - cambiato da entrambe → si uniscono i campi (per campo vince chi l'ha cambiato;
     se l'hanno cambiato tutti e due vince questo dispositivo);
   - eliminato da una parte e non toccato dall'altra → resta eliminato;
   - eliminato da una parte ma modificato dall'altra → resta (meglio non perdere dati).
   Senza base (primo collegamento) si sommano gli elementi di tutte e due. */

const eq = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isIdList = x => Array.isArray(x) && x.every(o => isObj(o) && typeof o.id === 'string');

function mergeList(base, local, remote) {
  const B = new Map((Array.isArray(base) ? base : []).filter(isObj).map(x => [x.id, x]));
  const L = new Map(local.map(x => [x.id, x]));
  const R = new Map(remote.map(x => [x.id, x]));
  const order = [...L.keys(), ...[...R.keys()].filter(k => !L.has(k))];
  const out = [];
  for (const id of order) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) out.push(merge3(b, l, r));
    else if (l) { if (!(b && eq(l, b))) out.push(l); }        // se era uguale alla base, l'altro l'ha eliminato
    else if (r) { if (!(b && eq(r, b))) out.push(r); }        // se era uguale alla base, l'ho eliminato io
  }
  return out;
}

/** Unione a tre vie di qualsiasi valore dei dati. base può mancare (null). */
export function merge3(base, local, remote) {
  if (eq(local, remote)) return local;
  if (base !== undefined && base !== null) {
    if (eq(local, base)) return remote;
    if (eq(remote, base)) return local;
  }
  if (isIdList(local) && isIdList(remote)) return mergeList(base, local, remote);
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const lv = local[k], rv = remote[k], bv = b[k];
      if (lv === undefined) { if (!(k in b) || !eq(rv, bv)) out[k] = rv; }
      else if (rv === undefined) { if (!(k in b) || !eq(lv, bv)) out[k] = lv; }
      else out[k] = merge3(bv, lv, rv);
    }
    return out;
  }
  return local;   // stesso valore cambiato da tutte e due le parti: vince questo dispositivo
}
