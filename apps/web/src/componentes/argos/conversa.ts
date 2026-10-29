import type { DadosAssistenteDTO, RespostaAssistenteDTO } from '@prospeccao/shared/assistente';
import { useSyncExternalStore } from 'react';

/**
 * A conversa com o Argos. Fica guardada nesta aba do navegador (some ao fechar a aba), é de uma
 * pessoa numa unidade (trocou de pessoa ou de unidade, começa do zero) e é o que dá contexto
 * para perguntas de continuação: "e no mês passado?", "e a campanha de Recife?".
 */
export interface TurnoConversa {
  id: number;
  pergunta: string;
  resposta: RespostaAssistenteDTO | null;
  erro: string | null;
  em: number;
}

const CHAVE = 'prospect:argos:conversa';
const CHAVE_DONO = 'prospect:argos:dono';
const MAX_TURNOS = 30;
/** Depois de 30 minutos parado, o histórico deixa de ir para o Argos (a tela continua mostrando). */
const VALIDADE_CONTEXTO_MS = 30 * 60_000;

let turnos: TurnoConversa[] = carregar();
const ouvintes = new Set<() => void>();

function carregar(): TurnoConversa[] {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    const lista = bruto ? (JSON.parse(bruto) as TurnoConversa[]) : [];
    return Array.isArray(lista) ? lista.filter((t) => t && (t.resposta || t.erro)).slice(-MAX_TURNOS) : [];
  } catch {
    return [];
  }
}

function salvar() {
  try {
    sessionStorage.setItem(
      CHAVE,
      JSON.stringify(turnos.filter((t) => t.resposta || t.erro).slice(-MAX_TURNOS)),
    );
  } catch {
    /* sem armazenamento: a conversa fica só na memória */
  }
}

function mudar(nova: TurnoConversa[]) {
  turnos = nova.slice(-MAX_TURNOS);
  salvar();
  for (const fn of ouvintes) fn();
}

let proximo = Date.now();

/** Resumo de uma tabela para o Argos lembrar do que mostrou (sem mandar tudo de novo). */
function resumoDados(d: DadosAssistenteDTO): string {
  const destaques = d.destaques.map((x) => `${x.rotulo}: ${x.valor}`).join('; ');
  const colunas = d.colunas.slice(0, 8);
  const linhas = d.linhas
    .slice(0, 12)
    .map((l) => colunas.map((c) => String(l[c] ?? '')).join(' | '))
    .join('\n');
  return `\n[Tabela mostrada: ${d.titulo}${destaques ? ` — ${destaques}` : ''}]\n${colunas.join(' | ')}\n${linhas}${d.linhas.length > 12 ? `\n(+${d.linhas.length - 12} linhas)` : ''}`;
}

export const conversa = {
  lista: () => turnos,

  /** De quem é a conversa (pessoa + unidade). Se mudou, a anterior não pode aparecer nem ir para a IA. */
  usarDono(dono: string) {
    let atual: string | null = null;
    try {
      atual = sessionStorage.getItem(CHAVE_DONO);
      sessionStorage.setItem(CHAVE_DONO, dono);
    } catch {
      /* sem armazenamento */
    }
    if (atual !== dono && turnos.length) mudar([]);
  },

  adicionar(pergunta: string): number {
    const id = ++proximo;
    mudar([...turnos, { id, pergunta, resposta: null, erro: null, em: Date.now() }]);
    return id;
  },

  responder(id: number, r: RespostaAssistenteDTO) {
    mudar(turnos.map((t) => (t.id === id ? { ...t, resposta: r, erro: null } : t)));
  },

  falhar(id: number, erro: string) {
    mudar(turnos.map((t) => (t.id === id ? { ...t, erro } : t)));
  },

  remover(id: number) {
    mudar(turnos.filter((t) => t.id !== id));
  },

  limpar() {
    mudar([]);
  },

  /** O que vai para o Argos como contexto: as últimas trocas recentes, com o resumo das tabelas. */
  historicoParaApi(): { pergunta: string; resposta: string }[] {
    const agora = Date.now();
    return turnos
      .filter((t) => t.resposta && agora - t.em < VALIDADE_CONTEXTO_MS)
      .slice(-8)
      .map((t) => {
        const r = t.resposta!;
        const texto = `${r.detalhe ? `${r.fala}\n${r.detalhe}` : r.fala}${r.dados ? resumoDados(r.dados) : ''}`;
        return { pergunta: t.pergunta.slice(0, 1000), resposta: texto.slice(0, 4000) };
      });
  },
};

const assinar = (fn: () => void) => {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
};

export function useConversa() {
  return useSyncExternalStore(assinar, conversa.lista, conversa.lista);
}
