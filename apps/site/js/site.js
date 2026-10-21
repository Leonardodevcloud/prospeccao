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

/* ---------- logo: o time dá pulinhos em onda ao carregar e ao passar o mouse ---------- */
function pular(el) {
  if (reduzMovimento || el.classList.contains('pulando')) return;
  el.classList.add('pulando');
  const ultima = $$('.logo__fig', el).at(-1);
  const fim = () => el.classList.remove('pulando');
  ultima?.addEventListener('animationend', fim, { once: true });
  setTimeout(fim, 1200); // garantia, se a animação não rodar
}

function iniciarLogo() {
  for (const marca of $$('.marca')) {
    marca.addEventListener('pointerenter', () => pular(marca));
    marca.addEventListener('focus', () => pular(marca));
  }
  const topo = $('.topo .marca');
  if (topo) setTimeout(() => pular(topo), 450);
  // o do rodapé pula quando aparece
  const rodape = $('.rodape .marca');
  if (rodape && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) {
        pular(rodape);
        obs.disconnect();
      }
    });
    obs.observe(rodape);
  }
}

/* ---------- barra de leitura ---------- */
function iniciarProgresso() {
  const barra = $('.progresso');
  if (!barra) return;
  let pedido = 0;
  const atualizar = () => {
    pedido = 0;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    barra.style.setProperty('--lido', String(total > 0 ? Math.min(1, window.scrollY / total) : 0));
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!pedido) pedido = requestAnimationFrame(atualizar);
    },
    { passive: true },
  );
  atualizar();
}

/* ---------- nichos: o console monta a busca do nicho escolhido ---------- */
const NICHOS = {
  autopecas: {
    nome: 'Autopeças',
    cidades: 'Salvador, Feira de Santana e Lauro de Freitas',
    cnaes: '4530-7/03 · 4530-7/01',
    termos: '“autopeças”, “peças automotivas”',
    decisor: 'sócio-administrador, gerente de compras',
  },
  farmacias: {
    nome: 'Farmácias',
    cidades: 'Recife, Olinda e Jaboatão dos Guararapes',
    cnaes: '4771-7/01 · 4771-7/02',
    termos: '“farmácia”, “drogaria”',
    decisor: 'sócio, farmacêutico responsável',
  },
  petshops: {
    nome: 'Pet shops',
    cidades: 'Curitiba, São José dos Pinhais e Colombo',
    cnaes: '4789-0/04 · 9609-2/08',
    termos: '“pet shop”, “banho e tosa”',
    decisor: 'sócio-administrador, gerente da loja',
  },
  construcao: {
    nome: 'Materiais de construção',
    cidades: 'Goiânia, Aparecida de Goiânia e Anápolis',
    cnaes: '4744-0/99 · 4744-0/01',
    termos: '“material de construção”, “home center”',
    decisor: 'sócio, comprador',
  },
  restaurantes: {
    nome: 'Restaurantes',
    cidades: 'São Paulo, Santo André e Guarulhos',
    cnaes: '5611-2/01 · 5611-2/03',
    termos: '“restaurante”, “lanchonete”',
    decisor: 'sócio, gerente geral',
  },
  clinicas: {
    nome: 'Clínicas',
    cidades: 'Belo Horizonte, Contagem e Betim',
    cnaes: '8630-5/03 · 8630-5/04',
    termos: '“clínica”, “consultório odontológico”',
    decisor: 'sócio, gestor administrativo',
  },
  supermercados: {
    nome: 'Supermercados',
    cidades: 'Fortaleza, Caucaia e Maracanaú',
    cnaes: '4711-3/02 · 4712-1/00',
    termos: '“supermercado”, “mercadinho”',
    decisor: 'sócio, gerente de compras',
  },
  oticas: {
    nome: 'Óticas',
    cidades: 'Porto Alegre, Canoas e Novo Hamburgo',
    cnaes: '4774-1/00',
    termos: '“ótica”, “óculos”',
    decisor: 'sócio-administrador',
  },
  academias: {
    nome: 'Academias',
    cidades: 'Rio de Janeiro, Niterói e São Gonçalo',
    cnaes: '9313-1/00',
    termos: '“academia”, “estúdio de pilates”',
    decisor: 'sócio, gerente da unidade',
  },
  contabilidade: {
    nome: 'Contabilidade',
    cidades: 'Brasília, Taguatinga e Águas Claras',
    cnaes: '6920-6/01',
    termos: '“escritório de contabilidade”, “contador”',
    decisor: 'sócio, contador responsável',
  },
  distribuidores: {
    nome: 'Distribuidores',
    cidades: 'Campinas, Sorocaba e Jundiaí',
    cnaes: '4639-7/01 · 4691-5/00',
    termos: '“distribuidora”, “atacado”',
    decisor: 'diretor comercial, gerente de compras',
  },
  motopecas: {
    nome: 'Motopeças',
    cidades: 'Manaus, Belém e São Luís',
    cnaes: '4541-2/03',
    termos: '“motopeças”, “peças para moto”',
    decisor: 'sócio-administrador',
  },
};

