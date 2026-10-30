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
const $=i=>document.getElementById(i),leg=$('leg'),ms=$('ms');let seg=760;
setInterval(()=>{seg++;const h='00',m=String(Math.floor(seg/60)).padStart(2,'0'),s=String(seg%60).padStart(2,'0');$('tm').textContent=h+':'+m+':'+s},1000);
const nomes=['Paula Ribeiro','Dr. Renato Lima','Camila Souza'];
function fala(i,txt){[0,1,2].forEach(k=>$('t'+k).classList.toggle('fala',k===i));if(txt){leg.innerHTML='<b>'+nomes[i]+':</b> '+txt;leg.classList.add('on')}else leg.classList.remove('on')}
function chat(a,h,html){const d=document.createElement('div');d.className='mg';d.innerHTML='<p class="a">'+a+'<span>'+h+'</span></p><div class="x">'+html+'</div>';ms.appendChild(d);while(ms.children.length>4)ms.firstChild.remove()}
const passos=[
[0,()=>{ms.innerHTML='';$('tela').classList.remove('on');$('vz').style.opacity=1;$('rt').style.opacity=0;fala(0,'Vou mostrar a proposta para as duas unidades.');chat('Paula Ribeiro','10:41','Bom dia! Já vou compartilhar a proposta.')}],
[2600,()=>{$('tela').classList.add('on');$('vz').style.opacity=0;$('rt').style.opacity=1;fala(0,'Com a cadência, cada orçamento ganha uma data de retorno.')}],
[3200,()=>fala(1,'Isso resolve a recepção da segunda unidade.')],
[2600,()=>{fala(2,null);chat('Camila Souza','10:44','Segue a tabela de orçamentos do mês<p class="arq">▤ orcamentos-outubro.xlsx</p>')}],
[2600,()=>{$('mao').classList.add('on');fala(1,'Quanto fica para as duas unidades?')}],
[2800,()=>{$('mao').classList.remove('on');fala(0,'Mando a proposta até sexta, com o prazo de implantação.');chat('Dr. Renato Lima','10:47','Perfeito, levo para o meu sócio.')}],
[3400,()=>fala(-1,null)]];
function run(){let t=0;passos.forEach(([d,f])=>{t+=d;setTimeout(f,t)});setTimeout(run,t+1600)}
run();
