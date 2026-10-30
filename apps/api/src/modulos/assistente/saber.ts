import type { Pool } from '@prospeccao/db';
import { blocosDoPerfil } from '@prospeccao/integrations/agente';
import type { SecaoIa } from '@prospeccao/shared';
import { comConta, type UsuarioSessao } from '../../contexto.js';
import { buscarTrechos } from '../agente/conhecimento.js';
import { lerPerfil } from '../agente/perfil.js';
import * as memoria from './memoria.js';

/**
 * O que o Argos já sabe antes de consultar o banco, carregado junto com o catálogo (sem atrasar a
 * resposta): a memória da pessoa, o que a unidade vende (perfil da IA de atendimento conferido pela
 * equipe) e os trechos da base de conhecimento que combinam com a pergunta.
 */
export interface SaberArgos {
  memorias: memoria.Memoria[];
  /** Perfil da empresa (só seções conferidas). Vazio: a unidade ainda não configurou. */
  empresa: string;
  /** Trechos da base de conhecimento que combinam com a pergunta. */
  trechos: string;
}

const SECOES_DO_ARGOS: SecaoIa[] = ['empresa', 'regiao', 'oferta', 'objetivo', 'objecoes', 'reuniao'];
const LIMITE_EMPRESA = 3500;

async function empresaDaUnidade(pool: Pool, u: UsuarioSessao): Promise<string> {
  const { perfil, conferidas } = await comConta(u.contaId, () => lerPerfil(pool));
  const blocos = blocosDoPerfil(perfil, u.contaNome).filter(
    (b) => SECOES_DO_ARGOS.includes(b.secao) && conferidas[b.secao],
  );
  return blocos
    .map((b) => `${b.titulo}:\n${b.texto}`)
    .join('\n\n')
    .slice(0, LIMITE_EMPRESA);
}

async function trechosDaPergunta(pool: Pool, u: UsuarioSessao, pergunta: string): Promise<string> {
  const achados = await comConta(u.contaId, () => buscarTrechos(pool, pergunta, 4));
  return achados.map((t) => `- ${t.titulo}: ${t.texto.slice(0, 600)}`).join('\n');
}

/** Cada parte falha sozinha: sem ela, o Argos segue com o resto (e consulta o banco). */
export async function carregarSaber(pool: Pool, u: UsuarioSessao, pergunta: string): Promise<SaberArgos> {
  const [memorias, empresa, trechos] = await Promise.all([
    memoria.listar(pool, u.id).catch(() => []),
    empresaDaUnidade(pool, u).catch(() => ''),
    trechosDaPergunta(pool, u, pergunta).catch(() => ''),
  ]);
  return { memorias, empresa, trechos };
}

/** O bloco que vai junto com a pergunta (dados, nunca instrução). */
export function textoDoSaber(s: SaberArgos, unidade: string): string {
  const partes: string[] = [];
  if (s.memorias.length)
    partes.push(
      `Memória (o que esta pessoa pediu para você guardar; vale como preferência ou definição dela, não como número atual do comercial):\n${memoria.memoriasParaIa(s.memorias)}`,
    );
  partes.push(
    s.empresa
      ? `O que a unidade ${unidade} faz e vende (configuração da IA de atendimento, conferida pela equipe):\n${s.empresa}`
      : `A unidade ${unidade} ainda não conferiu a configuração da IA de atendimento: sobre o que a empresa vende, só o que estiver na tabela conhecimento.`,
  );
  if (s.trechos) partes.push(`Trechos da base de conhecimento que combinam com a pergunta:\n${s.trechos}`);
  return partes.join('\n\n');
}
