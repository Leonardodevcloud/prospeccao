const VITRINE=new URLSearchParams(location.search).has('vitrine');
if(VITRINE){document.body.classList.add('vitrine');const r=document.getElementById('raiz');const aj=()=>{const s=Math.min(innerWidth/900,innerHeight/760)*.9;r.style.transform=`translate(${(innerWidth-900*s)/2}px,${(innerHeight-760*s)/2}px) scale(${s})`;r.style.transformOrigin='0 0'};aj();addEventListener('resize',aj)}
const $=i=>document.getElementById(i),coms=$('coms'),m=$('m');
const pessoas=[['ana.clinicasorriso','QUERO 🙋‍♀️','#e04f8c','AC'],['pradoengenharia','quero!','#f79009','PE'],['studio.belaforma','QUERO por favor','#7a5af8','SB']];
function el(t,c,h){const d=document.createElement(t);d.className=c;d.innerHTML=h;return d}
let tm=[];const at=(ms,f)=>tm.push(setTimeout(f,ms));
function rodar(){tm.forEach(clearTimeout);tm=[];coms.innerHTML='';m.innerHTML='<p class="vazio">Quem comentar a palavra recebe<br>a mensagem aqui, na hora.</p>';$('dmnome').textContent='Direct';$('dmsub').textContent='esperando um comentário';$('dmav').textContent='?';$('curt').textContent='1.904 curtidas';
let t=700;
pessoas.forEach(([u,txt,cor,ini],i)=>{at(t,()=>{const c=el('div','com',`<span class="a" style="background:${cor}">${ini}</span><span><b>${u}</b> ${txt}</span><em>✓ direct enviado</em>`);coms.appendChild(c);$('curt').textContent=(1904+(i+1)*3).toLocaleString('pt-BR')+' curtidas';setTimeout(()=>c.querySelector('em').classList.add('on'),900)});t+=1500});
at(1700,()=>{m.innerHTML='';$('dmnome').textContent='@ana.clinicasorriso';$('dmsub').textContent='Ana · comentou “QUERO”';$('dmav').textContent='AC';$('dmav').style.background='#e04f8c'});
const roteiro=[['eu','<p class="rot">Automático · Nexo Sistemas</p>Oi, Ana! Aqui está o checklist que você pediu 👇<span class="bt">Baixar o checklist</span>','agora',300],
['ele','Amei! Vocês fazem isso para clínica? Meu zap é 71 99876-5432','agora',1800],
['eu','<p class="rot">IA · Nexo Sistemas</p>Fazemos sim! Te chamo no WhatsApp para te mostrar em 20 min 😉','agora',1800]];
let u=1900;
roteiro.forEach(([q,h,hr,esp])=>{u+=esp;at(u,()=>{const d=el('div','dig '+q,'<i></i><i></i><i></i>');d.id='dg';m.appendChild(d)});u+=q==='eu'?1300:1100;at(u,()=>{const d=$('dg');if(d)d.remove();m.appendChild(el('div','b '+q,h+'<small>'+hr+'</small>'))})});
u+=1300;at(u,()=>m.appendChild(el('div','chip','✓ Virou lead no funil · nota A')));
at(u+4200,rodar)}
rodar();
