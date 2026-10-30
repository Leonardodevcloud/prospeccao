const m=document.getElementById('m');
const roteiro=[
['eu','Oi, Dr. Renato! Aqui é a Lia, da Nexo Sistemas. Vi que a clínica tem duas unidades. Como vocês fazem o retorno dos orçamentos que não fecham?','09:12'],
['ele','Na mão, pelo caderno da recepção. Muita coisa se perde.','09:15'],
['eu','Dá para automatizar: cada orçamento ganha data de retorno e lembrete. Te mostro em 20 minutos. Quinta às 10h ou sexta às 15h?','09:15'],
['ele','Sexta às 15h fica ótimo.','09:17']];
function el(c,h){const d=document.createElement('div');d.className=c;d.innerHTML=h;return d}
function run(){m.innerHTML='';let t=600;
roteiro.forEach(([q,txt,h])=>{
setTimeout(()=>{const d=el('dig '+q,'<i></i><i></i><i></i>');d.id='dg';m.appendChild(d)},t);
t+=q==='eu'?1700:1300;
setTimeout(()=>{const d=document.getElementById('dg');if(d)d.remove();m.appendChild(el('b '+q,(q==='eu'?'<p class="rot">IA · Nexo Sistemas</p>':'')+txt+'<small>'+h+'</small>'))},t);
t+=q==='eu'?2200:1400;});
setTimeout(()=>m.appendChild(el('chip','✓ Reunião marcada · sex, 15:00')),t);
setTimeout(run,t+4500)}
run();
