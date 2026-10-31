const VITRINE=new URLSearchParams(location.search).has('vitrine');
if(VITRINE){document.body.classList.add('vitrine');const r=document.getElementById('raiz');const aj=()=>{const s=Math.min(innerWidth/900,innerHeight/760)*.92;r.style.transform=`translate(${(innerWidth-900*s)/2}px,${(innerHeight-760*s)/2}px) scale(${s})`;r.style.transformOrigin='0 0'};aj();addEventListener('resize',aj)}
const $=i=>document.getElementById(i);
for(let i=0;i<34;i++){const b=document.createElement('i');b.style.animationDelay=(Math.random()*.9).toFixed(2)+'s';b.style.animationDuration=(.6+Math.random()*.7).toFixed(2)+'s';$('onda').appendChild(b)}
const RESUMO='Recebeu a proposta e gostou. Quer começar pela unidade 2 e decide com o sócio, Dr. Paulo. Pediu uma conversa com ele antes de fechar.';
const PROX='<b>Próximo passo:</b> reunião com o sócio na sexta, 15h.';
let tm=[],iv=null;const at=(ms,f)=>tm.push(setTimeout(f,ms));
function cena(n){['c1','c2','c3'].forEach((c,i)=>$(c).classList.toggle('on',i===n))}
function rodar(){tm.forEach(clearTimeout);tm=[];clearInterval(iv);
$('atender').classList.remove('ok');$('atender').textContent='Atender';$('nota').textContent='';$('txt').textContent='';$('px').innerHTML='';['s1','s2'].forEach(s=>$(s).classList.remove('on'));$('ok').classList.remove('on');$('rel').textContent='00:00';
cena(0);
at(2600,()=>{$('atender').classList.add('ok');$('atender').textContent='Atendendo…'});
at(3300,()=>{cena(1);let s=0;iv=setInterval(()=>{s+=7;if(s>372)s=372;$('rel').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},90)});
const nota='Quer começar pela unidade 2. Decide com o sócio.';
for(let i=1;i<=nota.length;i++)at(4300+i*55,()=>{$('nota').textContent=nota.slice(0,i)});
at(9000,()=>{clearInterval(iv);cena(2)});
for(let i=1;i<=RESUMO.length;i++)at(9500+i*22,()=>{$('txt').textContent=RESUMO.slice(0,i)});
const fim=9500+RESUMO.length*22;
at(fim+300,()=>{$('px').innerHTML=PROX});
at(fim+900,()=>$('s1').classList.add('on'));
at(fim+1400,()=>$('s2').classList.add('on'));
at(fim+2100,()=>$('ok').classList.add('on'));
at(fim+6000,rodar)}
rodar();
