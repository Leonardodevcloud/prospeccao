import {
  BackgroundProcessor,
  type BackgroundProcessorWrapper,
  type SwitchBackgroundProcessorOptions,
  supportsBackgroundProcessors,
} from '@livekit/track-processors';
import { CENAS_FUNDO, type ConfigFundos, EFEITOS_FUNDO, nomeDoFundo } from '@prospeccao/shared/fundos';
import type { LocalVideoTrack } from 'livekit-client';
import { useSyncExternalStore } from 'react';
import { imagemDoFundo, type MarcaDoFundo } from './fundosImagem';

export { imagemDoFundo, type MarcaDoFundo } from './fundosImagem';

/**
 * Fundo da câmera nas reuniões (como no Meet): desfoque, cenários e fotos da empresa com a logo dela.
 * Tudo acontece no navegador: a câmera sai daqui já com o fundo trocado, então quem está na sala e a
 * gravação veem o mesmo que a pessoa escolheu.
 */

/** O que a sala manda para quem é do time (o convidado recebe null). */
export interface FundosDaEmpresa {
  comLogo: boolean;
  /** Endereço da logo (já com /api). */
  logo: string | null;
  config: ConfigFundos;
  fotos: { id: number; nome: string; url: string }[];
}

export interface OpcaoFundo {
  id: string;
  nome: string;
  grupo: 'efeitos' | 'pessoais' | 'empresa' | 'simples';
}

export const suportaFundos = (): boolean => {
  try {
    return supportsBackgroundProcessors();
  } catch {
    return false;
  }
};

/** Os fundos que a pessoa pode escolher (o time segue a configuração da empresa). */
export function opcoesDeFundo(
  f: FundosDaEmpresa | null,
  doTime: boolean,
  pessoais: { id: string; nome: string }[] = [],
): OpcaoFundo[] {
  const meus: OpcaoFundo[] = pessoais.map((p) => ({ id: p.id, nome: p.nome, grupo: 'pessoais' }));
  const efeitos: OpcaoFundo[] = EFEITOS_FUNDO.map((e) => ({ id: e.id, nome: e.nome, grupo: 'efeitos' }));
  const simples: OpcaoFundo[] = CENAS_FUNDO.filter((c) => c.arquivo).map((c) => ({
    id: `cena:${c.id}`,
    nome: c.nome,
    grupo: 'simples',
  }));
  if (!doTime || !f) return [...efeitos, ...meus, ...simples];
  const c = f.config;
  const empresa: OpcaoFundo[] = f.comLogo
    ? [...CENAS_FUNDO.map((x) => `logo:${x.id}`), ...f.fotos.map((x) => `foto:${x.id}`)]
        .filter((id) => c.liberados.includes(id))
        .map((id) => ({ id, nome: nomeDoFundo(id, f.fotos), grupo: 'empresa' as const }))
    : [];
  // "Desfoque e cenários sem logo" desligado pelo gestor: também sem os fundos próprios.
  const todas = c.simples ? [...efeitos, ...meus, ...empresa, ...simples] : [efeitos[0]!, ...empresa];
  // Travado: só o padrão (se ele ainda existir).
  if (c.travar && c.padrao) {
    const p = todas.find((o) => o.id === c.padrao);
    if (p) return [p];
  }
  return todas;
}

const CHAVE = (doTime: boolean) => (doTime ? 'reuniao:fundo:time' : 'reuniao:fundo');

/** O fundo que já vem escolhido: o travado, o último que a pessoa usou ou o padrão da empresa. */
export function fundoInicial(opcoes: OpcaoFundo[], f: FundosDaEmpresa | null, doTime: boolean): string {
  const existe = (id: string | null | undefined) => !!id && opcoes.some((o) => o.id === id);
  if (doTime && f?.config.travar && existe(f.config.padrao)) return f.config.padrao!;
  let salvo: string | null = null;
  try {
    salvo = localStorage.getItem(CHAVE(doTime));
  } catch {
    // sem lembrar
  }
  if (existe(salvo)) return salvo!;
  if (doTime && existe(f?.config.padrao)) return f!.config.padrao!;
  return 'nenhum';
}

export function lembrarFundo(id: string, doTime: boolean): void {
  try {
    localStorage.setItem(CHAVE(doTime), id);
  } catch {
    // modo privado
  }
}

/* ---------- Aplicar na câmera ---------- */

/** Fundo com logo ou foto: a pessoa se vê sem espelho (o que tem escrito aparece como os outros veem). */
export const fundoSemEspelho = (id: string) => /^(logo|foto|meu|local):/.test(id);

let atual = 'nenhum';
const ouvintes = new Set<() => void>();
function definirAtual(id: string) {
  if (id === atual) return;
  atual = id;
  for (const o of ouvintes) o();
}
/** O fundo em uso na câmera (para a sala decidir o espelho da própria imagem). */
export function useFundoAtual(): string {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => atual,
  );
}

/** Qual fundo cada processador está mostrando. */
const usado = new WeakMap<object, string>();

async function opcoesDoFundo(id: string, m: MarcaDoFundo | null): Promise<SwitchBackgroundProcessorOptions> {
  return id.startsWith('desfoque')
    ? { mode: 'background-blur', blurRadius: id === 'desfoque-forte' ? 18 : 7 }
    : { mode: 'virtual-background', imagePath: await imagemDoFundo(id, m) };
}

/** Processador já com o fundo (para a câmera nascer com ele, sem mostrar o fundo real nem um instante). */
export async function criarProcessador(
  id: string,
  m: MarcaDoFundo | null,
): Promise<BackgroundProcessorWrapper> {
  const p = BackgroundProcessor(await opcoesDoFundo(id, m), 'fundo');
  usado.set(p, id);
  definirAtual(id);
  return p;
}

/**
 * Coloca o fundo na câmera (ou tira). Na primeira vez carrega o modelo que separa a pessoa do fundo
 * (alguns segundos); depois, trocar é na hora.
 */
export async function aplicarFundo(
  faixa: LocalVideoTrack,
  id: string,
  m: MarcaDoFundo | null,
): Promise<void> {
  const processador = faixa.getProcessor() as BackgroundProcessorWrapper | undefined;
  if (id === 'nenhum') {
    if (processador) await faixa.stopProcessor();
    definirAtual(id);
    return;
  }
  if (processador && usado.get(processador) === id) {
    definirAtual(id);
    return;
  }
  const opcoes = await opcoesDoFundo(id, m);
  if (processador && 'switchTo' in processador) {
    await processador.switchTo(opcoes);
    usado.set(processador, id);
  } else {
    const novo = BackgroundProcessor(opcoes, 'fundo');
    await faixa.setProcessor(novo);
    usado.set(novo, id);
  }
  definirAtual(id);
}

export function esquecerFundo(): void {
  definirAtual('nenhum');
}
