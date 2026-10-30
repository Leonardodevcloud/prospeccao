const rows=[...document.querySelectorAll('.row')],arco=document.getElementById('arco'),nota=document.getElementById('nota'),st=document.getElementById('st'),stt=document.getElementById('stt'),mot=document.getElementById('mot');
const msgs=['Consultando a Receita…','Lendo o Google Maps…','Procurando quem decide…','Verificando o WhatsApp…','Lendo o site…'];
function reset(){rows.forEach(r=>r.classList.remove('on'));mot.classList.remove('on');st.classList.remove('pronto');stt.textContent='Buscando dados da empresa…';arco.style.transition='none';arco.style.strokeDashoffset=314;nota.textContent='—'}
function run(){reset();let t=900;rows.forEach((r,i)=>{setTimeout(()=>{stt.textContent=msgs[i]},t);setTimeout(()=>r.classList.add('on'),t+650);t+=1100});
setTimeout(()=>{st.classList.add('pronto');stt.textContent='Pronto para abordar';arco.style.transition='stroke-dashoffset 1.4s ease-out';arco.style.strokeDashoffset=314*(1-.92);let n=0;const k=setInterval(()=>{n+=4;if(n>=92){n=92;clearInterval(k)}nota.textContent=n},50)},t+200);
setTimeout(()=>mot.classList.add('on'),t+1500);setTimeout(run,t+6500)}
run();
