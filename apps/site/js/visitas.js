/*
 * Visitas do site (painel master › Visitas do site). Sem cookie e sem guardar nada no navegador:
 * avisa a página aberta (e de onde a pessoa veio), os cliques nos botões principais e, ao sair,
 * até onde rolou e quais seções apareceram na tela.
 */
(() => {
  const URL_VISITA = '/api/site/visita';
  if (navigator.webdriver || /bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent)) return;

  const params = new URLSearchParams(location.search);
  let referencia = null;
  try {
    referencia = document.referrer ? new URL(document.referrer).hostname : null;
  } catch {
    referencia = null;
  }
  const base = { pagina: location.pathname || '/' };

  const mandar = (dados) => {
    const corpo = JSON.stringify({ ...base, ...dados });
    try {
      if (navigator.sendBeacon?.(URL_VISITA, new Blob([corpo], { type: 'application/json' }))) return;
    } catch {
      /* cai no fetch */
    }
    fetch(URL_VISITA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpo,
      keepalive: true,
    }).catch(() => undefined);
  };

  mandar({
    evento: 'visita',
    referencia,
    utmOrigem: params.get('utm_source'),
    utmMeio: params.get('utm_medium'),
    utmCampanha: params.get('utm_campaign'),
  });

  // Os botões que importam para a venda.
  const alvoDo = (el) => {
    const href = el.getAttribute('href') || '';
    if (el.matches('.contador__botao')) return 'contador';
    const assinar = /\/teste\?assinar=(start|time|escala)/.exec(href);
    if (assinar) return `assinar:${assinar[1]}`;
    if (/app\.prospectteam\.com\.br\/teste/.test(href)) return 'teste';
    if (el.dataset.plano === 'Personalizado') return 'personalizado';
    if (href === '#contato' || el.matches('[data-canal], .formulario__acoes .btn--pri'))
      return 'demonstracao';
    if (/wa\.me|whatsapp\.com/.test(href)) return 'whatsapp';
    if (/app\.prospectteam\.com\.br\/?($|login)/.test(href)) return 'entrar';
    if (/\/apresentacao/.test(href)) return 'apresentacao';
    if (/^\/api(\b|$)/.test(href)) return 'api';
    return null;
  };
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('a, button') : null;
      const alvo = el && alvoDo(el);
      if (alvo) mandar({ evento: 'clique', alvo });
    },
    true,
  );

  // Até onde rolou, quanto tempo ficou e quais seções apareceram.
  const inicio = Date.now();
  let maximo = 0;
  const medir = () => {
    const alto = document.documentElement.scrollHeight;
    if (alto > 0) maximo = Math.max(maximo, Math.min(1, (window.scrollY + window.innerHeight) / alto));
  };
  window.addEventListener('scroll', medir, { passive: true });
  medir();
  const vistas = new Set();
  if ('IntersectionObserver' in window) {
    const olho = new IntersectionObserver(
      (es) => {
        for (const x of es) if (x.isIntersecting && x.target.id) vistas.add(x.target.id);
      },
      // Conta a seção quando ela passa pelo meio da tela (vale para seção alta e baixa).
      { rootMargin: '-40% 0px -40% 0px' },
    );
    for (const s of document.querySelectorAll('section[id]')) olho.observe(s);
  }
  let saiu = false;
  const sair = () => {
    if (saiu) return;
    saiu = true;
    medir();
    mandar({
      evento: 'saida',
      profundidade: Math.round(maximo * 100),
      segundos: Math.round((Date.now() - inicio) / 1000),
      secoes: [...vistas].slice(0, 30),
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sair();
  });
  window.addEventListener('pagehide', sair);
})();
