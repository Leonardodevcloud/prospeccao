/* Prospect Team — interações da página institucional (sem dependências). */

/**
 * Contato: preencha antes de publicar.
 * whatsapp: só números, com DDI e DDD (ex.: '5571999990000'). Vazio: o botão some.
 * email: endereço que recebe os pedidos de demonstração. Vazio: o botão some.
 */
const CONTATO = {
  whatsapp: '',
  email: '',
};

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/* ---------- topo: sombra ao rolar, menu no celular, seção atual ---------- */
function iniciarTopo() {
  const topo = $('#topo-fixo');
  const botao = $('.menu-botao');
  const menu = $('#menu');
  if (!topo) return;

  const aoRolar = () => topo.classList.toggle('topo--rolou', window.scrollY > 8);
  aoRolar();
  window.addEventListener('scroll', aoRolar, { passive: true });

  const fechar = () => {
    topo.classList.remove('topo--aberto');
    botao?.setAttribute('aria-expanded', 'false');
    botao?.setAttribute('aria-label', 'Abrir menu');
  };
  botao?.addEventListener('click', () => {
    const abrir = !topo.classList.contains('topo--aberto');
    topo.classList.toggle('topo--aberto', abrir);
    botao.setAttribute('aria-expanded', String(abrir));
    botao.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu');
    if (abrir) $('a', menu)?.focus();
  });
  menu?.addEventListener('click', (e) => {
    if (e.target.closest('a')) fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && topo.classList.contains('topo--aberto')) {
      fechar();
      botao?.focus();
    }
  });

  // marca no menu a seção que está na tela
  const links = $$('a[href^="#"]', menu);
  const secoes = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if (!('IntersectionObserver' in window) || !secoes.length) return;
  const obs = new IntersectionObserver(
    (entradas) => {
      for (const en of entradas) {
        if (!en.isIntersecting) continue;
        for (const a of links) {
          if (a.getAttribute('href') === `#${en.target.id}`) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const s of secoes) obs.observe(s);
}

/* ---------- revelar ao rolar ---------- */
function iniciarRevelar() {
  const itens = $$('.revela');
  if (reduzMovimento || !('IntersectionObserver' in window)) {
    for (const el of itens) el.classList.add('visivel');
    return;
  }
  const obs = new IntersectionObserver(
    (entradas) => {
      for (const en of entradas) {
        if (en.isIntersecting) {
          en.target.classList.add('visivel');
          obs.unobserve(en.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  for (const el of itens) obs.observe(el);
}

/* ---------- telas que se endireitam ao rolar ---------- */
function iniciarParalaxe() {
  if (reduzMovimento) return;
  const telas = $$('[data-paralaxe]');
  if (!telas.length) return;
  let pedido = 0;
  const atualizar = () => {
    pedido = 0;
    const alturaJanela = window.innerHeight;
    for (const el of telas) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > alturaJanela) continue;
      // 0 quando o topo da tela está no fim da janela, 1 quando chega a 35% da altura
      const p = Math.min(1, Math.max(0, (alturaJanela - r.top) / (alturaJanela * 0.65)));
      const inclina = (1 - p) * 10;
      const escala = 0.95 + p * 0.05;
      el.style.transform = `perspective(1600px) rotateX(${inclina.toFixed(2)}deg) scale(${escala.toFixed(3)})`;
    }
  };
  const pedir = () => {
    if (!pedido) pedido = requestAnimationFrame(atualizar);
  };
  // a primeira dobra tem animação de entrada própria: só assume depois dela
  setTimeout(() => {
    // a animação de entrada fica "presa" no fim e passaria por cima do transform
    for (const el of telas) el.style.animation = 'none';
    atualizar();
    window.addEventListener('scroll', pedir, { passive: true });
    window.addEventListener('resize', pedir);
  }, 1500);
}

/* ---------- tour pelas telas ---------- */
function iniciarTour() {
  const tour = $('[data-tour]');
  if (!tour) return;
  const abas = $$('[role="tab"]', tour);
  const url = $('[data-tour-url]', tour);
  const TEMPO = 7000;
  let atual = 0;
  let relogio = 0;
  let automatico = !reduzMovimento;
  let visivel = false;

  const mostrar = (i, foco = false) => {
    atual = (i + abas.length) % abas.length;
    abas.forEach((aba, k) => {
      const on = k === atual;
      const id = aba.id.replace('aba-', '');
      aba.setAttribute('aria-selected', String(on));
      aba.tabIndex = on ? 0 : -1;
      const painel = $(`#painel-${id}`);
      if (painel) {
        painel.hidden = !on;
        if (on) {
          painel.classList.remove('troca');
          void painel.offsetWidth; // reinicia a animação de entrada
          painel.classList.add('troca');
        }
      }
      const img = $(`[data-img="${id}"]`, tour);
      if (img) {
        if (on) img.loading = 'eager';
        img.classList.toggle('ativa', on);
      }
    });
    if (url) url.textContent = abas[atual].dataset.url || '';
    if (foco) abas[atual].focus();
    agendar();
  };

  const parar = () => {
    automatico = false;
    tour.classList.remove('tour--auto');
    clearTimeout(relogio);
  };
  const agendar = () => {
    clearTimeout(relogio);
    if (!automatico || !visivel) return;
    // reinicia a barrinha de tempo da aba
    tour.classList.remove('tour--auto');
    void tour.offsetWidth;
    tour.classList.add('tour--auto');
    relogio = setTimeout(() => mostrar(atual + 1), TEMPO);
  };

  tour.style.setProperty('--tempo-aba', `${TEMPO}ms`);
  abas.forEach((aba, k) => {
    aba.addEventListener('click', () => {
      parar();
      mostrar(k);
    });
    aba.addEventListener('keydown', (e) => {
      const teclas = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (e.key in teclas) {
        e.preventDefault();
        parar();
        mostrar(atual + teclas[e.key], true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        parar();
        mostrar(e.key === 'Home' ? 0 : abas.length - 1, true);
      }
    });
  });
  tour.addEventListener('pointerenter', () => clearTimeout(relogio));
  tour.addEventListener('pointerleave', agendar);

  if (!automatico) tour.classList.remove('tour--auto');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([en]) => {
        visivel = en.isIntersecting;
        if (visivel) agendar();
        else clearTimeout(relogio);
      },
      { threshold: 0.35 },
    ).observe(tour);
  }
}

/* ---------- simulador de ganho ---------- */
const reais = (v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
const inteiro = (v) => Math.round(v).toLocaleString('pt-BR');

function iniciarSimulador() {
  const raiz = $('[data-simulador]');
  if (!raiz) return;
  const form = $('form', raiz);
  const mostrar = {
    pessoas: (v) => `${v} ${v === 1 ? 'pessoa' : 'pessoas'}`,
    leads: (v) => `${v} leads`,
    minutos: (v) => `${v} min`,
    fecha: (v) => `${String(v).replace('.', ',')}%`,
    ticket: (v) => reais(v),
  };
  const formatos = {
    horas: (v) => `${inteiro(v)} h`,
    abordagens: inteiro,
    clientes: (v) => (Math.round(v * 10) / 10).toLocaleString('pt-BR'),
    receita: reais,
    ano: reais,
  };
  const anterior = {};
  const animacoes = {};

  const animar = (chave, alvo) => {
    const el = $(`[data-saida="${chave}"]`, raiz);
    if (!el) return;
    const de = anterior[chave] ?? 0;
    anterior[chave] = alvo;
    cancelAnimationFrame(animacoes[chave]);
    if (reduzMovimento || de === alvo) {
      el.textContent = formatos[chave](alvo);
      return;
    }
    const inicio = performance.now();
    const dur = 450;
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / dur);
      const suave = 1 - (1 - t) ** 3;
      el.textContent = formatos[chave](de + (alvo - de) * suave);
      if (t < 1) animacoes[chave] = requestAnimationFrame(passo);
    };
    animacoes[chave] = requestAnimationFrame(passo);
  };

  const calcular = () => {
    const v = Object.fromEntries([...new FormData(form)].map(([k, x]) => [k, Number(x)]));
    for (const [k, fn] of Object.entries(mostrar)) {
      const out = $(`[data-mostra="${k}"]`, raiz);
      if (out) out.textContent = fn(v[k]);
    }
    const DIAS_UTEIS = 22;
    const MIN_REVISAO = 1;
    const PARTE_EM_ABORDAGEM = 0.5; // metade do tempo devolvido vira abordagem nova
    const MIN_ABORDAGEM = 10; // primeira mensagem + follow-ups de um lead
    const horas = (v.pessoas * v.leads * Math.max(0, v.minutos - MIN_REVISAO) * DIAS_UTEIS) / 60;
    const abordagens = (horas * PARTE_EM_ABORDAGEM * 60) / MIN_ABORDAGEM;
    const clientes = (abordagens * v.fecha) / 100;
    const receita = clientes * v.ticket;
    // clientes novos todo mês: ao fim de 12 meses, a receita mensal nova é 12 vezes a de um mês
    const ano = receita * 12;
    animar('horas', horas);
    animar('abordagens', abordagens);
    animar('clientes', clientes);
    animar('receita', receita);
    animar('ano', ano);
  };
  form.addEventListener('input', calcular);
  form.addEventListener('submit', (e) => e.preventDefault());
  calcular();
}

/* ---------- contato: abre WhatsApp ou e-mail com a mensagem pronta ---------- */
function iniciarContato() {
  const form = $('[data-contato]');
  if (!form) return;
  const erro = $('[data-erro]', form);
  const botoes = {
    whatsapp: $('[data-canal="whatsapp"]', form),
    email: $('[data-canal="email"]', form),
  };
  if (!CONTATO.whatsapp) botoes.whatsapp?.remove();
  if (!CONTATO.email) botoes.email?.remove();
  if (!CONTATO.whatsapp && !CONTATO.email) {
    const aviso = document.createElement('p');
    aviso.className = 'formulario__nota';
    aviso.textContent = 'Contato em breve.';
    $('.formulario__acoes', form)?.append(aviso);
  }

  // o botão do plano já escolhe o plano no formulário
  for (const a of $$('[data-plano]')) {
    a.addEventListener('click', () => {
      const sel = $('#ct-plano');
      if (sel) sel.value = a.dataset.plano;
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(form));
    const nome = String(dados.nome || '').trim();
    const empresa = String(dados.empresa || '').trim();
    erro.hidden = Boolean(nome && empresa);
    for (const campo of ['nome', 'empresa']) {
      const el = form.elements[campo];
      el.setAttribute('aria-invalid', String(!String(dados[campo] || '').trim()));
    }
    if (!nome || !empresa) {
      (nome ? form.elements.empresa : form.elements.nome).focus();
      return;
    }
    const linhas = [
      `Olá! Sou ${nome}, da ${empresa}.`,
      'Quero ver uma demonstração do Prospect Team.',
      dados.nicho ? `Vendemos para: ${String(dados.nicho).trim()}.` : '',
      dados.plano && dados.plano !== 'Ainda não sei' ? `Plano de interesse: ${dados.plano}.` : '',
    ].filter(Boolean);
    const texto = linhas.join('\n');
    const canal = e.submitter?.dataset.canal || (CONTATO.whatsapp ? 'whatsapp' : 'email');
    if (canal === 'whatsapp' && CONTATO.whatsapp) {
      window.open(
        `https://wa.me/${CONTATO.whatsapp}?text=${encodeURIComponent(texto)}`,
        '_blank',
        'noopener',
      );
    } else if (CONTATO.email) {
      const assunto = encodeURIComponent(`Demonstração do Prospect Team · ${empresa}`);
      window.location.href = `mailto:${CONTATO.email}?subject=${assunto}&body=${encodeURIComponent(texto)}`;
    }
  });
  for (const campo of ['nome', 'empresa']) {
    form.elements[campo].addEventListener('input', (e) => {
      if (e.target.value.trim()) e.target.removeAttribute('aria-invalid');
    });
  }
}

function iniciar() {
  const ano = $('[data-ano]');
  if (ano) ano.textContent = String(new Date().getFullYear());
  iniciarTopo();
  iniciarRevelar();
  iniciarParalaxe();
  iniciarTour();
  iniciarSimulador();
  iniciarContato();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
