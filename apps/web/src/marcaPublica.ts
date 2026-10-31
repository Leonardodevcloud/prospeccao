import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';

/**
 * Marca própria do cliente pelo endereço aberto (crm.empresa.com.br): o login, o convite, o "esqueci a
 * senha" e a aba do navegador ficam com o nome, a cor, o logo e o ícone da empresa. Nos endereços do
 * Prospect Team não há marca de cliente (fica a nossa).
 */

export interface MarcaPublica {
  nome: string;
  /** Primária (botões). */
  cor: string | null;
  corSecundaria?: string | null;
  corDestaque?: string | null;
  corClara?: string | null;
  /** Caminhos na api (sem o /api na frente). Logo para fundo claro. */
  logo: string | null;
  logoEscuro?: string | null;
  icone: string | null;
  favicon?: string | null;
  app?: string | null;
  imagem: string | null;
  versao: string;
}

/** As quatro cores da marca (as que faltam ficam com as do sistema). */
export interface CoresDaMarca {
  cor: string | null;
  corSecundaria?: string | null;
  corDestaque?: string | null;
  corClara?: string | null;
}

/** Site institucional (o "Tecnologia Prospect Team" discreto no rodapé leva para ele). */
export const SITE_PROSPECT_TEAM = 'https://prospectteam.com.br';

const DA_PLATAFORMA = /(^|\.)(prospectteam\.com\.br|vercel\.app)$/;

/** O endereço aberto (em desenvolvimento, dá para simular um domínio com ?dominio= ou o localStorage). */
function hostAberto(): string {
  if (typeof location === 'undefined') return '';
  if (import.meta.env.DEV) {
    try {
      const simular = new URLSearchParams(location.search).get('dominio');
      if (simular) localStorage.setItem('dominio-simulado', simular);
      return localStorage.getItem('dominio-simulado') || location.hostname;
    } catch {
      return location.hostname;
    }
  }
  return location.hostname;
}

export const enderecoDeCliente = () => {
  const h = hostAberto();
  return !!h && h !== 'localhost' && !DA_PLATAFORMA.test(h) && !/^[\d.]+$/.test(h);
};

/**
 * Marca do endereço aberto; null nos endereços do Prospect Team (ou se o plano não tem marca própria).
 * `carregando`: no domínio de um cliente, ainda buscando (a tela espera, sem piscar a nossa marca).
 */
export function useMarcaDoEndereco(): { marca: MarcaPublica | null; carregando: boolean } {
  const host = hostAberto();
  const ativo = enderecoDeCliente();
  const q = useQuery({
    queryKey: ['marca-do-endereco', host],
    queryFn: () => api<{ marca: MarcaPublica | null }>(`/publico/marca?host=${encodeURIComponent(host)}`),
    enabled: ativo,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { marca: ativo ? (q.data?.marca ?? null) : null, carregando: ativo && q.isPending };
}

const VARS = ['--brand', '--brand-hover', '--brand-soft', '--focus-ring', '--link', '--marca-secundaria'];

/**
 * As cores da marca viram as do sistema: primária nos botões, destaque nos links e gráficos, clara
 * nas etiquetas e a secundária no menu (quando a empresa liga) e nas telas de entrada.
 * Sem cor, volta ao padrão. Devolve a função que desfaz.
 */
export function aplicarCores(c: CoresDaMarca | null): () => void {
  const raiz = document.documentElement.style;
  const limpar = () => {
    for (const v of VARS) raiz.removeProperty(v);
  };
  limpar();
  if (!c) return limpar;
  const { cor } = c;
  if (cor) {
    raiz.setProperty('--brand', cor);
    raiz.setProperty('--brand-hover', `color-mix(in srgb, ${cor} 85%, black)`);
    raiz.setProperty('--brand-soft', `color-mix(in srgb, ${cor} 12%, white)`);
    raiz.setProperty('--focus-ring', `0 0 0 2px #f7f7f5, 0 0 0 4px ${cor}`);
  }
  if (c.corClara) raiz.setProperty('--brand-soft', c.corClara);
  if (c.corDestaque) raiz.setProperty('--link', c.corDestaque);
  if (c.corSecundaria) raiz.setProperty('--marca-secundaria', c.corSecundaria);
  return limpar;
}

/** Só a cor primária (compatível com o que já existia). */
export const aplicarCor = (cor: string | null) => aplicarCores(cor ? { cor } : null);

/** Nome que vai no título da aba ("Horizonte" ou "Prospect Team"). */
let nomeNaAba = 'Prospect Team';
export const nomeDaAba = () => nomeNaAba;

function trocarLink(rel: string, href: string, tipo?: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  if (el.getAttribute('href') !== href) el.href = href;
  if (tipo) el.type = tipo;
  else el.removeAttribute('type');
}

function trocarMeta(nome: string, valor: string) {
  const el = document.head.querySelector<HTMLMetaElement>(`meta[name="${nome}"]`);
  if (el) el.content = valor;
}

/**
 * Ícone da aba, nome, cor do celular e manifesto (o app instalado) com a marca do cliente.
 * Sem marca, tudo volta ao do Prospect Team.
 */
export function aplicarNoNavegador(
  m: {
    nome: string;
    cor: string | null;
    corSecundaria?: string | null;
    icone: string | null;
    app?: string | null;
  } | null,
) {
  const host = hostAberto();
  nomeNaAba = m?.nome || 'Prospect Team';
  if (m?.icone) {
    // `icone` aqui é o da aba (o da marca quando a empresa não mandou um próprio).
    trocarLink('icon', `/api${m.icone}`, 'image/png');
    trocarLink('apple-touch-icon', `/api${m.app ?? m.icone}`);
  } else {
    trocarLink('icon', '/icone.svg', 'image/svg+xml');
    trocarLink('apple-touch-icon', '/icone-180.png');
  }
  trocarLink(
    'manifest',
    m && enderecoDeCliente()
      ? `/api/publico/marca/manifest?host=${encodeURIComponent(host)}`
      : '/manifest.webmanifest',
  );
  trocarMeta('theme-color', m?.corSecundaria ?? m?.cor ?? '#0b6b63');
  trocarMeta('apple-mobile-web-app-title', nomeNaAba);
  // Título simples das telas sem título próprio.
  if (/Prospect Team/.test(document.title) || !document.title) document.title = nomeNaAba;
}

/** Telas sem login (entrada, convite, senha): aplica a marca do endereço e a desfaz ao sair. */
export function useMarcaNoNavegador(m: MarcaPublica | null) {
  const nome = m?.nome ?? null;
  const cor = m?.cor ?? null;
  const sec = m?.corSecundaria ?? null;
  const dest = m?.corDestaque ?? null;
  const clara = m?.corClara ?? null;
  const icone = m?.favicon ?? m?.icone ?? null;
  const app = m?.app ?? null;
  useEffect(() => {
    if (!nome) return;
    aplicarNoNavegador({ nome, cor, corSecundaria: sec, icone, app });
    const limpar = aplicarCores({ cor, corSecundaria: sec, corDestaque: dest, corClara: clara });
    return () => {
      limpar();
    };
  }, [nome, cor, sec, dest, clara, icone, app]);
}

/** Iniciais do nome ("Construtora Horizonte" → "CH"), para quando não há ícone. */
export function iniciais(nome: string): string {
  return (
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '•'
  );
}
