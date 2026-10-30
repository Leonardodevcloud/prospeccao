import type { EntradaSala, PapelNaSala, ResumoReuniao, SituacaoSala } from '@prospeccao/shared/reunioes';
import { ErroApi } from '../api';

/**
 * API da sala de reunião (página pública do link). Quem já entrou manda a credencial que a api deu
 * na entrada; o convidado não tem login.
 */
export async function apiSala<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; credencial?: string | null } = {},
): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/salas${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opcoes.credencial ? { 'x-credencial-sala': opcoes.credencial } : {}),
      },
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'sem_conexao', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = dados?.erro;
    throw new ErroApi(
      resposta.status,
      erro?.codigo ?? 'erro',
      erro?.mensagem ?? `Erro ${resposta.status}. Tente de novo.`,
      erro?.detalhes,
    );
  }
  return dados as T;
}

export interface InfoSala {
  codigo: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  abreEm: string;
  situacao: SituacaoSala;
  entrada: EntradaSala;
  gravar: boolean;
  transcrever: boolean;
  /** Quem grava: o navegador de alguém do time (padrão), o servidor (na nuvem) ou ninguém. */
  gravacao: 'navegador' | 'nuvem' | null;
  empresa: { nome: string; cor: string | null; logo: string | null };
  anfitriao: string | null;
  presentes: string[];
  voce: { nome: string; doTime: true } | null;
  videoConfigurado: boolean;
  agora: string;
}

export type ResultadoEntrada =
  | {
      estado: 'liberado';
      participanteId: string;
      segredo: string | null;
      nome: string;
      papel: PapelNaSala;
      url: string;
      token: string;
      credencial: string;
      sessaoId: number;
      gravando: boolean;
      gravacao: 'navegador' | 'nuvem' | null;
      transcrever: boolean;
    }
  | { estado: 'aguardando'; participanteId: string; segredo: string }
  | { estado: 'recusado' };

export type Liberado = Extract<ResultadoEntrada, { estado: 'liberado' }>;

export interface ArquivoChat {
  id: number;
  nome: string;
  mime: string;
  tamanho: number;
  url: string;
}

export interface MensagemChat {
  id: number;
  participanteId: string | null;
  autor: string;
  texto: string | null;
  arquivo: ArquivoChat | null;
  criadoEm: string;
}

export interface PessoaNaEspera {
  id: string;
  nome: string;
  desde: string;
}

/* ───────────── CRM ───────────── */

export interface EstadoReunioes {
  /** O plano da empresa não tem reuniões por vídeo. */
  foraDoPlano?: boolean;
  video: boolean;
  gravacao: boolean;
  transcricao: boolean;
}

export interface SalaResumo {
  salaId: number;
  codigo: string;
  link: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  status: 'marcada' | 'ao_vivo' | 'encerrada' | 'cancelada';
  gravar: boolean;
  transcrever: boolean;
  entrada: EntradaSala;
  abreMinutosAntes: number;
  empresaId: number | null;
  empresaNome: string | null;
  anfitriaoId: number | null;
  anfitriaoNome: string | null;
  tarefaId: number | null;
  conviteEnviadoEm: string | null;
}

export type SituacaoSessao = 'ao_vivo' | 'processando' | 'pronta' | 'encerrada' | 'erro';

export interface SessaoResumo extends SalaResumo {
  id: number;
  iniciadaEm: string;
  encerradaEm: string | null;
  duracaoSegundos: number | null;
  situacao: SituacaoSessao;
  transcricao: 'pendente' | 'pronta' | 'sem_audio' | 'desligada' | 'erro' | null;
  temVideo: boolean;
  resumo: string | null;
  interesse: string | null;
  erro: string | null;
  pessoas: number;
}

export interface FalaReuniao {
  identidade: string;
  nome: string;
  inicioMs: number;
  fimMs: number;
  texto: string;
}

export interface DetalheReuniao extends Omit<SessaoResumo, 'resumo'> {
  resumo: ResumoReuniao | null;
  videoUrl: string | null;
  tarefasCriadasEm: string | null;
  gravou: boolean;
  etapa: string | null;
  etapaNome: string | null;
  falas: FalaReuniao[];
  participantes: {
    identidade: string;
    nome: string;
    tipo: 'equipe' | 'convidado';
    segundos: number;
    parteDaFala: number | null;
  }[];
  mensagens: (Omit<MensagemChat, 'arquivo'> & {
    arquivo: (Omit<ArquivoChat, 'url'> & { url: string }) | null;
  })[];
}
