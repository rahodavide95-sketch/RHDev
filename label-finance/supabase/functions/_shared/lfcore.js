/* ============================================================================
   core.js — Calcoli puri di Label Finance (nessun accesso al DOM)
   Usato dall'app (window.LFCore) e dai test Node (require). Contiene:
   importi e date dei CSV, date locali, collegamento movimenti→release,
   royalty, recoupment, pagamenti, statement, deduplica import, unione dei
   dati tra dispositivi (sync) e controllo delle immagini.
   NB: la Edge Function supabase/functions/artist-statement replica
   computeStatement: se cambi la formula, aggiornala anche lì.
   ============================================================================ */
(function(root){
  'use strict';
  const C = {};

  /* ---------- Date in ora LOCALE (mai toISOString: in Italia sposta il giorno) ---------- */
  const pad2 = n => String(n).padStart(2,'0');
  C.ymd = d => d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  C.today = () => C.ymd(new Date());
  C.parseYmd = s => { const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||''); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };
  C.daysInMonth = (y, m0) => new Date(y, m0+1, 0).getDate();
  C.addDays = (s, n) => { const d=C.parseYmd(s); if(!d) return s; d.setDate(d.getDate()+(n||0)); return C.ymd(d); };
  // Aggiunge mesi tenendo il giorno di riferimento (31/01 → 28/02 → 31/03), senza sforare nel mese dopo.
  C.addMonths = (s, n, anchorDay) => {
    const d=C.parseYmd(s); if(!d) return s;
    const day=anchorDay||d.getDate();
    const t=new Date(d.getFullYear(), d.getMonth()+(n||0), 1);
    t.setDate(Math.min(day, C.daysInMonth(t.getFullYear(), t.getMonth())));
    return C.ymd(t);
  };
  // Prossima scadenza di una regola ricorrente (weekly | monthly | yearly).
  C.addPeriod = (s, freq, anchorDay) => {
    if(freq==='weekly') return C.addDays(s, 7);
    if(freq==='yearly') return C.addMonths(s, 12, anchorDay);
    return C.addMonths(s, 1, anchorDay);
  };

  /* ---------- Date dei CSV ---------- */
  const MONTHS = { jan:1,january:1,gen:1,gennaio:1, feb:2,february:2,febbraio:2, mar:3,march:3,marzo:3,
    apr:4,april:4,aprile:4, may:5,mag:5,maggio:5, jun:6,june:6,giu:6,giugno:6, jul:7,july:7,lug:7,luglio:7,
    aug:8,august:8,ago:8,agosto:8, sep:9,sept:9,september:9,set:9,settembre:9, oct:10,october:10,ott:10,ottobre:10,
    nov:11,november:11,novembre:11, dec:12,december:12,dic:12,dicembre:12 };
  function validYmd(y, m, d){
    if(!(y>=1900 && y<=2200) || !(m>=1 && m<=12) || !(d>=1 && d<=C.daysInMonth(y, m-1))) return '';
    return y+'-'+pad2(m)+'-'+pad2(d);
  }
  const SLASH_RE = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?!\d)/;
  // fmt: auto | dmy | mdy | ymd. In "auto" le date ambigue (es. 03/04) sono lette giorno/mese.
  C.parseDate = function(raw, fmt){
    fmt = fmt || 'auto';
    if(raw==null || raw==='') return '';
    if(raw instanceof Date) return isNaN(raw) ? '' : C.ymd(raw);
    const s=String(raw).trim(); if(!s) return '';
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?(?!\d)/);     // 2024-01-05 · 2024/01/05 · 2024-01
    if(m) return validYmd(+m[1], +m[2], m[3] ? +m[3] : 1);
    m = s.match(SLASH_RE);                                                   // 05/01/2024 · 1/5/24
    if(m){
      const a=+m[1], b=+m[2]; let y=+m[3]; if(m[3].length<=2) y+=2000;
      const f = (fmt==='mdy' || fmt==='dmy') ? fmt : (a>12 ? 'dmy' : b>12 ? 'mdy' : 'dmy');
      let day = f==='mdy' ? b : a, mon = f==='mdy' ? a : b;
      if(mon>12 && day<=12){ const x=day; day=mon; mon=x; }
      return validYmd(y, mon, day);
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);                                 // 20240105
    if(m) return validYmd(+m[1], +m[2], +m[3]);
    const low = s.toLowerCase();
    const words = low.match(/[a-zà-ü]+/g) || [];
    let mon = 0;
    for(const w of words){ if(MONTHS[w]){ mon=MONTHS[w]; break; } if(w.length>3 && MONTHS[w.slice(0,3)]){ mon=MONTHS[w.slice(0,3)]; break; } }
    if(mon){                                                                 // January 2024 · Jan 5, 2024 · 5 gennaio 2024
      const nums=(low.match(/\d+/g)||[]).map(Number);
      const y=nums.find(n=>n>=1900 && n<=2200);
      const d=nums.find(n=>n>=1 && n<=31);
      if(y) return validYmd(y, mon, d||1);
    }
    const d=new Date(s);
    return isNaN(d) ? '' : C.ymd(d);
  };
  // Formato giorno/mese di un intero file: basta una data con giorno > 12 per capirlo.
  C.detectDateFormat = function(values){
    let dmy=0, mdy=0;
    for(const v of values||[]){
      const m=String(v==null?'':v).trim().match(SLASH_RE); if(!m) continue;
      if(+m[1]>12) dmy++; else if(+m[2]>12) mdy++;
    }
    if(mdy && !dmy) return 'mdy';
    if(dmy && !mdy) return 'dmy';
    return mdy>dmy ? 'mdy' : 'dmy';
  };

  /* ---------- Importi dei CSV ---------- */
  // dec: separatore decimale noto ('.' | ',') oppure 'auto'/undefined.
  C.parseAmount = function(raw, dec){
    if(raw==null) return 0;
    if(typeof raw==='number') return isFinite(raw) ? raw : 0;
    let s=String(raw).trim(); if(!s) return 0;
    s=s.replace(/[−‒–—]/g,'-');
    if(/^-?\d+(\.\d+)?e[-+]?\d+$/i.test(s)){ const n=parseFloat(s); return isFinite(n)?n:0; }   // 3.4E-05
    const first=s.search(/\d/); if(first<0) return 0;
    let last=-1; for(let i=s.length-1;i>=0;i--){ if(/\d/.test(s[i])){ last=i; break; } }
    const neg = /^\(.*\)$/.test(s) || s.slice(0,first).includes('-') || s.slice(last+1).includes('-');
    s=s.replace(/[^\d.,]/g,'');
    const lc=s.lastIndexOf(','), ld=s.lastIndexOf('.');
    let out;
    if(lc>-1 && ld>-1){
      out = lc>ld ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    } else if(lc>-1 || ld>-1){
      const sep = lc>-1 ? ',' : '.';
      const parts = s.split(sep), count = parts.length-1;
      let isDecimal;
      if(count>1) isDecimal=false;                                          // 1.234.567 → migliaia
      else {
        const k=parts[1].length, intPart=parts[0];
        if(k!==3 || intPart==='' || /^0+$/.test(intPart)) isDecimal=true;   // 0,0034 · 12,5 · 0.123 → sempre decimale
        else if(dec===',' || dec==='.') isDecimal = (sep===dec);            // 1.234 / 1,234: decide il formato del file
        else isDecimal = (sep==='.');                                       // senza indizi: punto = decimale, virgola = migliaia
      }
      out = isDecimal ? parts.join('.') : parts.join('');
    } else out=s;
    const n=parseFloat(out);
    if(!isFinite(n)) return 0;
    return neg ? -n : n;
  };
  // Separatore decimale usato in un file, deciso guardando tutte le celle degli importi.
  C.detectDecimalSep = function(values){
    let comma=0, dot=0;
    for(const v of values||[]){
      if(v==null) continue;
      const s=String(v).replace(/[^\d.,]/g,''); if(!s) continue;
      const lc=s.lastIndexOf(','), ld=s.lastIndexOf('.');
      if(lc>-1 && ld>-1){ if(lc>ld) comma+=3; else dot+=3; continue; }
      if(lc<0 && ld<0) continue;
      const sep = lc>-1 ? ',' : '.', parts=s.split(sep);
      if(parts.length>2){ if(sep===',') dot+=2; else comma+=2; continue; }
      const k=parts[1].length;
      if(k!==3 || /^0*$/.test(parts[0])){ if(sep===',') comma++; else dot++; }
    }
    if(!comma && !dot) return null;
    return comma>dot ? ',' : '.';
  };

  /* ---------- Chiavi e normalizzazioni ---------- */
  const norm = s => String(s==null?'':s).trim().toLowerCase();
  const digits = s => String(s==null?'':s).replace(/\D/g,'');
  const upcKey = s => digits(s).replace(/^0+/,'');          // UPC a 12 cifre = EAN a 13 con lo zero davanti
  // Chiave unica di un artista: stesso nome a meno di maiuscole e spazi.
  C.artKey = s => String(s==null?'':s).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  C.toEur = (rates, n, cur) => {
    const r=(rates||{})[String(cur||'EUR').toUpperCase()];
    return (Number(n)||0) * (r==null ? 1 : (Number(r)||0));
  };
  C.inRange = (d, from, to) => { d=d||''; return (!from || d>=from) && (!to || d<=to); };

  /* ---------- Collegamento movimento → release (indice: niente ricerche lineari) ---------- */
  C.relIndex = function(releases){
    const byCat=new Map(), byUpc=new Map(), byIsrc=new Map(), byTitle=new Map(), trackSplits=new Map();
    for(const r of releases||[]){
      if(!r) continue;
      const c=norm(r.catalog); if(c && !byCat.has(c)) byCat.set(c, r);
      const u=upcKey(r.upc); if(u && !byUpc.has(u)) byUpc.set(u, r);
      const t=norm(r.title); if(t && !byTitle.has(t)) byTitle.set(t, r);
      for(const tr of r.tracks||[]){
        const i=norm(tr && tr.isrc); if(!i) continue;
        if(!byIsrc.has(i)) byIsrc.set(i, r);
        if(tr.splits && tr.splits.length && !trackSplits.has(i)) trackSplits.set(i, {rel:r, splits:tr.splits});
      }
    }
    return {byCat, byUpc, byIsrc, byTitle, trackSplits};
  };
  C.releaseForTx = function(idx, t){
    const c=norm(t.catalog), u=upcKey(t.upc||t.code), i=norm(t.isrc), p=norm(t.product);
    return (c && idx.byCat.get(c)) || (u && idx.byUpc.get(u)) || (i && idx.byIsrc.get(i)) || (p && idx.byTitle.get(p)) || null;
  };
  // Release e quote applicabili: prima la traccia (ISRC) con quote proprie, poi la release.
  C.splitsForTx = function(idx, t){
    const iso=norm(t.isrc), rel=C.releaseForTx(idx, t);
    if(rel){
      if(iso && rel.tracks){ const tr=rel.tracks.find(x=>norm(x.isrc)===iso && x.splits && x.splits.length); if(tr) return {rel, splits:tr.splits}; }
      return {rel, splits:rel.splits||[]};
    }
    if(iso){ const m=idx.trackSplits.get(iso); if(m) return m; }
    return null;
  };

  /* ---------- Royalty ---------- */
  // Quote per artista di un movimento, raggruppate per chiave (se un nome compare due volte si sommano).
  function sharesOf(splits){
    const by=new Map();
    for(const s of splits||[]){
      const k=C.artKey(s && s.name); if(!k) continue;
      const cur=by.get(k) || {key:k, name:String(s.name).trim(), pct:0};
      cur.pct += (+s.pct||0); by.set(k, cur);
    }
    return [...by.values()];
  }
  const incomeOf = label => (label.transactions||[]).filter(t=>t && t.kind==='income');
  // { byArtist: {chiave: {name,total,byRelease:{catalogo:importo}}}, labelTotal }
  C.computeRoyalties = function(label, opt){
    opt=opt||{}; const idx=opt.idx||C.relIndex(label.releases);
    const byArtist={}; let labelTotal=0;
    for(const t of incomeOf(label)){
      if(!C.inRange(t.date, opt.from, opt.to)) continue;
      const eur=C.toEur(label.rates, t.net, t.currency);
      const m=C.splitsForTx(idx, t);
      const sh=m ? sharesOf(m.splits) : [];
      if(!sh.length){ labelTotal+=eur; continue; }
      let assigned=0;
      const relKey=(m.rel && (m.rel.catalog || m.rel.title)) || '—';
      for(const s of sh){
        const share=eur*s.pct/100; assigned+=share;
        const a=byArtist[s.key] || (byArtist[s.key]={key:s.key, name:s.name, total:0, byRelease:{}});
        a.total+=share; a.byRelease[relKey]=(a.byRelease[relKey]||0)+share;
      }
      labelTotal += eur-assigned;
    }
    return {byArtist, labelTotal};
  };
  // Royalty maturate per artista fino a una data (inclusa) o di sempre: {chiave: {name,total}}
  C.royaltyTotals = function(label, opt){
    opt=opt||{}; const idx=opt.idx||C.relIndex(label.releases); const out={};
    for(const t of incomeOf(label)){
      const d=t.date||'';
      if(opt.until && d>opt.until) continue;
      if(opt.before && !(d<opt.before)) continue;
      const m=C.splitsForTx(idx, t); if(!m) continue;
      const eur=C.toEur(label.rates, t.net, t.currency);
      for(const s of sharesOf(m.splits)){ const a=out[s.key]||(out[s.key]={name:s.name, total:0}); a.total+=eur*s.pct/100; }
    }
    return out;
  };
  // Somma per artista di una lista {artist, amount, date}; until = solo voci con data ≤ until (o senza data).
  function sumByArtist(list, until, pick){
    const out={};
    for(const r of list||[]){
      if(!r) continue;
      if(until && r.date && r.date>until) continue;
      const k=C.artKey(r.artist); if(!k) continue;
      const a=out[k]||(out[k]={name:String(r.artist).trim(), advance:0, cost:0, total:0});
      const v=+r.amount||0; a.total+=v;
      if(pick) pick(a, r, v);
    }
    return out;
  }
  C.recoupByArtist = (label, until) => sumByArtist(label.recoup, until, (a,r,v)=>{ if(r.kind==='advance') a.advance+=v; else a.cost+=v; });
  C.payoutsByArtist = (label, until) => sumByArtist(label.payouts, until);

  // Situazione di ogni artista ad oggi: royalty, recoupment, già pagato, saldo da pagare.
  C.artistBalances = function(label, opt){
    opt=opt||{}; const idx=opt.idx||C.relIndex(label.releases);
    const roy=C.royaltyTotals(label, {idx}), rec=C.recoupByArtist(label), paid=C.payoutsByArtist(label);
    const keys=new Set([...Object.keys(roy), ...Object.keys(rec), ...Object.keys(paid)]);
    const out=[];
    for(const k of keys){
      const royalties=(roy[k]&&roy[k].total)||0, recoupable=(rec[k]&&rec[k].total)||0, p=(paid[k]&&paid[k].total)||0;
      const earned=Math.max(0, royalties-recoupable), bal=earned-p;
      out.push({ key:k, name:(roy[k]||rec[k]||paid[k]).name, royalties, recoupable,
        advance:(rec[k]&&rec[k].advance)||0, cost:(rec[k]&&rec[k].cost)||0,
        recouped:Math.min(royalties, recoupable), unrecouped:Math.max(0, recoupable-royalties),
        paid:p, payable:Math.max(0, bal), overpaid:Math.max(0, -bal) });
    }
    return out;
  };

  // Statement di un artista per un periodo [from, to] (date ISO, entrambe facoltative).
  C.computeStatement = function(label, name, from, to, opt){
    opt=opt||{}; const idx=opt.idx||C.relIndex(label.releases);
    from=from||null; to=to||null;
    const key=C.artKey(name); const lines=[]; let total=0;
    for(const t of incomeOf(label)){
      const d=t.date||''; if(!C.inRange(d, from, to)) continue;
      const m=C.splitsForTx(idx, t); if(!m) continue;
      const sp=sharesOf(m.splits).find(s=>s.key===key); if(!sp) continue;
      const eur=C.toEur(label.rates, t.net, t.currency), share=eur*sp.pct/100; total+=share;
      lines.push({ date:d, product:t.product||(m.rel&&m.rel.title)||'', catalog:(m.rel&&m.rel.catalog)||t.catalog||'', gross:eur, pct:sp.pct, share });
    }
    lines.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const lifeEnd=((C.royaltyTotals(label, {idx, until:to})[key])||{total:0}).total;     // fino alla fine del periodo, non oltre
    const before=from ? ((C.royaltyTotals(label, {idx, before:from})[key])||{total:0}).total : 0;
    const recoupable=((C.recoupByArtist(label, to)[key])||{total:0}).total;
    const paidToDate=((C.payoutsByArtist(label, to)[key])||{total:0}).total;
    const paidInPeriod=(label.payouts||[]).filter(p=>p && C.artKey(p.artist)===key && C.inRange(p.date, from, to)).reduce((s,p)=>s+(+p.amount||0),0);
    const netPay=Math.max(0, Math.max(0, lifeEnd-recoupable) - Math.max(0, before-recoupable));
    const bal=Math.max(0, lifeEnd-recoupable) - paidToDate;
    return { name, key, from, to, lines, total, recoupable,
      recouped:Math.min(lifeEnd, recoupable), residual:Math.max(0, recoupable-lifeEnd),
      netPay, paidInPeriod, paidToDate, balance:Math.max(0, bal), overpaid:Math.max(0, -bal) };
  };

  /* ---------- Import: firma di un movimento e deduplica ---------- */
  C.txSig = t => [ t.kind, t.date||'', norm(t.platform), norm(t.catalog), norm(t.product), norm(t.isrc), digits(t.upc||t.code),
    norm(t.territory), Math.round((+t.net||0)*1e6), +t.qty||0, String(t.currency||'').toUpperCase() ].join('|');
  // Scarta solo le righe già presenti tra i movimenti esistenti. Righe uguali nello stesso file
  // (es. stessa traccia in due paesi) restano: si conta quante volte ogni firma esiste già.
  C.dedupAgainst = function(existing, incoming){
    const have=new Map();
    for(const t of existing||[]){ const s=C.txSig(t); have.set(s, (have.get(s)||0)+1); }
    const kept=[]; let skipped=0;
    for(const t of incoming||[]){
      const s=C.txSig(t), n=have.get(s)||0;
      if(n>0){ have.set(s, n-1); skipped++; } else kept.push(t);
    }
    return {kept, skipped};
  };

  /* ---------- Immagini: accetta solo data URL di immagini o file locali ---------- */
  const IMG_DATA_RE=/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=\s]+$/;
  const IMG_LOCAL_RE=/^[\w\-.\/]+(\?[\w=&.\-]*)?$/;
  C.safeImgSrc = s => { s=String(s==null?'':s).trim(); if(!s) return ''; return (IMG_DATA_RE.test(s) || (IMG_LOCAL_RE.test(s) && !s.includes('..'))) ? s : ''; };

  /* ---------- Unione dei dati tra dispositivi (sync) ---------- */
  // Unione a tre vie: base = ultima versione sincronizzata, local = questo dispositivo,
  // remote = cloud. Gli elenchi con "id" si uniscono elemento per elemento; se lo
  // stesso elemento è cambiato da entrambe le parti vince questo dispositivo.
  const ID_ARRAYS=new Set(['transactions','releases','artists','tasks','contracts','merch','planning','events','supports','recurring','recoup','payouts','contractTombstones']);
  function stable(v){
    if(v===undefined) return 'u';
    if(v===null || typeof v!=='object') return JSON.stringify(v);
    if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
    return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  }
  C.stableStringify = stable;
  const same = (a,b) => stable(a)===stable(b);
  const isPlain = v => v!==null && typeof v==='object' && !Array.isArray(v);
  function pickVal(b, l, r){ if(same(l,r)) return l; if(same(l,b)) return r; if(same(r,b)) return l; return l; }
  function mergeById(bArr, lArr, rArr, itemMerge){
    const idMap=a=>{ const m=new Map(); for(const x of a||[]) if(x && x.id!=null) m.set(x.id, x); return m; };
    const bm=idMap(bArr), lm=idMap(lArr);
    const out=[], seen=new Set();
    for(const r of rArr||[]){
      if(!r || r.id==null){ out.push(r); continue; }
      if(seen.has(r.id)) continue; seen.add(r.id);
      const l=lm.get(r.id), b=bm.get(r.id);
      if(l===undefined){ if(b!==undefined && same(b, r)) continue; out.push(r); }   // eliminato qui e invariato nel cloud → resta eliminato
      else out.push(itemMerge ? itemMerge(b, l, r) : pickVal(b, l, r));
    }
    for(const l of lArr||[]){
      if(!l || l.id==null){ if(!(rArr||[]).some(x=>same(x, l))) out.push(l); continue; }
      if(seen.has(l.id)) continue; seen.add(l.id);
      const b=bm.get(l.id);
      if(b!==undefined && same(b, l)) continue;                                      // eliminato nel cloud e invariato qui
      out.push(l);
    }
    return out;
  }
  function mergeObj(b, l, r){
    b=isPlain(b)?b:{}; l=isPlain(l)?l:{}; r=isPlain(r)?r:{};
    const out={};
    for(const k of new Set([...Object.keys(r), ...Object.keys(l)])){
      const bv=b[k], lv=l[k], rv=r[k];
      let v;
      if(ID_ARRAYS.has(k) && (Array.isArray(lv) || Array.isArray(rv))) v=mergeById(bv, lv||[], rv||[]);
      else if(isPlain(lv) && isPlain(rv)) v=mergeObj(bv, lv, rv);
      else v=pickVal(bv, lv, rv);
      if(v!==undefined) out[k]=v;
    }
    return out;
  }
  C.mergeAccounts = function(base, local, remote){
    if(!isPlain(remote)) return local;
    if(!isPlain(local)) return remote;
    base=isPlain(base)?base:{};
    const top=mergeObj(Object.assign({}, base, {labels:undefined}), Object.assign({}, local, {labels:undefined}), Object.assign({}, remote, {labels:undefined}));
    top.labels=mergeById(base.labels||[], local.labels||[], remote.labels||[], mergeObj);
    if(!top.labels.length) top.labels=(local.labels&&local.labels.length) ? local.labels : (remote.labels||[]);
    if(!top.labels.some(x=>x && x.id===top.activeLabel) && top.labels[0]) top.activeLabel=top.labels[0].id;
    return top;
  };

  root.LFCore = C;
  if(typeof module!=='undefined' && module.exports) module.exports = C;
})(typeof globalThis!=='undefined' ? globalThis : (typeof window!=='undefined' ? window : this));
