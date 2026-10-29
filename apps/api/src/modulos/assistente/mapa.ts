import type { Pool } from '@prospeccao/db';
import type { LigacaoMapaDTO, MapaDTO, NoMapaDTO } from '@prospeccao/shared';
import type { UsuarioSessao } from '../../contexto.js';
import { assinarEscopo, consultar } from './acesso.js';
import { escopoDe } from './agente.js';

/**
 * Mapa do conhecimento: o comercial da pessoa como uma galáxia. Cada etapa do funil é um
 * aglomerado; cada empresa em negociação, uma estrela perto da sua etapa; as pessoas da equipe
 * ficam no meio das empresas que conduzem; empresas da mesma campanha se ligam por "parecidas".
 * Lido pelas MESMAS views do Argos, com o escopo assinado: cada um só vê o que pode ver.
 */

const MAX_EMPRESAS = 1500;

const ETAPAS: Record<string, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cidadeBonita = (c: string | null) =>
  c ? c.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, e: string, l: string) => e + l.toUpperCase()) : null;

export async function montarMapa(
  dono: Pool,
  leitura: Pool,
  chave: string,
  u: UsuarioSessao,
  unidade?: number | null,
): Promise<MapaDTO> {
  const escopo = await escopoDe(dono, u);
  const soPropriaBase = !!escopo.dono;
  const assinado = assinarEscopo(chave, escopo, 120);
  const [unidades, funil] = await Promise.all([
    consultar(leitura, assinado, 'SELECT unidade_id, unidade FROM unidades ORDER BY unidade', [], {
      limite: 500,
    }),
    consultar(
      leitura,
      assinado,
      `SELECT f.empresa_id, f.unidade_id, f.empresa, f.situacao, f.etapa, f.responsavel_id, f.responsavel,
              f.valor_mensal, f.cidade, f.campanha_id, f.proxima_acao
         FROM funil f
        WHERE f.situacao <> 'descartado' AND ($1::int IS NULL OR f.unidade_id = $1)
        ORDER BY f.atualizado_em DESC`,
      [unidade ?? null],
      { limite: MAX_EMPRESAS },
    ),
  ]);
  const nomeUnidade = new Map(unidades.linhas.map((l) => [Number(l.unidade_id), String(l.unidade)]));
  const variasUnidades = nomeUnidade.size > 1;

  const nos: NoMapaDTO[] = [];
  const ligacoes: LigacaoMapaDTO[] = [];
  const grau = new Map<string, number>();
  const ligar = (
    origem: string,
    destino: string,
    tipo: LigacaoMapaDTO['tipo'],
    peso: number | null = null,
  ) => {
    ligacoes.push({ origem, destino, tipo, peso });
    if (tipo !== 'area') {
      grau.set(origem, (grau.get(origem) ?? 0) + 1);
      grau.set(destino, (grau.get(destino) ?? 0) + 1);
    }
  };

  const etapasVistas = new Set<string>();
  const pessoas = new Map<string, { nome: string; unidade: string; total: number }>();
  const porCampanha = new Map<string, string[]>();

  for (const l of funil.linhas) {
    const situacao = String(l.situacao);
    if (!ETAPAS[situacao]) continue;
    etapasVistas.add(situacao);
    const unidadeId = Number(l.unidade_id);
    const id = `empresa:${unidadeId}:${l.empresa_id}`;
    const valor = l.valor_mensal == null ? null : Number(l.valor_mensal);
    const cidade = cidadeBonita((l.cidade as string | null) ?? null);
    nos.push({
      id,
      categoria: 'registro',
      rotulo: String(l.empresa),
      codigo:
        [valor ? `${reais(valor)}/mês` : null, cidade, variasUnidades ? nomeUnidade.get(unidadeId) : null]
          .filter(Boolean)
          .join(' · ') || null,
      area: situacao,
      status: situacao === 'perdido' ? 'apagado' : null,
      grau: 0,
      detalhe: {
        empresaId: Number(l.empresa_id),
        unidadeId,
        unidade: nomeUnidade.get(unidadeId),
        etapa: String(l.etapa ?? ETAPAS[situacao]),
        responsavel: (l.responsavel as string | null) ?? null,
        valorMensal: valor,
        cidade,
        proximaAcao: (l.proxima_acao as string | null) ?? null,
      },
    });
    ligar(id, `etapa:${situacao}`, 'area');
    if (l.responsavel_id != null) {
      const p = `pessoa:${l.responsavel_id}`;
      const atual = pessoas.get(p);
      if (atual) atual.total++;
      else
        pessoas.set(p, {
          nome: String(l.responsavel ?? 'Sem nome'),
          unidade: nomeUnidade.get(unidadeId) ?? '',
          total: 1,
        });
      ligar(id, p, 'cliente');
    }
    if (l.campanha_id != null) {
      const chave = `${unidadeId}:${l.campanha_id}`;
      porCampanha.set(chave, [...(porCampanha.get(chave) ?? []), id]);
    }
  }

  // Empresas da mesma campanha: uma corrente (cada uma com a próxima), sem explodir em ligações.
  for (const ids of porCampanha.values())
    for (let i = 1; i < ids.length && i < 60; i++) ligar(ids[i - 1]!, ids[i]!, 'semelhante', 0.5);

  for (const s of Object.keys(ETAPAS))
    if (etapasVistas.has(s))
      nos.push({
        id: `etapa:${s}`,
        categoria: 'area',
        rotulo: ETAPAS[s]!,
        codigo: null,
        area: s,
        status: null,
        grau: 0,
        detalhe: null,
      });
  for (const [id, p] of pessoas)
    nos.push({
      id,
      categoria: 'cliente',
      rotulo: p.nome,
      codigo: variasUnidades ? p.unidade : 'Equipe',
      area: null,
      status: null,
      grau: 0,
      detalhe: { negociacoes: p.total, unidade: p.unidade },
    });
  for (const n of nos) n.grau = grau.get(n.id) ?? 0;

  return {
    nos,
    ligacoes,
    unidades: unidades.linhas.map((l) => ({ id: Number(l.unidade_id), nome: String(l.unidade) })),
    cortado: funil.cortado,
    soPropriaBase,
    geradoEm: new Date().toISOString(),
  };
}
