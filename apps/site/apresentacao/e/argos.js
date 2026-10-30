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
const $=i=>document.getElementById(i),c=$('c'),g=c.getContext('2d'),est=$('est'),mic=$('mic');
for(let i=0;i<22;i++)mic.appendChild(document.createElement('i'));
const dados=[['A abordar',46],['Abordado',31],['Respondeu',18],['Reunião',9],['Proposta',6],['Ganho',4]];
$('bars').innerHTML=dados.map(([n,v])=>'<div class="l"><span>'+n+'</span><div class="tr"><i data-v="'+v+'"></i></div><b>'+v+'</b></div>').join('');
const N=420,P=[];for(let i=0;i<N;i++){const y=1-2*(i+.5)/N,r=Math.sqrt(1-y*y),t=i*2.399963;P.push([Math.cos(t)*r,y,Math.sin(t)*r])}
let modo='idle',ang=0,amp=0,alvo=0;
function orb(){const W=880,cx=440,cy=440;g.clearRect(0,0,W,W);
const vel=modo==='pensando'?.035:.008;ang+=vel;
if(modo==='ouvindo')alvo=.06+Math.random()*.1;else if(modo==='falando')alvo=.04+Math.random()*.14;else if(modo==='pensando')alvo=.03;else alvo=.015*Math.sin(Date.now()/600)+.02;
amp+=(alvo-amp)*.15;const R=250*(1+amp);
const gl=g.createRadialGradient(cx,cy,10,cx,cy,R*1.5);gl.addColorStop(0,'rgba(60,196,179,.28)');gl.addColorStop(1,'rgba(60,196,179,0)');g.fillStyle=gl;g.fillRect(0,0,W,W);
const ca=Math.cos(ang),sa=Math.sin(ang),cb=Math.cos(ang*.6),sb=Math.sin(ang*.6);
for(const[x0,y0,z0]of P){let x=x0*ca-z0*sa,z=x0*sa+z0*ca,y=y0*cb-z*sb;z=y0*sb+z*cb;
const w=1+.12*Math.sin(x0*8+Date.now()/300)*amp*6,s=360/(360+z*160);
const px=cx+x*R*w*s,py=cy+y*R*w*s,a=.25+.75*(1-z)/2;
g.fillStyle='rgba('+(z<0?'157,240,228':'60,196,179')+','+a+')';g.beginPath();g.arc(px,py,(z<0?3.2:2)*s,0,7);g.fill()}
[...mic.children].forEach(b=>b.style.height=(modo==='ouvindo'||modo==='falando'?6+Math.random()*34:6)+'px');
requestAnimationFrame(orb)}orb();
const Q='Como está o meu funil neste mês?';
const A='Você tem <b>114 negócios abertos</b> e já fechou <b>4 neste mês</b>. O gargalo está entre Abordado e Respondeu: <b>31 empresas</b> ainda não responderam.';
function run(){const perg=$('perg'),resp=$('resp');perg.innerHTML='';resp.innerHTML='';document.querySelectorAll('.k').forEach(k=>k.classList.remove('on'));$('gr').classList.remove('on');document.querySelectorAll('.tr i').forEach(i=>{i.style.transition='none';i.style.width=0});
modo='idle';est.textContent='Toque para falar';let t=1200;
setTimeout(()=>{modo='ouvindo';est.textContent='Ouvindo…'},t);
for(let i=1;i<=Q.length;i++)setTimeout(()=>{perg.innerHTML=Q.slice(0,i)+'<span class="cur"></span>'},t+300+i*60);
t+=300+Q.length*60+500;
setTimeout(()=>{perg.textContent=Q;modo='pensando';est.textContent='Consultando o funil…'},t);t+=1500;
setTimeout(()=>{modo='falando';est.textContent='Respondendo'},t);
const pal=A.split(' ');pal.forEach((_,i)=>setTimeout(()=>{resp.innerHTML=pal.slice(0,i+1).join(' ')},t+i*110));t+=pal.length*110+200;
document.querySelectorAll('.k').forEach((k,i)=>setTimeout(()=>k.classList.add('on'),t+i*220));t+=800;
setTimeout(()=>{$('gr').classList.add('on');document.querySelectorAll('.tr i').forEach((b,i)=>setTimeout(()=>{b.style.transition='';b.style.width=(b.dataset.v/46*100)+'%'},120*i))},t);t+=1600;
setTimeout(()=>{modo='idle';est.textContent='Pergunte outra coisa'},t);
setTimeout(run,t+6000)}
run();
