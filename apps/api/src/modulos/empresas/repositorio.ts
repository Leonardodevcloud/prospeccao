import type { Executor } from '@prospeccao/db';
import type { FiltrosEmpresas } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import { visivel } from '../../visibilidade.js';

/**
 * Leitura das empresas descobertas. Tudo vem de views publicadas pelos domínios
 * descoberta e base_cnpj; a API nunca escreve nesses schemas.
 */

const CAMPOS_LISTA = `
  e.id, e.nome, e.razao_social AS "razaoSocial", e.cnpj, e.cidade, e.uf, e.bairro,
  e.cnae_principal AS "cnaePrincipal", e.porte,
  coalesce(e.maps_nota, l.maps_nota)::float8 AS "mapsNota", coalesce(e.maps_avaliacoes, l.maps_avaliacoes) AS "mapsAvaliacoes",
  coalesce(e.maps_categoria, l.maps_categoria) AS "mapsCategoria", e.maps_site AS "mapsSite", e.maps_telefone AS "mapsTelefone",
  e.telefones_receita AS "telefonesReceita", e.sinal_entrega AS "sinalEntrega",
  ce.distancia_base_km::float8 AS "distanciaBaseKm", e.maps_fechada AS "mapsFechada",
  (e.place_id IS NOT NULL OR l.maps_url IS NOT NULL) AS "noMaps", e.criado_em AS "criadoEm", e.mei,
  l.status AS "enriqStatus", l.faixa, l.score, l.motivo, cardinality(l.pendencias) > 0 AS "enriqParcial",
  dec.nome AS "decisorNome", dec.cargo AS "decisorCargo",
  pc.canal AS "contatoCanal", pc.valor AS "contatoValor", pc.status AS "contatoStatus",
  op.etapa AS "funilEtapa", op.proxima_acao_em AS "funilProximaAcaoEm"`;

/**
 * A empresa é da conta: alguma campanha da conta a achou. A base de empresas é de todas as contas;
 * cada conta só enxerga (e só trabalha) o que as campanhas dela acharam.
 */
export function daConta(coluna: string): string {
  return `EXISTS (SELECT 1 FROM descoberta.campanha_empresas cx WHERE cx.empresa_id = ${coluna} AND cx.conta_id = ${contaSql()} AND cx.liberado_em IS NOT NULL)`;
}

/** Nota, decisor e melhor contato do enriquecimento (schema do worker-enriquecimento, só leitura). */
export const juncoesEnriq = () => `
  LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
  LEFT JOIN LATERAL (
    SELECT nome, cargo FROM enriquecimento.pessoas p
     WHERE p.empresa_id = e.id AND p.decisor AND ${visivel('p')}
       AND NOT EXISTS (SELECT 1 FROM comercial.feedback f
                        WHERE f.empresa_id = e.id AND f.tipo = 'nao_decisor' AND f.valor = p.nome)
     ORDER BY (p.conta_id <> 0) DESC, p.prioridade
     LIMIT 1
  ) dec ON true
  LEFT JOIN LATERAL (
    -- Melhor contato que você não marcou como errado (o principal, se ainda vale).
    SELECT canal, valor, status FROM enriquecimento.contatos c
     WHERE c.empresa_id = e.id AND c.canal IN ('whatsapp', 'telefone', 'email') AND c.status <> 'invalido' AND ${visivel('c')}
       AND NOT EXISTS (SELECT 1 FROM comercial.feedback f
                        WHERE f.empresa_id = e.id AND f.tipo = 'numero_errado' AND f.valor = c.valor)
     ORDER BY c.principal DESC, (c.status = 'verificado') DESC, c.confianca DESC
     LIMIT 1
  ) pc ON true
  LEFT JOIN comercial.oportunidades op ON op.conta_id = ${contaSql()} AND op.empresa_id = e.id`;

const ORDENS: Record<FiltrosEmpresas['ordem'], string> = {
  nota: 'l.score DESC NULLS LAST, e.maps_avaliacoes DESC NULLS LAST, e.nome',
  avaliacoes: 'e.maps_avaliacoes DESC NULLS LAST, e.nome',
  distancia: 'ce.distancia_base_km ASC NULLS LAST, e.nome',
  recentes: 'e.criado_em DESC, e.id DESC',
  nome: 'e.nome',
};

