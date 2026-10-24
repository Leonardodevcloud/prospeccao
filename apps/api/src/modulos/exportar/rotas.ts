import { filtrosEmpresas, filtrosFunil, filtrosRelatorio } from '@prospeccao/shared';
import { type Response, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { visivel } from '../../visibilidade.js';
import { ipDe } from '../auditoria/middleware.js';
import * as auditoria from '../auditoria/repositorio.js';
import { listar as listarEmpresas } from '../empresas/repositorio.js';
import { quadro } from '../funil/repositorio.js';
import { relatorio } from '../relatorios/repositorio.js';
import { type Aba, gerarXlsx, nomeArquivo } from './planilha.js';

/**
 * Exportar para o Excel o que está na tela, com os mesmos filtros: leads, funil e relatórios.
 * Só o administrador exporta (é a base comercial inteira) e cada exportação fica na auditoria.
 */

const ETAPAS: Record<string, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};
const LIMITE = 20_000;

async function enviar(res: Response, base: string, abas: Aba[]) {
  const arquivo = await gerarXlsx(abas);
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="${nomeArquivo(base)}"`)
    .set('Cache-Control', 'no-store')
    .send(arquivo);
}

export function rotasExportar({ pool, log }: DepsApi): Router {
  const r = Router();
  r.use(exigirAdmin);

  const registrar = (req: Parameters<typeof ipDe>[0], descricao: string, linhas: number) =>
    auditoria
      .registrar(pool, {
        contaId: req.usuario!.contaId,
        usuarioId: req.usuario!.id,
        usuarioNome: req.usuario!.nome,
        comoMaster: req.usuario!.contaId !== req.usuario!.contaPropria,
        acao: 'exportação',
        descricao: `${descricao} (${linhas} linhas)`,
        metodo: 'GET',
        caminho: req.baseUrl + req.path,
        detalhes: { filtros: req.query },
        ip: ipDe(req),
      })
      .catch((erro) => log.warn({ err: erro }, 'auditoria: exportação não registrada'));

  r.get('/leads', async (req, res) => {
    const f = { ...consulta(req, filtrosEmpresas), pagina: 1, porPagina: LIMITE };
    const { itens } = await listarEmpresas(pool, f);
    const ids = itens.map((e) => Number(e.id));
    // Melhor contato de cada canal (o que não foi marcado como errado).
    const { rows: contatos } = await pool.query<{ empresa_id: number; canal: string; valor: string }>(
      `SELECT DISTINCT ON (c.empresa_id, c.canal) c.empresa_id::int, c.canal, c.valor
         FROM enriquecimento.contatos c
        WHERE c.empresa_id = ANY($1::bigint[]) AND c.canal IN ('whatsapp', 'telefone', 'email', 'instagram', 'site', 'linkedin')
          AND ${visivel('c')}
          AND c.status <> 'invalido'
          AND NOT EXISTS (SELECT 1 FROM comercial.feedback fb
                           WHERE fb.empresa_id = c.empresa_id AND fb.tipo = 'numero_errado' AND fb.valor = c.valor)
        ORDER BY c.empresa_id, c.canal, c.principal DESC, (c.status = 'verificado') DESC, c.confianca DESC`,
      [ids],
    );
    const por = new Map<string, string>();
    for (const c of contatos) por.set(`${c.empresa_id}:${c.canal}`, c.valor);
    const de = (id: unknown, canal: string) => por.get(`${id}:${canal}`) ?? null;
    await enviar(res, 'leads', [
      {
        nome: 'Leads',
        colunas: [
          { titulo: 'Empresa', largura: 34 },
          { titulo: 'Razão social', largura: 34 },
          { titulo: 'CNPJ', largura: 20 },
          { titulo: 'Cidade', largura: 20 },
          { titulo: 'UF', largura: 5 },
          { titulo: 'Bairro', largura: 20 },
          { titulo: 'Categoria (Maps)', largura: 24 },
          { titulo: 'Nota', largura: 6 },
          { titulo: 'Pontos', largura: 8 },
          { titulo: 'Decisor', largura: 26 },
          { titulo: 'Cargo', largura: 18 },
          { titulo: 'WhatsApp', largura: 16 },
          { titulo: 'Telefone', largura: 16 },
          { titulo: 'Telefone (Maps)', largura: 16 },
          { titulo: 'E-mail', largura: 30 },
          { titulo: 'Instagram', largura: 22 },
          { titulo: 'Site', largura: 28 },
          { titulo: 'Avaliação Google', largura: 10, formato: '0.0' },
          { titulo: 'Avaliações', largura: 10 },
          { titulo: 'Faz entrega', largura: 10 },
          { titulo: 'Distância da base (km)', largura: 12, formato: '0.0' },
          { titulo: 'Etapa no funil', largura: 14 },
          { titulo: 'Motivo da nota', largura: 50 },
          { titulo: 'Encontrado em', largura: 16 },
        ],
        linhas: itens.map((e) => [
          e.nome,
          e.razaoSocial,
          e.cnpj,
          e.cidade,
          e.uf,
          e.bairro,
          e.mapsCategoria,
          e.faixa,
          e.score,
          e.decisorNome,
          e.decisorCargo,
          de(e.id, 'whatsapp'),
          de(e.id, 'telefone'),
          e.mapsTelefone,
          de(e.id, 'email'),
          de(e.id, 'instagram'),
          de(e.id, 'site') ?? e.mapsSite,
          e.mapsNota,
          e.mapsAvaliacoes,
          e.sinalEntrega,
          e.distanciaBaseKm,
          e.funilEtapa ? (ETAPAS[e.funilEtapa as string] ?? e.funilEtapa) : null,
          e.motivo,
          e.criadoEm,
        ]),
      },
    ]);
    void registrar(req, 'Exportou os leads', itens.length);
  });

  r.get('/funil', async (req, res) => {
    const q = await quadro(pool, consulta(req, filtrosFunil));
    const { rows: etapas } = await pool.query<{ id: number; nome: string }>(
      'SELECT id, nome FROM comercial.etapas WHERE pipeline_id = $1',
      [q.pipelineId],
    );
    const nomeEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
    const cards = q.cards as Record<string, unknown>[];
    await enviar(res, 'funil', [
      {
        nome: 'Funil',
        colunas: [
          { titulo: 'Empresa', largura: 34 },
          { titulo: 'Etapa', largura: 18 },
          { titulo: 'Responsável', largura: 18 },
          { titulo: 'Cidade', largura: 18 },
          { titulo: 'UF', largura: 5 },
          { titulo: 'Nota', largura: 6 },
          { titulo: 'Decisor', largura: 26 },
          { titulo: 'Contato', largura: 26 },
          { titulo: 'Valor mensal (R$)', largura: 14, formato: '#,##0.00' },
          { titulo: 'Próximo passo', largura: 30 },
          { titulo: 'Quando', largura: 16 },
          { titulo: 'Último contato', largura: 16 },
          { titulo: 'Na etapa desde', largura: 16 },
          { titulo: 'Contatos feitos', largura: 10 },
          { titulo: 'Etiquetas', largura: 20 },
          { titulo: 'IA ligada', largura: 8 },
          { titulo: 'Última mensagem do lead', largura: 50 },
          { titulo: 'Motivo', largura: 30 },
        ],
        linhas: cards.map((c) => [
          c.nome,
          nomeEtapa.get(c.etapaId as number) ?? ETAPAS[c.etapa as string] ?? c.etapa,
          c.responsavelNome,
          c.cidade,
          c.uf,
          c.faixa,
          c.decisorNome,
          c.contatoValor ?? c.telefone,
          c.valorMensal,
          c.proximaAcao,
          c.proximaAcaoEm,
          c.ultimoContatoEm,
          c.etapaDesde,
          c.contatos,
          c.etiquetas,
          c.agente,
          c.ultimaDoLead,
          c.motivo,
        ]),
      },
    ]);
    void registrar(req, 'Exportou o funil', cards.length);
  });

  r.get('/relatorio', async (req, res) => {
    const rel = await relatorio(pool, consulta(req, filtrosRelatorio));
    const k = rel.kpis as Record<string, number>;
    const f = rel.funil as Record<string, number>;
    const rotuloKpi: Record<string, string> = {
      encontrados: 'Empresas encontradas',
      enriquecidos: 'Enriquecidas',
      faixaA: 'Nota A',
      faixaB: 'Nota B',
      faixaC: 'Nota C',
      comDecisor: 'Com decisor',
      comWhatsapp: 'Com WhatsApp',
      entraramNoFunil: 'Entraram no funil',
      abordados: 'Abordados',
      responderam: 'Responderam',
      reunioes: 'Reuniões',
      ganhos: 'Ganhos',
      perdidos: 'Perdidos',
      contatos: 'Contatos feitos',
      valorGanho: 'Valor ganho (R$/mês)',
      followupsAtrasados: 'Follow-ups atrasados',
      semProximoPasso: 'Sem próximo passo',
    };
    const abas: Aba[] = [
      {
        nome: 'Resumo',
        colunas: [
          { titulo: 'Indicador', largura: 30 },
          { titulo: 'Valor', largura: 14 },
        ],
        linhas: [
          ...Object.entries(rotuloKpi).map(([chave, rotulo]) => [rotulo, k?.[chave] ?? 0]),
          ...Object.entries(f ?? {}).map(([etapa, n]) => [`No funil · ${ETAPAS[etapa] ?? etapa}`, n]),
        ],
      },
      {
        nome: 'Campanhas',
        colunas: [
          { titulo: 'Campanha', largura: 30 },
          { titulo: 'Situação', largura: 12 },
          { titulo: 'Encontrados', largura: 12 },
          { titulo: 'Nota A', largura: 8 },
          { titulo: 'Nota B', largura: 8 },
          { titulo: 'Nota C', largura: 8 },
          { titulo: 'Com decisor', largura: 12 },
          { titulo: 'Novos', largura: 8 },
          { titulo: 'Descartados', largura: 12 },
          { titulo: 'No funil', largura: 10 },
          { titulo: 'Abordados', largura: 10 },
          { titulo: 'Responderam', largura: 12 },
          { titulo: 'Ganhos', largura: 8 },
        ],
        linhas: (rel.campanhas as Record<string, unknown>[]).map((c) => [
          c.nome,
          c.status,
          c.encontrados,
          c.faixaA,
          c.faixaB,
          c.faixaC,
          c.comDecisor,
          c.novos,
          c.descartados,
          c.noFunil,
          c.abordados,
          c.responderam,
          c.ganhos,
        ]),
      },
      {
        nome: 'Por nota',
        colunas: [
          { titulo: 'Nota', largura: 10 },
          { titulo: 'No funil', largura: 10 },
          { titulo: 'Abordados', largura: 10 },
          { titulo: 'Responderam', largura: 12 },
          { titulo: 'Reuniões', largura: 10 },
          { titulo: 'Ganhos', largura: 8 },
          { titulo: 'Perdidos', largura: 10 },
        ],
        linhas: (rel.faixas as Record<string, unknown>[]).map((x) => [
          x.faixa === 'sem_nota' ? 'Sem nota' : x.faixa,
          x.noFunil,
          x.abordados,
          x.responderam,
          x.reunioes,
          x.ganhos,
          x.perdidos,
        ]),
      },
      {
        nome: 'Motivos de perda',
        colunas: [
          { titulo: 'Etapa', largura: 12 },
          { titulo: 'Motivo', largura: 50 },
          { titulo: 'Quantidade', largura: 12 },
        ],
        linhas: (rel.motivos as Record<string, unknown>[]).map((m) => [
          ETAPAS[m.etapa as string] ?? m.etapa,
          m.motivo,
          m.quantidade,
        ]),
      },
      {
        nome: 'Dia a dia',
        colunas: [
          { titulo: 'Dia', largura: 12 },
          { titulo: 'Contatos', largura: 10 },
          { titulo: 'Respostas', largura: 10 },
          { titulo: 'Novos no funil', largura: 14 },
        ],
        linhas: (rel.diario as Record<string, unknown>[]).map((d) => [
          d.dia,
          d.contatos,
          d.respostas,
          d.novosNoFunil,
        ]),
      },
    ];
    await enviar(res, 'relatorio', abas);
    void registrar(req, 'Exportou o relatório', (rel.campanhas as unknown[]).length);
  });

  return r;
}
