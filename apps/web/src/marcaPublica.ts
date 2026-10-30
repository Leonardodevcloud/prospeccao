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
  cor: string | null;
  /** Caminhos na api (sem o /api na frente). */
  logo: string | null;
  icone: string | null;
  imagem: string | null;
  versao: string;
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

const VARS = ['--brand', '--brand-hover', '--brand-soft', '--focus-ring'];

/** A cor da marca vira a cor do sistema (botões, links, destaques). null volta à cor padrão. */
export function aplicarCor(cor: string | null): () => void {
  const raiz = document.documentElement.style;
  const limpar = () => {
    for (const v of VARS) raiz.removeProperty(v);
  };
  if (!cor) {
    limpar();
    return limpar;
  }
  raiz.setProperty('--brand', cor);
  raiz.setProperty('--brand-hover', `color-mix(in srgb, ${cor} 85%, black)`);
  raiz.setProperty('--brand-soft', `color-mix(in srgb, ${cor} 12%, white)`);
  raiz.setProperty('--focus-ring', `0 0 0 2px #f7f7f5, 0 0 0 4px ${cor}`);
  return limpar;
}

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
export function aplicarNoNavegador(m: { nome: string; cor: string | null; icone: string | null } | null) {
  const host = hostAberto();
  nomeNaAba = m?.nome || 'Prospect Team';
  if (m?.icone) {
    trocarLink('icon', `/api${m.icone}`, 'image/png');
    trocarLink('apple-touch-icon', `/api${m.icone}`);
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
  trocarMeta('theme-color', m?.cor ?? '#0b6b63');
  trocarMeta('apple-mobile-web-app-title', nomeNaAba);
  // Título simples das telas sem título próprio.
  if (/Prospect Team/.test(document.title) || !document.title) document.title = nomeNaAba;
}

/** Telas sem login (entrada, convite, senha): aplica a marca do endereço e a desfaz ao sair. */
export function useMarcaNoNavegador(m: MarcaPublica | null) {
  const nome = m?.nome ?? null;
  const cor = m?.cor ?? null;
  const icone = m?.icone ?? null;
  useEffect(() => {
    if (!nome) return;
    aplicarNoNavegador({ nome, cor, icone });
    const limpar = aplicarCor(cor);
    return () => {
      limpar();
    };
  }, [nome, cor, icone]);
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