export async function listar(db: Executor, f: FiltrosEmpresas) {
  const where: string[] = [];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };

  // Uma linha por empresa: com campanha, as colunas de vínculo vêm dela; sem, da mais recente da conta.
  const C = contaSql();
  const vinculo = f.campanhaId
    ? `JOIN descoberta.campanha_empresas ce
         ON ce.empresa_id = e.id AND ce.conta_id = ${C} AND ce.campanha_id = ${p(f.campanhaId)} AND ce.liberado_em IS NOT NULL`
    : `JOIN LATERAL (
         SELECT * FROM descoberta.campanha_empresas c2
          WHERE c2.empresa_id = e.id AND c2.conta_id = ${C} AND c2.liberado_em IS NOT NULL
          ORDER BY c2.adicionada_em DESC LIMIT 1
       ) ce ON true`;

  if (f.busca) {
    const termo = p(`%${f.busca}%`);
    const digitos = f.busca.replace(/\D/g, '');
    where.push(
      `(e.nome ILIKE ${termo} OR e.razao_social ILIKE ${termo}` +
        (digitos.length >= 4
          ? ` OR e.cnpj LIKE ${p(`%${digitos}%`)} OR ${p(digitos)} = ANY(e.telefones_receita)`
          : '') +
        ')',
    );
  }
  if (f.cidade) where.push(`e.cidade = public.normalizar_cidade(${p(f.cidade)})`);
  if (f.origem) where.push(`ce.origem = ${p(f.origem)}`);
  if (f.comCnpj != null) where.push(f.comCnpj ? 'e.cnpj IS NOT NULL' : 'e.cnpj IS NULL');
  if (f.dentroDoRaio != null)
    where.push(f.dentroDoRaio ? 'ce.dentro_do_raio' : 'ce.dentro_do_raio IS NOT TRUE');
  if (f.entrega != null)
    where.push(
      f.entrega ? '(e.sinal_entrega OR l.entrega)' : 'NOT coalesce(e.sinal_entrega OR l.entrega, false)',
    );
  if (f.faixa === 'pendente') where.push(`(l.status IS NULL OR l.status <> 'concluido')`);
  else if (f.faixa) where.push(`l.faixa = ${p(f.faixa)}`);
  // MEI não contrata o serviço: fora da lista, a menos que peça para ver.
  if (!f.incluirMei) where.push('NOT e.mei');
  if (f.situacao === 'novos') where.push('op.empresa_id IS NULL');
  else if (f.situacao === 'no_funil') where.push(`op.etapa <> 'descartado'`);
  else if (f.situacao === 'descartados') where.push(`op.etapa = 'descartado'`);
  if (f.comDecisor != null) where.push(f.comDecisor ? 'dec.nome IS NOT NULL' : 'dec.nome IS NULL');
  if (f.scoreMinimo != null) where.push(`l.score >= ${p(f.scoreMinimo)}`);
  if (f.comWhatsapp != null) {
    // WhatsApp achado (botão do site, bio, Evolution); só o número conferido como inválido fica de fora.
    const existe = `EXISTS (SELECT 1 FROM enriquecimento.contatos w WHERE w.empresa_id = e.id AND w.canal = 'whatsapp' AND w.status <> 'invalido' AND ${visivel('w')})`;
    where.push(f.comWhatsapp ? existe : `NOT ${existe}`);
  }

  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM descoberta.empresas e ${vinculo} ${juncoesEnriq()} ${filtro}`;

  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, valores);
  const pagina = await db.query(
    `SELECT ${CAMPOS_LISTA}, ce.origem, ce.dentro_do_raio AS "dentroDoRaio", ce.campanha_id AS "campanhaId",
            (ce.enriquecimento_solicitado_em IS NOT NULL) AS "enriqPedido"
       ${base}
      ORDER BY ${ORDENS[f.ordem]}
      LIMIT ${p(f.porPagina)} OFFSET ${p((f.pagina - 1) * f.porPagina)}`,
    valores,
  );
  return { itens: pagina.rows, total: total.rows[0]?.n ?? 0, pagina: f.pagina, porPagina: f.porPagina };
}

export async function obter(db: Executor, id: number) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT ${CAMPOS_LISTA}, e.cnpj_basico AS "cnpjBasico", e.situacao, e.data_abertura AS "dataAbertura",
            e.logradouro, e.numero, e.cep, e.email_receita AS "emailReceita",
            e.lat, e.lng, e.geo_fonte AS "geoFonte", e.place_id AS "placeId", e.maps_nome AS "mapsNome",
            e.maps_endereco AS "mapsEndereco", coalesce(e.maps_url, l.maps_url) AS "mapsUrl", e.maps_em AS "mapsEm",
            e.sinal_entrega_fonte AS "sinalEntregaFonte",
            b.nome AS "baseNome"
       FROM descoberta.empresas e
       JOIN LATERAL (
         SELECT * FROM descoberta.campanha_empresas c2
          WHERE c2.empresa_id = e.id AND c2.conta_id = ${C} AND c2.liberado_em IS NOT NULL
          ORDER BY c2.adicionada_em DESC LIMIT 1
       ) ce ON true
       LEFT JOIN cadastro.v_bases_ativas b ON b.id = ce.base_id AND b.conta_id = ${C}
       ${juncoesEnriq()}
      WHERE e.id = $1`,
    [id],
  );
  const empresa = rows[0];
  if (!empresa) return null;

  const [socios, campanhas, cruzamento, enriquecimento, pessoas, contatos, etapas] = await Promise.all([
    empresa.cnpjBasico
      ? db.query(
          `SELECT nome, tipo, qualificacao, qualificacao_codigo AS "qualificacaoCodigo", data_entrada AS "dataEntrada",
                  faixa_etaria AS "faixaEtaria", prioridade
             FROM base_cnpj.v_socios WHERE cnpj_basico = $1 ORDER BY prioridade, data_entrada NULLS LAST, nome`,
          [empresa.cnpjBasico],
        )
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT ce.campanha_id AS id, c.nome, ce.origem, ce.dentro_do_raio AS "dentroDoRaio",
              ce.adicionada_em AS "adicionadaEm", ce.enriquecimento_solicitado_em AS "enriquecimentoSolicitadoEm"
         FROM descoberta.campanha_empresas ce
         JOIN cadastro.campanhas c ON c.id = ce.campanha_id
        WHERE ce.empresa_id = $1 AND ce.conta_id = ${C} AND ce.liberado_em IS NOT NULL ORDER BY ce.adicionada_em DESC`,
      [id],
    ),
    db.query(
      `SELECT cruzamento AS tipo, similaridade, criado_em AS "em"
         FROM descoberta.maps_resultados WHERE empresa_id = $1 ORDER BY id DESC LIMIT 1`,
      [id],
    ),
    db.query(
      `SELECT status, faixa, score, motivo, resumo, entrega, cnpj_achado AS "cnpjAchado", site_url AS "site",
              instagram, facebook, linkedin_empresa AS "linkedinEmpresa", maps_aberto AS "mapsAberto",
              erro, pendencias, solicitado_em AS "solicitadoEm", iniciado_em AS "iniciadoEm", concluido_em AS "concluidoEm"
         FROM enriquecimento.leads WHERE empresa_id = $1`,
      [id],
    ),
    db.query(
      `SELECT p.id, p.nome, p.cargo, p.papel, p.prioridade, p.desde, p.linkedin_url AS "linkedin", p.fontes,
              p.evidencia, (f.id IS NOT NULL) AS "naoDecisor", (p.decisor AND f.id IS NULL) AS decisor
         FROM enriquecimento.pessoas p
         LEFT JOIN comercial.feedback f
           ON f.empresa_id = p.empresa_id AND f.tipo = 'nao_decisor' AND f.valor = p.nome
        WHERE p.empresa_id = $1 AND ${visivel('p')} ORDER BY (f.id IS NOT NULL), (p.conta_id <> 0) DESC, p.prioridade, p.nome`,
      [id],
    ),
    db.query(
      `SELECT c.id, c.pessoa_id AS "pessoaId", c.canal, c.valor,
              CASE WHEN f.id IS NOT NULL THEN 'Marcado como errado por você' ELSE c.rotulo END AS rotulo,
              c.fonte, c.fontes, c.url_origem AS "urlOrigem", c.confianca,
              CASE WHEN f.id IS NOT NULL THEN 'invalido' ELSE c.status END AS status,
              c.whatsapp, c.principal, (f.id IS NOT NULL) AS "marcadoErrado"
         FROM enriquecimento.contatos c
         LEFT JOIN comercial.feedback f
           ON f.empresa_id = c.empresa_id AND f.tipo = 'numero_errado' AND f.valor = c.valor
        WHERE c.empresa_id = $1 AND ${visivel('c')}
        ORDER BY (f.id IS NOT NULL), c.principal DESC, (c.status = 'verificado') DESC, c.confianca DESC, c.canal`,
      [id],
    ),
    db.query(
      `SELECT etapa, status, detalhe, url, criado_em AS "em"
         FROM enriquecimento.etapas WHERE empresa_id = $1 ORDER BY ordem`,
      [id],
    ),
  ]);

  // Contato principal marcado como errado: o próximo melhor assume na tela.
  const lista = contatos.rows as {
    principal: boolean;
    marcadoErrado: boolean;
    status: string;
    canal: string;
  }[];
  const principal = lista.find((c) => c.principal);
  if (principal?.marcadoErrado) {
    principal.principal = false;
    const proximo = lista.find(
      (c) =>
        !c.marcadoErrado && c.status !== 'invalido' && ['whatsapp', 'telefone', 'email'].includes(c.canal),
    );
    if (proximo) proximo.principal = true;
  }

  return {
    ...empresa,
    socios: socios.rows,
    campanhas: campanhas.rows,
    cruzamento: cruzamento.rows[0] ?? null,
    enriquecimento: enriquecimento.rows[0] ?? null,
    pessoas: pessoas.rows,
    contatos: contatos.rows,
    etapas: etapas.rows,
  };
}

/** Campanha mais recente da empresa: para onde vai o pedido de "enriquecer de novo". */
export async function campanhaDaEmpresa(db: Executor, id: number): Promise<number | null> {
  const { rows } = await db.query<{ campanha_id: number }>(
    `SELECT campanha_id FROM descoberta.campanha_empresas
      WHERE empresa_id = $1 AND conta_id = ${contaSql()} AND liberado_em IS NOT NULL
      ORDER BY adicionada_em DESC LIMIT 1`,
    [id],
  );
  return rows[0]?.campanha_id ?? null;
}

/** Guarda seu retorno ("número errado", "não é quem decide") com as fontes de onde o dado veio. */
export async function registrarFeedback(
  db: Executor,
  empresaId: number,
  d: { tipo: 'numero_errado' | 'nao_decisor'; valor: string; canal?: string },
  autor: string,
): Promise<void> {
  const origem =
    d.tipo === 'numero_errado'
      ? await db.query<{ fontes: string[]; canal: string }>(
          `SELECT fontes, canal FROM enriquecimento.contatos c WHERE empresa_id = $1 AND valor = $2 AND ${visivel('c')} LIMIT 1`,
          [empresaId, d.valor],
        )
      : await db.query<{ fontes: string[]; canal: string }>(
          `SELECT fontes, 'pessoa' AS canal FROM enriquecimento.pessoas p WHERE empresa_id = $1 AND nome = $2 AND ${visivel('p')} LIMIT 1`,
          [empresaId, d.valor],
        );
  await db.query(
    `INSERT INTO comercial.feedback (empresa_id, tipo, valor, canal, fontes, autor)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (empresa_id, tipo, valor) DO NOTHING`,
    [
      empresaId,
      d.tipo,
      d.valor,
      d.canal ?? origem.rows[0]?.canal ?? null,
      origem.rows[0]?.fontes ?? [],
      autor,
    ],
  );
}

export async function desfazerFeedback(
  db: Executor,
  empresaId: number,
  d: { tipo: 'numero_errado' | 'nao_decisor'; valor: string },
): Promise<void> {
  await db.query('DELETE FROM comercial.feedback WHERE empresa_id = $1 AND tipo = $2 AND valor = $3', [
    empresaId,
    d.tipo,
    d.valor,
  ]);
}
