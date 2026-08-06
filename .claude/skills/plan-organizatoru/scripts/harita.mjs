#!/usr/bin/env node
// harita.mjs — plan AĞI haritası (Obsidian graph-view tarzı 2D, kendine-yeterli HTML).
//
// TEK KAYNAK: agac.mjs --graf (düğüm+kenar) + claim.mjs status --json (canlı kilit overlay).
// Bu dosya İKİNCİ BİR GRAF MOTORU DEĞİLDİR — yalnız projeksiyonu çizer (Ders 2/17).
//
// 2026-07-17: overlay kaynağı kosucu.mjs'ten claim.mjs'e taşındı. kosucu.mjs arşivlendi
// (<agent-ide>/archive/2026-07-16-runner-agi/), ama overlay'in ihtiyacı olan bilgi zaten
// ARACISIZ orada duruyordu: aşama kilidi `plan:<slug>:asama:<no>` bir CLAIM'dir, sahibi de
// claim'in owner'ıdır. Aracıdan okumak ikinci bir doğruluk kaynağı yaratıyordu.
// Tüketiciler: (1) CLI → plans/HARITA.html üretir; (2) kaptan dashboard.mjs `haritaHtml`/
// `grafVerisi` fonksiyonlarını import edip route olarak sunar (/plan-agi).
//
//   node harita.mjs [--proje <yol>] [--out <dosya>]     varsayılan çıktı: <proje>/plans/HARITA.html
//   node harita.mjs --json                              graf+overlay JSON'unu bas (yazmaz)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);

const CLAIM = path.join(process.env.HOME || '', '.claude/skills/eszamanli/scripts/claim.mjs');

