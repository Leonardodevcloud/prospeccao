/**
 * Apresentação comercial na web: mostra um slide por vez num palco de 1920×1080 que se ajusta à
 * janela. Setas, espaço, PageUp/PageDown, Home/End, deslizar no celular e o endereço (#3) trocam o
 * slide; F põe em tela cheia. As animações (iframes) só carregam quando o slide aparece.
 */
(() => {
  const tela = document.querySelector('[data-tela]');
  const area = tela.parentElement;
  const slides = [...tela.querySelectorAll('.slide')];
  const conta = document.querySelector('[data-conta]');
  const progresso = document.querySelector('[data-progresso]');
  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let atual = -1;
  let entradas = [];

  const ajustar = () => {
    const s = Math.min(area.clientWidth / 1920, area.clientHeight / 1080);
    tela.style.transform = `translate(-50%, -50%) scale(${s})`;
  };

  const ordem = (el) => Number((el.dataset.buildIn.match(/order (\d+)/) || [])[1] || 1);

  const mostrar = (i, empurrarHistorico = true) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    if (n === atual) return;
    for (const t of entradas) clearTimeout(t);
    entradas = [];
    atual = n;
    slides.forEach((s, k) => {
      const on = k === n;
      s.classList.toggle('ativo', on);
      s.setAttribute('aria-hidden', String(!on));
      if (!on) return;
      // Carrega a animação na primeira vez (e recomeça ao voltar ao slide).
      for (const f of s.querySelectorAll('iframe[data-src]')) f.src = f.dataset.src;
      const els = [...s.querySelectorAll('[data-build-in]')].sort((a, b) => ordem(a) - ordem(b));
      for (const el of els) el.classList.toggle('espera', !reduz);
      if (!reduz)
        els.forEach((el, k2) => {
          entradas.push(setTimeout(() => el.classList.remove('espera'), 450 + k2 * 380));
        });
    });
    conta.textContent = `${n + 1} / ${slides.length}`;
    progresso.style.width = `${((n + 1) / slides.length) * 100}%`;
    const hash = `#${n + 1}`;
    if (empurrarHistorico && location.hash !== hash) history.replaceState(null, '', hash);
  };

  const doEndereco = () => {
    const n = Number.parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) ? n - 1 : 0;
  };

  document.querySelector('[data-ant]').addEventListener('click', () => mostrar(atual - 1));
  document.querySelector('[data-prox]').addEventListener('click', () => mostrar(atual + 1));
  const cheia = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.querySelector('[data-cheia]').addEventListener('click', cheia);

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') {
      if (k === 'Enter' && e.target.closest('a, button')) return;
      e.preventDefault();
      mostrar(atual + 1);
    } else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') {
      e.preventDefault();
      mostrar(atual - 1);
    } else if (k === 'Home') mostrar(0);
    else if (k === 'End') mostrar(slides.length - 1);
    else if (k === 'f' || k === 'F') cheia();
  });

  // Clique no slide avança (menos em links); deslizar no celular troca.
  area.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    mostrar(atual + (e.clientX < window.innerWidth / 4 ? -1 : 1));
  });
  let x0 = null;
  area.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  area.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) mostrar(atual + (dx < 0 ? 1 : -1));
    x0 = null;
  });

  window.addEventListener('resize', ajustar);
  window.addEventListener('hashchange', () => mostrar(doEndereco(), false));
  ajustar();
  mostrar(doEndereco());
})();
