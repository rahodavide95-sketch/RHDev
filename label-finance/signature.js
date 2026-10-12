/* ============================================================================
   signature.js — riquadro firma condiviso (app e pagina di firma firma.html)
   La firma si può DISEGNARE al momento (mouse, dito, penna) oppure CARICARE da
   file (foto o immagine di una firma già pronta). In entrambi i casi il risultato
   è un PNG leggero (≤ ~280 KB, il limite accettato dal server), ritagliato attorno
   alla firma. Nelle immagini caricate lo sfondo chiaro del foglio diventa
   trasparente, così nel contratto non resta un riquadro bianco.
   Uso: const pad = LFSignature.attach(canvas)  →  pad.loadFile(file), pad.png(),
        pad.clear(), pad.isEmpty()
   ============================================================================ */
(function(root){
  'use strict';
  const MAX_CHARS=280000;            // lunghezza massima del data URL PNG
  const MAX_FILE=15*1024*1024;       // immagini più grandi di 15 MB: rifiutate

  // sfondo carta → trasparente. La "carta" è il livello di luminosità più chiaro
  // presente nell'immagine (95° percentile): funziona anche con foto un po' scure.
  function clearPaper(ctx, w, h){
    const img=ctx.getImageData(0,0,w,h), p=img.data;
    const hist=new Uint32Array(256); let n=0, transparent=0;
    for(let i=0;i<p.length;i+=4){
      if(p[i+3]<250){ transparent++; continue; }
      hist[Math.round(0.299*p[i]+0.587*p[i+1]+0.114*p[i+2])]++; n++;
    }
    if(!n || transparent>n*0.02) return;        // PNG già trasparente: lascialo com'è
    let acc=0, paper=255;
    for(let l=255;l>=0;l--){ acc+=hist[l]; if(acc>=n*0.05){ paper=l; break; } }
    if(paper<90) return;                        // immagine scura: niente "carta" da togliere
    const hi=paper*0.88, lo=paper*0.6;          // sopra hi = carta, sotto lo = inchiostro
    for(let i=0;i<p.length;i+=4){
      const lum=0.299*p[i]+0.587*p[i+1]+0.114*p[i+2];
      if(lum>=hi){ p[i+3]=0; continue; }
      if(lum>lo){ const a=Math.round(p[i+3]*(hi-lum)/(hi-lo)); p[i+3] = a<48 ? 0 : a; }   // via i puntini di rumore
    }
    ctx.putImageData(img,0,0);
  }
  // riquadro che contiene la firma (pixel non trasparenti), con un piccolo margine
  function inkBox(cv){
    const w=cv.width, h=cv.height, p=cv.getContext('2d').getImageData(0,0,w,h).data;
    let x0=w, y0=h, x1=-1, y1=-1;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      if(p[(y*w+x)*4+3]>16){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    }
    if(x1<0) return null;
    const m=Math.round(Math.max(w,h)*0.02);
    x0=Math.max(0,x0-m); y0=Math.max(0,y0-m); x1=Math.min(w-1,x1+m); y1=Math.min(h-1,y1+m);
    return {x:x0, y:y0, w:x1-x0+1, h:y1-y0+1};
  }

  function attach(cv, opt){
    opt=opt||{};
    const height=opt.height||180;
    const ctx=cv.getContext('2d');
    const cssW=cv.getBoundingClientRect().width||600;
    cv.width=Math.round(cssW*2); cv.height=height*2;
    ctx.setTransform(2,0,0,2,0,0);
    ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#111';
    let drawing=false, last=null, has=false;
    const pos=e=>{ const b=cv.getBoundingClientRect(); const t=e.touches?e.touches[0]:e; return {x:t.clientX-b.left, y:t.clientY-b.top}; };
    const start=e=>{ drawing=true; last=pos(e); e.preventDefault(); };
    const move=e=>{ if(!drawing) return; const q=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(q.x,q.y); ctx.stroke(); last=q; has=true; e.preventDefault(); };
    const end=()=>{ drawing=false; };
    cv.onmousedown=start; cv.onmousemove=move; window.onmouseup=end;
    cv.ontouchstart=start; cv.ontouchmove=move; cv.ontouchend=end;

    function clear(){ ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height); ctx.restore(); has=false; }
    // immagine caricata: sfondo carta tolto e ritaglio attorno alla firma (su una copia
    // della sola immagine, max 1600 px), poi inserita al centro del riquadro
    function drawImage(img){
      const k=Math.min(1, 1600/Math.max(img.naturalWidth, img.naturalHeight));
      const src=document.createElement('canvas');
      src.width=Math.max(1, Math.round(img.naturalWidth*k)); src.height=Math.max(1, Math.round(img.naturalHeight*k));
      const sx=src.getContext('2d'); sx.drawImage(img, 0, 0, src.width, src.height);
      clearPaper(sx, src.width, src.height);
      const box=inkBox(src);
      if(!box) throw new Error('empty_image');
      clear();
      const pad=8, W=cssW-pad*2, H=height-pad*2;
      const s=Math.min(W/box.w, H/box.h);
      const w=box.w*s, h=box.h*s;
      ctx.drawImage(src, box.x, box.y, box.w, box.h, (cssW-w)/2, (height-h)/2, w, h);
      has=true;
    }
    function loadFile(file){
      return new Promise((resolve, reject)=>{
        if(!file || !/^image\//.test(file.type||'')) return reject(new Error('not_image'));
        if(file.size>MAX_FILE) return reject(new Error('too_big'));
        const url=URL.createObjectURL(file), img=new Image();
        img.onload=()=>{ URL.revokeObjectURL(url); try{ drawImage(img); resolve(); }catch(e){ reject(e); } };
        img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('not_image')); };
        img.src=url;
      });
    }
    // PNG ritagliato attorno alla firma, rimpicciolito finché non sta nel limite
    function png(){
      const box=inkBox(cv) || {x:0, y:0, w:cv.width, h:cv.height};
      let scale=Math.min(1, 900/box.w, 360/box.h), out='';
      for(let i=0;i<10;i++){
        const o=document.createElement('canvas');
        o.width=Math.max(1,Math.round(box.w*scale)); o.height=Math.max(1,Math.round(box.h*scale));
        o.getContext('2d').drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, o.width, o.height);
        out=o.toDataURL('image/png');
        if(out.length<=MAX_CHARS) break;
        scale*=0.8;
      }
      return out;
    }
    return { cv, clear, isEmpty:()=>!has, png, loadFile };
  }

  root.LFSignature={ attach };
})(window);
