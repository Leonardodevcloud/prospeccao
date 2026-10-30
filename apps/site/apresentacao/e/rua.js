const s=document.getElementById('s'),NS='http://www.w3.org/2000/svg';
const mk=(t,a,p)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);(p||s).appendChild(e);return e};
mk('path',{d:'M640 0 C700 120 760 160 980 190 L980 0 Z',fill:'#d3e4ea'});
mk('path',{d:'M60 470 L230 470 L230 640 L60 640 Z',fill:'#d9e8d2',rx:18});
for(let x=40;x<980;x+=120)mk('line',{x1:x,y1:0,x2:x+30,y2:700,stroke:'#fff',"stroke-width":x%240?6:12});
for(let y=60;y<700;y+=110)mk('line',{x1:0,y1:y,x2:980,y2:y-20,stroke:'#fff',"stroke-width":y%220?6:12});
const pts=[[130,600,'Base'],[255,420,'09:10'],[395,300,'10:05'],[545,215,'11:20'],[700,175,'Almoço'],[840,330,'14:05'],[700,505,'15:10'],[480,560,'16:20'],[130,600,'']];
let d='M'+pts[0][0]+' '+pts[0][1];for(let i=1;i<pts.length;i++){const[a,b]=pts[i-1],[x,y]=pts[i];d+=' L'+x+' '+b+' L'+x+' '+y}
mk('path',{d,fill:'none',stroke:'#c5cbc6',"stroke-width":8,"stroke-linecap":"round","stroke-linejoin":"round"});
const rota=mk('path',{d,fill:'none',stroke:'#0b6b63',"stroke-width":8,"stroke-linecap":"round","stroke-linejoin":"round"});
const L=rota.getTotalLength();rota.style.strokeDasharray=L;
const cum=[0];for(let i=1;i<pts.length;i++){const[a,b]=pts[i-1],[x,y]=pts[i];cum.push(cum[i-1]+Math.abs(x-a)+Math.abs(y-b))}
const pins=pts.slice(0,8).map(([x,y,l],i)=>{const G=mk('g',{opacity:i?.35:1});
const base=i===0,alm=l==='Almoço';
mk('circle',{cx:x,cy:y,r:22,fill:base?'#18181b':alm?'#8f5300':'#ffffff',stroke:base?'#18181b':alm?'#8f5300':'#0b6b63',"stroke-width":4},G);
const tx=mk('text',{x,y:y+8,"text-anchor":"middle","font-size":24,"font-weight":700,fill:base||alm?'#ffffff':'#0b6b63'},G);tx.textContent=base?'B':alm?'☕':String(i>4?i-1:i);
let chip=null;if(!base){chip=mk('g',{opacity:0},G);const w=alm?118:132;mk('rect',{x:x-w/2,y:y-74,width:w,height:40,rx:20,fill:alm?'#fcefd6':'#e2f1ee'},chip);const ct=mk('text',{x,y:y-46,"text-anchor":"middle","font-size":24,"font-weight":600,fill:alm?'#8f5300':'#0b6b63'},chip);ct.textContent=alm?'12:10':l+' ✓'}
return{G,chip,alm}});
const moto=mk('circle',{r:12,fill:'#0b6b63',stroke:'#fff',"stroke-width":4});
let t0=null;const DUR=9000;
function frame(ts){if(!t0)t0=ts;const p=Math.min(1,(ts-t0)/DUR),len=p*L;rota.style.strokeDashoffset=L-len;
const pt=rota.getPointAtLength(len);moto.setAttribute('cx',pt.x);moto.setAttribute('cy',pt.y);
let n=0;pins.forEach((q,i)=>{const on=i===0||len>=cum[i]*L/cum[cum.length-1]-2;q.G.setAttribute('opacity',on?1:.35);if(q.chip)q.chip.setAttribute('opacity',on?1:0);if(on&&i&&!q.alm)n++});
document.getElementById('nv').textContent=n;document.getElementById('ok').classList.toggle('on',p>=1);
if(p<1)requestAnimationFrame(frame);else setTimeout(()=>{t0=null;requestAnimationFrame(frame)},3500)}
requestAnimationFrame(frame);