function iniciarNichos() {
  const raiz = $('[data-nichos]');
  if (!raiz) return;
  const botoes = $$('.nicho', raiz);
  const linhas = $$('.console__linhas li', raiz);
  const campos = Object.fromEntries($$('[data-campo]', raiz).map((el) => [el.dataset.campo, el]));
  let atual = 0;
  let relogio = 0;
  let digitando = 0;
  let automatico = true;
  let visivel = false;

  const escrever = (el, texto, depois) => {
    if (reduzMovimento) {
      el.textContent = texto;
      depois();
      return;
    }
    let i = 0;
    el.textContent = '';
    el.classList.add('console__cursor');
    const passo = () => {
      i += Math.max(1, Math.round(texto.length / 22));
      el.textContent = texto.slice(0, i);
      if (i < texto.length) digitando = window.setTimeout(passo, 18);
      else {
        el.classList.remove('console__cursor');
        depois();
      }
    };
    passo();
  };

  const mostrar = (k, foco = false) => {
    atual = (k + botoes.length) % botoes.length;
    botoes.forEach((b, j) => {
      b.setAttribute('aria-selected', String(j === atual));
      b.tabIndex = j === atual ? 0 : -1;
    });
    if (foco) botoes[atual].focus();
    const d = NICHOS[botoes[atual].dataset.nicho];
    window.clearTimeout(digitando);
    for (const el of $$('.console__cursor', raiz)) el.classList.remove('console__cursor');
    for (const l of linhas) l.classList.add('apagada');
    const ordem = ['nome', 'cidades', 'cnaes', 'termos', 'decisor'];
    const proxima = (n) => {
      if (n >= ordem.length) {
        linhas[linhas.length - 1].classList.remove('apagada');
        agendar();
        return;
      }
      linhas[n].classList.remove('apagada');
      escrever(campos[ordem[n]], d[ordem[n]], () => {
        digitando = window.setTimeout(() => proxima(n + 1), reduzMovimento ? 0 : 140);
      });
    };
    proxima(0);
  };
  const agendar = () => {
    window.clearTimeout(relogio);
    if (automatico && visivel && !reduzMovimento) relogio = window.setTimeout(() => mostrar(atual + 1), 3800);
  };
  const parar = () => {
    automatico = false;
    window.clearTimeout(relogio);
  };
  botoes.forEach((b, j) => {
    b.addEventListener('click', () => {
      parar();
      mostrar(j);
    });
    b.addEventListener('keydown', (e) => {
      const teclas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (e.key in teclas) {
        e.preventDefault();
        parar();
        mostrar(atual + teclas[e.key], true);
      }
    });
  });
  if ('IntersectionObserver' in window) {
    let primeira = true;
    new IntersectionObserver(
      ([en]) => {
        visivel = en.isIntersecting;
        if (visivel && primeira) {
          primeira = false;
          mostrar(0);
        } else if (visivel) agendar();
        else window.clearTimeout(relogio);
      },
      { threshold: 0.3 },
    ).observe(raiz);
  }
}

/* ---------- o dia do vendedor: vira sozinho para "com" quando aparece ---------- */
function iniciarDia() {
  const lista = $('[data-dia]');
  const grupo = $('.alternador');
  if (!lista || !grupo) return;
  const botoes = $$('.alternador__botao', grupo);
  let mexeu = false;
  const lado = (l) => {
    lista.dataset.lado = l;
    grupo.dataset.lado = l;
    for (const b of botoes) b.setAttribute('aria-pressed', String(b.dataset.lado === l));
  };
  for (const b of botoes)
    b.addEventListener('click', () => {
      mexeu = true;
      lado(b.dataset.lado);
    });
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(
    ([en]) => {
      if (!en.isIntersecting) return;
      obs.disconnect();
      window.setTimeout(() => {
        if (!mexeu) lado('com');
      }, 2600);
    },
    { threshold: 0.5 },
  );
  obs.observe(lista);
}

/* ---------- jornada: o cartão do lead anda conforme a rolagem ---------- */
function iniciarJornada() {
  const raiz = $('[data-jornada]');
  if (!raiz) return;
  const passos = $$('.jornada__passo', raiz);
  const blocos = $$('.lead-vivo__bloco', raiz);
  const rotulo = $('[data-rotulo]', raiz);
  const trilho = $('.lead-vivo__trilho span', raiz);
  const NOMES = ['Encontrada', 'Enriquecida', 'Abordada', 'Respondeu', 'Reunião', 'Cliente'];
  const ir = (n) => {
    raiz.dataset.etapa = String(n);
    passos.forEach((p, i) => {
      p.classList.toggle('ativo', i === n);
    });
    blocos.forEach((b) => {
      const a = Number(b.dataset.a);
      b.classList.toggle('feito', a <= n);
      b.classList.toggle('atual', a === n);
    });
    if (rotulo) rotulo.textContent = NOMES[n];
    if (trilho) trilho.style.setProperty('--andou', String((n + 1) / NOMES.length));
  };
  ir(0);
  if (!('IntersectionObserver' in window)) {
    ir(NOMES.length - 1);
    return;
  }
  const obs = new IntersectionObserver(
    (entradas) => {
      for (const en of entradas) if (en.isIntersecting) ir(Number(en.target.dataset.passo));
    },
    {
      rootMargin: window.matchMedia('(max-width: 960px)').matches ? '-58% 0px -32% 0px' : '-45% 0px -45% 0px',
    },
  );
  for (const p of passos) obs.observe(p);
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
  iniciarProgresso();
  iniciarNichos();
  iniciarDia();
  iniciarJornada();
  iniciarLogo();
  iniciarRevelar();
  iniciarParalaxe();
  iniciarTour();
  iniciarContato();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