// `plan:<slug>:asama:<no>` biçimli claim'leri {slug:no → sahip} haritasına indirger.
//
// CANLILIK BURADA ÖLÇÜLMEZ (Ders 17 — hükmün tek sahibi): claim.mjs kilit canlılığını pid ile
// ölçer ve ölü sahibin kilidini biçer, yani `status`ta GÖRÜNEN claim zaten canlıdır. İkinci bir
// ölçüm eklemek yanlış cevap verdi: `status.live[]` REPO-KAPSAMLIDIR (yalnız bu repodaki canlı
// session'lar), oysa bir aşama claim'inin sahibi başka repodaki bir session olabilir — o zaman
// canlı kilit "ölü" sanılıp overlay'den düşüyordu (kanıt: 2026-07-17 overlay testi, sahibi
// agent-ide'de olan plan:proje:asama:00 kilidi dorukcom06 haritasında görünmedi).
function asamaKilitleri(proje) {
  const r = spawnSync('node', [CLAIM, 'status', '--json'], { encoding: 'utf8', cwd: proje });
  let s;
  try { s = JSON.parse(r.stdout); } catch { return new Map(); }
  const m = new Map();
  for (const c of s.claims || []) {
    const key = c?.resource?.key || '';
    // İKİ AİLE: aşama kilidi `plan:<slug>:asama:<no>` VE plan düzeyi `glob:plans/<slug>/**`.
    // Tek aile sayarken overlay ÖLÇÜLDÜ (2026-08-03) ve BOŞTU: canlı /goal oturumlarının
    // tuttuğu planlar haritada kilitsiz görünüyordu. Plan düzeyi kilit `slug:*` anahtarıyla
    // girer ve o planın TÜM aşamalarını işaretler (claims-lib köprüsünün ilanlı yan etkisi).
    const a = /^plan:([^:/]+):asama:([^/]+)$/.exec(key);
    const g = a ? null : /^glob:plans\/([^/*?]+)\/\*\*$/.exec(key);
    if (!a && !g) continue;
    const sid = c?.owner?.sessionId;
    m.set(a ? `${a[1]}:${a[2]}` : `${g[1]}:*`, { sahip: sid ? sid.slice(0, 8) : null, niyet: c.intent || null });
  }
  return m;
}

export function grafVerisi(proje) {
  const r = spawnSync('node', [path.join(HERE, 'agac.mjs'), '--proje', proje, '--graf'], { encoding: 'utf8', cwd: proje });
  let graf;
  try { graf = JSON.parse(r.stdout); } catch { graf = null; }
  graf ||= { nodes: [], edges: [] };

  // overlay: kilitli aşama düğümlerine sahip bilgisi işle (kaynaklar ayrı; birleşim burada,
  // çizim katmanında — plan verisi runtime verisiyle KARIŞTIRILMAZ, agac'a geri yazılmaz)
  const kilit = asamaKilitleri(proje);
  const sahipler = new Set();
  for (const n of graf.nodes || []) {
    if (n.tip !== 'asama') continue;
    const k = kilit.get(`${n.slug}:${n.no}`);
    n.kilitli = !!k;
    if (k?.sahip) { n.runner = k.sahip; sahipler.add(k.sahip); }
  }
  return { ...graf, kosucular: [...sahipler].map((id) => ({ id, canli: true })), proje: path.basename(proje) };
}

export function haritaHtml(veri, { veriUrl = null } = {}) {
  const inj = veriUrl ? 'null' : JSON.stringify(veri);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plan Ağı — ${veri?.proje || ''}</title>
<style>
:root{--bg:#12141a;--panel:#1b1e27;--ink:#dfe3ec;--mut:#8a91a3;--acik:#5b8dd9;--suruyor:#e0a83c;--kapali:#4caf7d;--bloke:#d9605b;--hazir:#8fd14f;--kenar:#3a4souligne}
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{background:var(--bg);color:var(--ink);font:13px/1.45 -apple-system,system-ui,sans-serif;overflow:hidden}
#c{display:block;width:100vw;height:100vh;cursor:grab}
#panel{position:fixed;right:0;top:0;bottom:0;width:340px;background:var(--panel);border-left:1px solid #2a2e3a;padding:16px;overflow:auto;transform:translateX(100%);transition:transform .18s}
#panel.acik{transform:none}
#panel h2{font-size:15px;margin-bottom:6px}#panel .rozet{display:inline-block;padding:1px 8px;border-radius:9px;font-size:11px;margin:2px 4px 8px 0;background:#2a2e3a}
#panel pre{background:#12141a;border:1px solid #2a2e3a;border-radius:8px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-word;margin:8px 0}
#panel button{background:#2a2e3a;color:var(--ink);border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:12px}
#ust{position:fixed;left:12px;top:10px;display:flex;gap:10px;align-items:center;background:rgba(27,30,39,.88);border:1px solid #2a2e3a;border-radius:10px;padding:7px 12px}
#ust b{font-size:13px}.lg{display:flex;gap:9px;font-size:11px;color:var(--mut);align-items:center}
.nk{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;vertical-align:-1px}
#alt{position:fixed;left:12px;bottom:10px;font-size:11px;color:var(--mut);background:rgba(27,30,39,.88);border:1px solid #2a2e3a;border-radius:10px;padding:6px 10px}
@media (prefers-color-scheme: light){:root{--bg:#f4f5f8;--panel:#fff;--ink:#23262e;--mut:#6a7183}#ust,#alt{background:rgba(255,255,255,.9);border-color:#d8dbe4}#panel{border-color:#d8dbe4}#panel .rozet,#panel button{background:#e8eaf1}#panel pre{background:#f4f5f8;border-color:#d8dbe4}}
</style></head><body>
<canvas id="c"></canvas>
<div id="ust"><b>🕸 Plan Ağı${veri?.proje ? ' — ' + veri.proje : ''}</b>
<span class="lg"><span><span class="nk" style="background:var(--acik)"></span>açık</span>
<span><span class="nk" style="background:var(--suruyor)"></span>sürüyor</span>
<span><span class="nk" style="background:var(--kapali)"></span>kapalı</span>
<span><span class="nk" style="background:var(--bloke)"></span>bloke</span>
<span><span class="nk" style="background:var(--hazir)"></span>hazır</span>
<span style="color:#e07be0">◉ runner</span></span></div>
<div id="alt">sürükle: taşı · tekerlek: zoom · düğüme tıkla: detay · çift tık: sığdır</div>
<div id="panel"></div>
<script>
const VERI_URL=${JSON.stringify(veriUrl)};let G=${inj};
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),panel=document.getElementById('panel');
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const RENK=()=>({'AÇIK':css('--acik'),'SÜRÜYOR':css('--suruyor'),'KAPALI':css('--kapali'),'BLOKE':css('--bloke')});
let N=[],E=[],cam={x:0,y:0,k:1},drag=null,pan=null,secili=null,dpr=devicePixelRatio||1;
function kur(){
  N=G.nodes.map((n,i)=>({...n,x:Math.cos(i*2.399)*(80+i*7),y:Math.sin(i*2.399)*(80+i*7),vx:0,vy:0,
    r:n.tip==='plan'?22:11,m:n.tip==='plan'?4:1}));
  const ix=Object.fromEntries(N.map((n,i)=>[n.id,i]));
  E=G.edges.filter(e=>ix[e.from]!=null&&ix[e.to]!=null).map(e=>({...e,a:ix[e.from],b:ix[e.to]}));
  sigdir();
}
function adim(){ // basit kuvvet-yönelimli yerleşim
  for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
    const a=N[i],b=N[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy||1,d=Math.sqrt(d2);
    const f=Math.min(1200*(a.m+b.m)/d2,8);dx/=d;dy/=d;
    a.vx-=dx*f/a.m;a.vy-=dy*f/a.m;b.vx+=dx*f/b.m;b.vy+=dy*f/b.m;}
  for(const e of E){const a=N[e.a],b=N[e.b];const L=e.tip==='icerir'?95:150,K=e.tip==='icerir'?.03:.015;
    let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;const f=K*(d-L);dx/=d;dy/=d;
    a.vx+=dx*f/a.m;a.vy+=dy*f/a.m;b.vx-=dx*f/b.m;b.vy-=dy*f/b.m;}
  for(const n of N){if(n===drag)continue;n.vx*=.85;n.vy*=.85;n.x+=n.vx;n.y+=n.vy;}
}
function ciz(){
  const W=innerWidth,H=innerHeight;cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  ctx.save();ctx.translate(W/2+cam.x,H/2+cam.y);ctx.scale(cam.k,cam.k);
  const R=RENK(),t=Date.now()/500;
  for(const e of E){const a=N[e.a],b=N[e.b];
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.setLineDash(e.tip==='veya'?[5,4]:e.capraz?[2,4]:[]);
    ctx.strokeStyle=e.tip==='icerir'?'rgba(128,136,158,.13)':e.tip==='ust'?'rgba(128,136,158,.3)':e.capraz?'rgba(190,110,220,.55)':e.tip==='veya'?'rgba(120,160,220,.5)':'rgba(120,160,220,.42)';
    ctx.lineWidth=(e.tip==='ust'?2.4:e.tip==='icerir'?1:1.6)/cam.k;ctx.stroke();ctx.setLineDash([]);
    if(e.tip!=='icerir'){ // yön oku
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,ux=dx/d,uy=dy/d,px=b.x-ux*(b.r+5),py=b.y-uy*(b.r+5),s=5/cam.k;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-ux*2*s-uy*s,py-uy*2*s+ux*s);ctx.lineTo(px-ux*2*s+uy*s,py-uy*2*s-ux*s);
      ctx.closePath();ctx.fillStyle=e.capraz?'rgba(190,110,220,.8)':'rgba(120,160,220,.7)';ctx.fill();}}
  for(const n of N){
    const r=R[n.durum]||css('--mut');
    if(n.hazir&&n.durum==='AÇIK'){ctx.beginPath();ctx.arc(n.x,n.y,n.r+4+Math.sin(t)*1.2,0,7);ctx.strokeStyle=css('--hazir');ctx.lineWidth=1.6/cam.k;ctx.stroke();}
    if(n.kilitli||n.runner){ctx.beginPath();ctx.arc(n.x,n.y,n.r+7,0,7);ctx.strokeStyle='rgba(224,123,224,'+(0.55+0.35*Math.sin(t*2))+')';ctx.lineWidth=2/cam.k;ctx.stroke();}
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,7);
    ctx.fillStyle=n.tip==='plan'?'rgba(90,100,130,.25)':r;ctx.fill();
    ctx.strokeStyle=n===secili?'#fff':r;ctx.lineWidth=(n===secili?2.4:n.tip==='plan'?2:1.2)/cam.k;ctx.stroke();
    ctx.fillStyle=css('--ink');ctx.font=(n.tip==='plan'?600:400)+' '+(n.tip==='plan'?13:10)/1+'px system-ui';
    ctx.textAlign='center';
    ctx.fillText(n.tip==='plan'?n.slug:(n.no+' '+(n.ad||'')).slice(0,22),n.x,n.y+n.r+13);}
  ctx.restore();
}
function dunya(mx,my){return{x:(mx-innerWidth/2-cam.x)/cam.k,y:(my-innerHeight/2-cam.y)/cam.k}}
function vur(mx,my){const p=dunya(mx,my);return N.findLast(n=>{const dx=n.x-p.x,dy=n.y-p.y;return dx*dx+dy*dy<=(n.r+4)*(n.r+4)})}
function sigdir(){if(!N.length)return;const xs=N.map(n=>n.x),ys=N.map(n=>n.y);
  const w=Math.max(...xs)-Math.min(...xs)+160,h=Math.max(...ys)-Math.min(...ys)+160;
  cam.k=Math.min(innerWidth/w,innerHeight/h,1.4);
  cam.x=-(Math.max(...xs)+Math.min(...xs))/2*cam.k;cam.y=-(Math.max(...ys)+Math.min(...ys))/2*cam.k}
function detay(n){secili=n;if(!n){panel.classList.remove('acik');return}
  const b=[];
  b.push('<h2>'+(n.tip==='plan'?'📘 '+n.slug+' (v'+n.v+')':'⬢ '+n.no+' — '+esc(n.ad))+'</h2>');
  b.push('<span class="rozet">'+n.durum+'</span>');
  if(n.tip==='plan'&&n.kategori)b.push('<span class="rozet">'+n.kategori+'</span>');
  if(n.hazir)b.push('<span class="rozet" style="background:var(--hazir);color:#12141a">HAZIR</span>');
  if(n.baslangic)b.push('<span class="rozet">rota başı</span>');
  if(n.kilitli)b.push('<span class="rozet" style="background:#e07be0;color:#12141a">KİLİTLİ (koşuyor)</span>');
  if(n.runner)b.push('<div style="margin:6px 0;color:var(--mut)">runner rotasında: <b>'+esc(n.runner)+'</b></div>');
  const gelen=E.filter(e=>N[e.b]===n&&(e.tip==='ve'||e.tip==='veya')).map(e=>N[e.a]);
  const giden=E.filter(e=>N[e.a]===n&&(e.tip==='ve'||e.tip==='veya')).map(e=>N[e.b]);
  if(gelen.length)b.push('<div style="margin-top:8px"><b>⟵ bağımlı olduğu:</b> '+gelen.map(x=>esc(x.id)+' <i style="color:var(--mut)">('+x.durum+')</i>').join(' · ')+'</div>');
  if(giden.length)b.push('<div style="margin-top:4px"><b>⟶ önünü açtığı:</b> '+giden.map(x=>esc(x.id)).join(' · ')+'</div>');
  if(n.kanit&&n.kanit!=='—')b.push('<div style="margin-top:8px"><b>kanıt:</b> '+esc(n.kanit)+'</div>');
  if(n.goal)b.push('<pre id="goalp">'+esc(n.goal)+'</pre><button onclick="navigator.clipboard.writeText(document.getElementById(\\'goalp\\').textContent)">goal komutunu kopyala</button>');
  if(n.tip==='plan'&&n.master)b.push('<pre>'+esc(n.master)+'</pre>');
  panel.innerHTML=b.join('');panel.classList.add('acik');}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
cv.addEventListener('mousedown',e=>{const n=vur(e.clientX,e.clientY);if(n){drag=n;n._mv=false}else pan={x:e.clientX-cam.x,y:e.clientY-cam.y};cv.style.cursor='grabbing'});
addEventListener('mousemove',e=>{if(drag){const p=dunya(e.clientX,e.clientY);drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;drag._mv=true}else if(pan){cam.x=e.clientX-pan.x;cam.y=e.clientY-pan.y}});
addEventListener('mouseup',e=>{if(drag&&!drag._mv)detay(drag);else if(pan&&!vur(e.clientX,e.clientY)&&Math.abs(e.clientX-(pan.x+cam.x))<3)detay(null);drag=null;pan=null;cv.style.cursor='grab'});
cv.addEventListener('dblclick',sigdir);
cv.addEventListener('wheel',e=>{e.preventDefault();const k=Math.min(4,Math.max(.15,cam.k*(e.deltaY<0?1.12:.89)));
  const p=dunya(e.clientX,e.clientY);cam.k=k;cam.x=e.clientX-innerWidth/2-p.x*k;cam.y=e.clientY-innerHeight/2-p.y*k},{passive:false});
function dongu(){adim();ciz();requestAnimationFrame(dongu)}
async function basla(){if(!G&&VERI_URL){try{G=await (await fetch(VERI_URL)).json()}catch{G={nodes:[],edges:[]}}}
  kur();dongu();
  if(VERI_URL)setInterval(async()=>{try{const y=await (await fetch(VERI_URL)).json();
    const poz=Object.fromEntries(N.map(n=>[n.id,{x:n.x,y:n.y}]));G=y;kur();
    for(const n of N)if(poz[n.id]){n.x=poz[n.id].x;n.y=poz[n.id].y}}catch{}},15000);}
basla();
</script></body></html>`;
}

// ---------- CLI ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (f) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : null; };
  const proje = path.resolve(opt('proje') || process.cwd());
  const veri = grafVerisi(proje);
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(veri, null, 1) + '\n'); process.exit(0); }
  const out = opt('out') || path.join(proje, 'plans', 'HARITA.html');
  fs.writeFileSync(out, haritaHtml(veri));
  console.log(`harita yazıldı: ${out} · ${veri.nodes.length} düğüm · ${veri.edges.length} kenar (statik anlık görüntü; canlısı kaptan panosunda /plan-agi)`);
}
