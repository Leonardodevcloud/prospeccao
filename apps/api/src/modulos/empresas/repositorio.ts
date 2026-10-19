import type { Executor } from '@prospeccao/db';
import type { FiltrosEmpresas } from '@prospeccao/shared';

/**
 * Leitura das empresas descobertas. Tudo vem de views publicadas pelos domínios
 * descoberta e base_cnpj; a API nunca escreve nesses schemas.
 */

const CAMPOS_LISTA = `
  e.id, e.nome, e.razao_social AS "razaoSocial", e.cnpj, e.cidade, e.uf, e.bairro,
  e.cnae_principal AS "cnaePrincipal", e.porte, e.maps_nota AS "mapsNota", e.maps_avaliacoes AS "mapsAvaliacoes",
  e.maps_categoria AS "mapsCategoria", e.maps_site AS "mapsSite", e.maps_telefone AS "mapsTelefone",
  e.telefones_receita AS "telefonesReceita", e.sinal_entrega AS "sinalEntrega",
  e.distancia_base_km AS "distanciaBaseKm", e.maps_fechada AS "mapsFechada",
  (e.place_id IS NOT NULL) AS "noMaps", e.criado_em AS "criadoEm",
  l.status AS "enriqStatus", l.faixa, l.score, l.motivo,
  dec.nome AS "decisorNome", dec.cargo AS "decisorCargo",
  pc.canal AS "contatoCanal", pc.valor AS "contatoValor", pc.status AS "contatoStatus"`;

/** Nota, decisor e melhor contato do enriquecimento (schema do worker-enriquecimento, só leitura). */
const JUNCOES_ENRIQ = `
  LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
  LEFT JOIN LATERAL (
    SELECT nome, cargo FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor LIMIT 1
  ) dec ON true
  LEFT JOIN LATERAL (
    SELECT canal, valor, status FROM enriquecimento.contatos c WHERE c.empresa_id = e.id AND c.principal LIMIT 1
  ) pc ON true`;

const ORDENS: Record<FiltrosEmpresas['ordem'], string> = {
  nota: 'l.score DESC NULLS LAST, e.maps_avaliacoes DESC NULLS LAST, e.nome',
  avaliacoes: 'e.maps_avaliacoes DESC NULLS LAST, e.nome',
  distancia: 'e.distancia_base_km ASC NULLS LAST, e.nome',
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

  // Uma linha por empresa: com campanha, as colunas de vínculo vêm dela; sem, da mais recente.
  const vinculo = f.campanhaId
    ? `JOIN descoberta.campanha_empresas ce ON ce.empresa_id = e.id AND ce.campanha_id = ${p(f.campanhaId)}`
    : `JOIN LATERAL (
         SELECT * FROM descoberta.campanha_empresas c2 WHERE c2.empresa_id = e.id ORDER BY c2.adicionada_em DESC LIMIT 1
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
  if (f.comWhatsapp != null) {
    const existe = `EXISTS (SELECT 1 FROM enriquecimento.contatos w WHERE w.empresa_id = e.id AND w.canal = 'whatsapp' AND w.status = 'verificado')`;
    where.push(f.comWhatsapp ? existe : `NOT ${existe}`);
  }

  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM descoberta.empresas e ${vinculo} ${JUNCOES_ENRIQ} ${filtro}`;

  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, valores);
  const pagina = await db.query(
    `SELECT ${CAMPOS_LISTA}, ce.origem, ce.dentro_do_raio AS "dentroDoRaio", ce.campanha_id AS "campanhaId"
       ${base}
      ORDER BY ${ORDENS[f.ordem]}
      LIMIT ${p(f.porPagina)} OFFSET ${p((f.pagina - 1) * f.porPagina)}`,
    valores,
  );
  return { itens: pagina.rows, total: total.rows[0]?.n ?? 0, pagina: f.pagina, porPagina: f.porPagina };
}

export async function obter(db: Executor, id: number) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS_LISTA}, e.cnpj_basico AS "cnpjBasico", e.situacao, e.data_abertura AS "dataAbertura",
            e.logradouro, e.numero, e.cep, e.email_receita AS "emailReceita",
            e.lat, e.lng, e.geo_fonte AS "geoFonte", e.place_id AS "placeId", e.maps_nome AS "mapsNome",
            e.maps_endereco AS "mapsEndereco", e.maps_url AS "mapsUrl", e.maps_em AS "mapsEm",
            e.sinal_entrega_fonte AS "sinalEntregaFonte",
            b.nome AS "baseNome"
       FROM descoberta.empresas e
       LEFT JOIN cadastro.v_bases_ativas b ON b.id = e.base_id
       ${JUNCOES_ENRIQ}
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
        WHERE ce.empresa_id = $1 ORDER BY ce.adicionada_em DESC`,
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
              erro, solicitado_em AS "solicitadoEm", iniciado_em AS "iniciadoEm", concluido_em AS "concluidoEm"
         FROM enriquecimento.leads WHERE empresa_id = $1`,
      [id],
    ),
    db.query(
      `SELECT id, nome, cargo, papel, decisor, prioridade, desde, linkedin_url AS "linkedin", fontes
         FROM enriquecimento.pessoas WHERE empresa_id = $1 ORDER BY prioridade, nome`,
      [id],
    ),
    db.query(
      `SELECT id, pessoa_id AS "pessoaId", canal, valor, rotulo, fonte, fontes, url_origem AS "urlOrigem",
              confianca, status, whatsapp, principal
         FROM enriquecimento.contatos WHERE empresa_id = $1
        ORDER BY principal DESC, (status = 'verificado') DESC, confianca DESC, canal`,
      [id],
    ),
    db.query(
      `SELECT etapa, status, detalhe, url, criado_em AS "em"
         FROM enriquecimento.etapas WHERE empresa_id = $1 ORDER BY ordem`,
      [id],
    ),
  ]);

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
    `SELECT campanha_id FROM descoberta.campanha_empresas WHERE empresa_id = $1 ORDER BY adicionada_em DESC LIMIT 1`,
    [id],
  );
  return rows[0]?.campanha_id ?? null;
}
