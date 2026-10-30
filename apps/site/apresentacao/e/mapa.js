const VITRINE = new URLSearchParams(location.search).has('vitrine');
if (VITRINE) {
  document.body.classList.add('vitrine');
  const raiz = document.getElementById('raiz');
  const ajustar = () => {
    const s = Math.min(innerWidth / 1600, innerHeight / 1000);
    raiz.style.transform = `translate(${(innerWidth - 1600 * s) / 2}px, ${(innerHeight - 1000 * s) / 2}px) scale(${s})`;
  };
  ajustar();
  addEventListener('resize', ajustar);
}
const c=document.getElementById('c'),g=c.getContext('2d');let W,H;function rs(){W=c.width=c.offsetWidth;H=c.height=c.offsetHeight}rs();addEventListener('resize',rs);
const FONT='ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
const ET=['A abordar','Abordado','Respondeu','Reunião','Proposta','Ganho'],PE=['Paula','Diego','Lúcia','Ana'];
const nomes=['Clínica Sorriso Atlântico','Construtora Horizonte Azul','Pet Center Vilas','Laboratório Vida','Colégio Horizonte','Hotel Baía Azul','Contabilidade Prisma','Distribuidora Sol','Odonto Família','Academia Movimento','Imobiliária Porto','Gráfica Ponto'];
const hubs=[];ET.forEach((n,i)=>{const a=i/ET.length*Math.PI*2;hubs.push({n,t:'e',x:Math.cos(a)*330,y:(i%2?-1:1)*70,z:Math.sin(a)*330,c:0})});
PE.forEach((n,i)=>{const a=i/PE.length*Math.PI*2+.4;hubs.push({n,t:'p',x:Math.cos(a)*120,y:(i%2?-1:1)*170,z:Math.sin(a)*120})});
const gs=()=>{let s=0;for(let i=0;i<4;i++)s+=Math.random();return s-2};
const ST=[],peso=[46,31,18,9,6,4];
for(let k=0;k<260;k++){let r=Math.random()*114,e=0;while(r>peso[e]){r-=peso[e];e++}const h=hubs[e],p=6+Math.floor(Math.random()*4);hubs[e].c++;
ST.push({x:h.x+gs()*80,y:h.y+gs()*80,z:h.z+gs()*80,e,p,n:nomes[k%nomes.length],v:800+(k*137)%2400})}
let ang=0,pul=[],foco=null,fT=0;
function pr(o){const ca=Math.cos(ang),sa=Math.sin(ang),x=o.x*ca-o.z*sa,z=o.x*sa+o.z*ca,ti=-.32,y=o.y*Math.cos(ti)-z*Math.sin(ti),z2=o.y*Math.sin(ti)+z*Math.cos(ti),s=900/(900+z2);return{X:W/2+x*s*1.15,Y:H/2+y*s*1.15,s,z:z2}}
function pill(t,x,y,bold,cor){g.font=(bold?'600 ':'500 ')+'24px '+FONT;const w=g.measureText(t).width+32;g.fillStyle='rgba(10,14,16,.82)';g.strokeStyle=cor;g.lineWidth=1.5;g.beginPath();g.roundRect(x-w/2,y-20,w,40,20);g.fill();g.stroke();g.fillStyle='#ededea';g.textAlign='center';g.textBaseline='middle';g.fillText(t,x,y+1)}
function tick(){g.clearRect(0,0,W,H);ang+=.0022;const HP=hubs.map(pr),SP=ST.map(pr);
for(let i=0;i<ST.length;i++){const s=SP[i],e=HP[ST[i].e],p=HP[ST[i].p],d=Math.max(.15,Math.min(1,(1-s.z/500)));
g.strokeStyle='rgba(60,196,179,'+(.13*d)+')';g.lineWidth=1;g.beginPath();g.moveTo(s.X,s.Y);g.quadraticCurveTo((s.X+e.X)/2,(s.Y+e.Y)/2-20,e.X,e.Y);g.stroke();
g.strokeStyle='rgba(160,170,255,'+(.045*d)+')';g.beginPath();g.moveTo(s.X,s.Y);g.lineTo(p.X,p.Y);g.stroke()}
if(Math.random()<.5)pul.push({i:Math.floor(Math.random()*ST.length),t:0});
pul=pul.filter(q=>(q.t+=.018)<1);for(const q of pul){const s=SP[q.i],e=HP[ST[q.i].e],t=q.t,mx=(s.X+e.X)/2,my=(s.Y+e.Y)/2-20,x=(1-t)*(1-t)*s.X+2*(1-t)*t*mx+t*t*e.X,y=(1-t)*(1-t)*s.Y+2*(1-t)*t*my+t*t*e.Y;g.fillStyle='rgba(190,255,246,'+(1-t)+')';g.beginPath();g.arc(x,y,2.6,0,7);g.fill()}
for(let i=0;i<ST.length;i++){const s=SP[i],gan=ST[i].e===5,d=Math.max(.3,Math.min(1,1-s.z/600));g.fillStyle=gan?'rgba(234,164,65,'+d+')':'rgba(98,211,196,'+d+')';g.beginPath();g.arc(s.X,s.Y,2.2*s.s,0,7);g.fill()}
HP.forEach((h,i)=>{const o=hubs[i];if(o.t==='e'){const gl=g.createRadialGradient(h.X,h.Y,0,h.X,h.Y,46);gl.addColorStop(0,o.n==='Ganho'?'rgba(234,164,65,.55)':'rgba(60,196,179,.5)');gl.addColorStop(1,'rgba(60,196,179,0)');g.fillStyle=gl;g.beginPath();g.arc(h.X,h.Y,46,0,7);g.fill();g.fillStyle='#e9fffb';g.beginPath();g.arc(h.X,h.Y,5,0,7);g.fill();pill(o.n+'  '+o.c,h.X,h.Y-44,true,o.n==='Ganho'?'#eaa441':'#3cc4b3')}else{g.fillStyle='#b8bfff';g.beginPath();g.arc(h.X,h.Y,4,0,7);g.fill();g.globalAlpha=.85;pill(o.n,h.X,h.Y+34,false,'#7c83c9');g.globalAlpha=1}});
fT--;if(fT<=0&&W>900){let k,n=0;do{k=Math.floor(Math.random()*ST.length);n++}while(n<80&&(SP[k].z>200||SP[k].X<300||SP[k].X>W-560||SP[k].Y<140));foco=k;fT=240}
if(foco!=null){const s=SP[foco],o=ST[foco],r=8+6*Math.abs(Math.sin(Date.now()/250));g.strokeStyle='#9df0e4';g.lineWidth=2;g.beginPath();g.arc(s.X,s.Y,r,0,7);g.stroke();
const l1=o.n,l2=ET[o.e]+' · R$ '+o.v.toLocaleString('pt-BR')+'/mês · '+PE[o.p-6];g.font='600 26px '+FONT;const w1=g.measureText(l1).width;g.font='24px '+FONT;const w=Math.max(w1,g.measureText(l2).width)+40,bx=s.X+24,by=s.Y-96;
g.fillStyle='rgba(17,24,24,.94)';g.strokeStyle='#3cc4b3';g.lineWidth=1.5;g.beginPath();g.roundRect(bx,by,w,84,12);g.fill();g.stroke();g.textAlign='left';g.textBaseline='alphabetic';g.fillStyle='#ededea';g.font='600 26px '+FONT;g.fillText(l1,bx+20,by+36);g.fillStyle='#a8a8a1';g.font='24px '+FONT;g.fillText(l2,bx+20,by+68)}
requestAnimationFrame(tick)}tick();
