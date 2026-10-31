/*
 * Documentação da API: as abas dos exemplos (curl, JavaScript…), o menu que acompanha a leitura e
 * o "Testar o pedido" (confere o JSON na API, sem gravar nada).
 */
(() => {
  for (const bloco of document.querySelectorAll('[data-abas]')) {
    const botoes = bloco.querySelectorAll('[role="tab"]');
    for (const b of botoes)
      b.addEventListener('click', () => {
        for (const x of botoes) x.setAttribute('aria-selected', String(x === b));
        for (const pre of bloco.querySelectorAll('pre[data-aba]'))
          pre.hidden = pre.dataset.aba !== b.dataset.aba;
      });
  }

  const links = [...document.querySelectorAll('.doc-lado a')];
  const secoes = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const visto = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          for (const a of links)
            a.toggleAttribute('aria-current', a.getAttribute('href') === `#${e.target.id}`);
        }
      },
      { rootMargin: '-90px 0px -70% 0px' },
    );
    for (const s of secoes) visto.observe(s);
  }

  const botao = document.getElementById('testar');
  const corpo = document.getElementById('testar-corpo');
  const saida = document.getElementById('testar-resposta');
  if (botao && corpo && saida)
    botao.addEventListener('click', async () => {
      let json;
      try {
        json = JSON.parse(corpo.value);
      } catch {
        saida.hidden = false;
        saida.firstElementChild.textContent = 'O texto não é um JSON válido (confira vírgulas e aspas).';
        return;
      }
      botao.disabled = true;
      try {
        const r = await fetch('/api/v1/experimentar/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        const t = await r.json().catch(() => ({}));
        saida.hidden = false;
        saida.firstElementChild.textContent = `${r.status}\n${JSON.stringify(t, null, 2)}`;
      } catch {
        saida.hidden = false;
        saida.firstElementChild.textContent = 'Não deu para falar com a API agora. Tente de novo.';
      } finally {
        botao.disabled = false;
      }
    });
})();
