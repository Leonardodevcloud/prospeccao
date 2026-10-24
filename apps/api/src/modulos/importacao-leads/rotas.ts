import { COLUNAS_PDF } from '@prospeccao/integrations/importacao';
import {
  AppError,
  acharCabecalho,
  arquivoImportacaoEntrada,
  type CampoImportacao,
  confirmarImportacaoEntrada,
  detectarCampos,
  type LeadImportado,
  lerCsv,
  lerLeads,
  type MapaImportacao,
  mapaImportacaoEntrada,
  normalizarCidade,
  ROTULO_CAMPO_IMPORTACAO,
} from '@prospeccao/shared';
import { Router } from 'express';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { daConta } from '../empresas/repositorio.js';
import {
  type Formato,
  formatoDoArquivo,
  lerPlanilhaExcel,
  linhasDoPdfSemIa,
  MAX_LINHAS,
  pedacosDoTexto,
  textoDoCsv,
  textoDoPdf,
} from './leitura.js';

/**
 * Importar leads que o cliente já tem: 1) analisar (lê o arquivo e reconhece as colunas, com a IA
 * confirmando); 2) prévia (o cliente corrige as colunas e vê como os leads vão ficar); 3) importar
 * (lista nova ou campanha, enriquecer ou não, funil ou não). Quem grava é o worker-descoberta.
 */

/** PDF grande: a IA lê até tantos pedaços (~9 mil caracteres cada). */
const MAX_PEDACOS_PDF = 12;
const LARGURA_MAXIMA = 60;

interface Linha {
  id: number;
  arquivo: string;
  formato: Formato;
  status: string;
  colunas: string[];
  linhas: string[][];
  mapa: { campos: MapaImportacao; cabecalho: number | null };
  leitura: 'regras' | 'ia';
  opcoes: unknown;
  campanha_id: number | null;
  campanha_nome: string | null;
  total: number;
  gravados: number;
  resultado: Record<string, unknown>;
  erro: string | null;
  criado_em: string;
  concluido_em: string | null;
}

const CAMPOS_TELA = `i.id, i.arquivo, i.formato, i.status, i.colunas, i.linhas, i.mapa, i.leitura, i.opcoes,
  i.campanha_id, c.nome AS campanha_nome, i.total, i.gravados, i.resultado, i.erro, i.criado_em, i.concluido_em`;

function dadosDa(l: Pick<Linha, 'linhas' | 'mapa'>, cabecalho = l.mapa.cabecalho): string[][] {
  return l.linhas.slice(cabecalho == null ? 0 : cabecalho + 1);
}

/** O que a tela precisa: cada coluna com o nome, alguns exemplos e o que ela é. */
function paraTela(l: Linha, completo = true) {
  const base = {
    id: l.id,
    arquivo: l.arquivo,
    formato: l.formato,
    status: l.status,
    leitura: l.leitura,
    total: l.total,
    gravados: l.gravados,
    resultado: l.resultado,
    erro: l.erro,
    campanha: l.campanha_id ? { id: Number(l.campanha_id), nome: l.campanha_nome } : null,
    opcoes: l.opcoes,
    criadoEm: l.criado_em,
    concluidoEm: l.concluido_em,
  };
  if (!completo) return base;
  const dados = dadosDa(l);
  const largura = Math.max(l.mapa.campos.length, ...l.linhas.slice(0, 50).map((x) => x.length));
  const cab = l.mapa.cabecalho == null ? null : (l.linhas[l.mapa.cabecalho] ?? []);
  return {
    ...base,
    cabecalho: l.mapa.cabecalho,
    linhasDoArquivo: dados.length,
    // As primeiras linhas como vieram (para escolher a linha do cabeçalho).
    inicio: l.linhas.slice(0, 8),
    colunas: Array.from({ length: largura }, (_, i) => ({
      indice: i,
      cabecalho: cab?.[i]?.trim() || null,
      campo: (l.mapa.campos[i] ?? 'ignorar') as CampoImportacao,
      exemplos: dados
        .map((x) => x[i]?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 3),
    })),
  };
}

export function rotasImportacaoLeads(deps: DepsApi): Router {
  const { pool, log, filas } = deps;
  const r = Router();

  async function obter(id: number): Promise<Linha> {
    const { rows } = await pool.query<Linha>(
      `SELECT ${CAMPOS_TELA} FROM cadastro.importacoes_leads i
         LEFT JOIN cadastro.campanhas c ON c.id = i.campanha_id
        WHERE i.id = $1 AND i.conta_id = ${contaSql()}`,
      [id],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Importação');
    return rows[0];
  }

  /** Últimas importações (com o andamento das que estão gravando). */
  r.get('/', async (_req, res) => {
    const { rows } = await pool.query<Linha>(
      `SELECT ${CAMPOS_TELA.replace('i.colunas, i.linhas, ', "'[]'::jsonb AS colunas, '[]'::jsonb AS linhas, ")}
         FROM cadastro.importacoes_leads i
         LEFT JOIN cadastro.campanhas c ON c.id = i.campanha_id
        WHERE i.conta_id = ${contaSql()} AND i.status <> 'analisada'
        ORDER BY i.criado_em DESC LIMIT 20`,
    );
    res.json(rows.map((l) => paraTela(l, false)));
  });

  /** 1) Lê o arquivo e reconhece as colunas. */
  r.post('/analisar', exigirAdmin, async (req, res) => {
    const arq = corpo(req, arquivoImportacaoEntrada);
    const dados = Buffer.from(arq.base64, 'base64');
    const formato = formatoDoArquivo(arq.nome, arq.mime);
    const s = await deps.servicos(conta());
    const avisos: string[] = [];
    let linhas: string[][];
    let cabecalho: number | null;
    let campos: MapaImportacao;
    let leitura: 'regras' | 'ia' = 'regras';

    if (formato === 'pdf') {
      const texto = await textoDoPdf(dados);
      let tabela: string[][] = [];
      if (s.iaImportacao) {
        const pedacos = pedacosDoTexto(texto);
        if (pedacos.length > MAX_PEDACOS_PDF)
          avisos.push(
            'O PDF é grande: foram lidas só as primeiras páginas. Para a lista toda, envie em Excel ou CSV.',
          );
        for (const p of pedacos.slice(0, MAX_PEDACOS_PDF)) {
          try {
            tabela.push(...(await s.iaImportacao.extrairDoTexto(p)));
          } catch (erro) {
            log.warn({ err: erro }, 'importação: a IA não leu um pedaço do PDF');
          }
        }
      }
      if (tabela.length) {
        leitura = 'ia';
        campos = [...COLUNAS_PDF];
        linhas = [COLUNAS_PDF.map((c) => ROTULO_CAMPO_IMPORTACAO[c]), ...tabela];
      } else {
        tabela = linhasDoPdfSemIa(texto);
        campos = ['empresa', 'telefone', 'email'];
        linhas = [['Nome', 'Telefone', 'E-mail'], ...tabela];
      }
      if (!tabela.length) throw AppError.invalido('Não achei nenhum contato (telefone ou e-mail) neste PDF.');
      cabecalho = 0;
    } else {
      linhas = formato === 'xlsx' ? (await lerPlanilhaExcel(dados)).linhas : lerCsv(textoDoCsv(dados));
      linhas = linhas.map((l) => l.slice(0, LARGURA_MAXIMA).map((c) => c.trim()));
      if (!linhas.length) throw AppError.invalido('A planilha está vazia.');
      cabecalho = acharCabecalho(linhas);
      campos = detectarCampos(
        cabecalho == null ? null : (linhas[cabecalho] ?? null),
        linhas.slice(cabecalho == null ? 0 : cabecalho + 1),
      );
      if (s.iaImportacao)
        try {
          const ia = await s.iaImportacao.mapear({ linhas: linhas.slice(0, 14), palpite: campos, cabecalho });
          if (ia) {
            campos = ia.mapa;
            cabecalho = ia.cabecalho;
            leitura = 'ia';
          }
        } catch (erro) {
          log.warn({ err: erro }, 'importação: a IA não confirmou as colunas; ficam as regras');
        }
    }

    const inicio = cabecalho == null ? 0 : cabecalho + 1;
    if (linhas.length - inicio > MAX_LINHAS) {
      avisos.push(
        `O arquivo tem ${(linhas.length - inicio).toLocaleString('pt-BR')} linhas: entram as primeiras ${MAX_LINHAS.toLocaleString('pt-BR')}. Divida o resto em outro arquivo.`,
      );
      linhas = linhas.slice(0, inicio + MAX_LINHAS);
    }
    if (linhas.length - inicio < 1)
      throw AppError.invalido('A planilha só tem o cabeçalho, sem nenhum lead.');

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.importacoes_leads (conta_id, usuario_id, arquivo, formato, linhas, mapa, leitura, resultado)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        usuarioAtual()?.id ?? null,
        arq.nome.slice(0, 200),
        formato,
        JSON.stringify(linhas),
        JSON.stringify({ campos, cabecalho }),
        leitura,
        JSON.stringify({ avisos }),
      ],
    );
    // Rascunhos esquecidos (só a análise, sem importar) não ficam guardados para sempre.
    await pool.query(
      `DELETE FROM cadastro.importacoes_leads
        WHERE conta_id = ${contaSql()} AND status = 'analisada' AND criado_em < now() - interval '2 days'`,
    );
    res.status(201).json(paraTela(await obter(Number(rows[0]!.id))));
  });

  r.get('/:id', async (req, res) => {
    res.json(paraTela(await obter(idDaRota(req))));
  });

  /** Lê o arquivo com as colunas escolhidas: como os leads vão ficar e o que falta. */
  async function ler(
    l: Linha,
    d: {
      mapa: MapaImportacao;
      cabecalho?: number | null;
      cidadePadrao?: string | null;
      ufPadrao?: string | null;
    },
  ) {
    const cabecalho = d.cabecalho === undefined ? l.mapa.cabecalho : d.cabecalho;
    return {
      cabecalho,
      leitura: lerLeads(dadosDa(l, cabecalho), d.mapa, { cidade: d.cidadePadrao, uf: d.ufPadrao }),
    };
  }

  /** 2) Prévia com as colunas que o cliente escolheu (nada é gravado além da escolha). */
  r.post('/:id/previa', exigirAdmin, async (req, res) => {
    const d = corpo(req, mapaImportacaoEntrada);
    const l = await obter(idDaRota(req));
    if (l.status !== 'analisada') throw AppError.conflito('Esta lista já foi importada.');
    const { cabecalho, leitura } = await ler(l, d);
    await pool.query(`UPDATE cadastro.importacoes_leads SET mapa = $2 WHERE id = $1`, [
      l.id,
      JSON.stringify({ campos: d.mapa, cabecalho }),
    ]);
    const leads = leitura.leads;
    const cnpjs = leads.map((x) => x.cnpj).filter(Boolean);
    const { rows: ja } = cnpjs.length
      ? await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM descoberta.empresas e WHERE e.cnpj = ANY($1::text[]) AND ${daConta('e.id')}`,
          [cnpjs],
        )
      : { rows: [{ n: 0 }] };
    res.json({
      leads: leads.length,
      amostra: leads.slice(0, 6),
      semNome: leitura.semNome.length,
      repetidas: leitura.repetidas,
      semContato: leitura.semContato,
      semCidade: leitura.semCidade,
      comTelefone: leads.filter((x) => x.telefones.length).length,
      comEmail: leads.filter((x) => x.emails.length).length,
      comCnpj: cnpjs.length,
      comContato: leads.filter((x) => x.contato).length,
      jaNaConta: ja[0]?.n ?? 0,
    });
  });

  /** 3) Importa: cria a lista (ou usa a campanha), guarda os leads e manda o worker gravar. */
  r.post('/:id/importar', exigirAdmin, async (req, res) => {
    const d = corpo(req, confirmarImportacaoEntrada);
    const l = await obter(idDaRota(req));
    if (l.status !== 'analisada') throw AppError.conflito('Esta lista já foi importada.');
    const { cabecalho, leitura } = await ler(l, d);
    // Sem cidade não dá para cadastrar a empresa: entra quem tem (ou a cidade padrão).
    const leads: LeadImportado[] = leitura.leads.filter((x) => x.cidade && x.uf);
    const semCidade = leitura.leads.length - leads.length;
    if (!leads.length)
      throw AppError.invalido(
        semCidade
          ? 'Nenhum lead tem cidade e UF. Informe a cidade padrão (ou a coluna da cidade) para importar.'
          : 'Nenhuma linha tem nome de empresa ou de contato. Confira as colunas.',
      );
    if (d.funil?.responsavelId) {
      const { rows } = await pool.query(
        `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
        [d.funil.responsavelId],
      );
      if (!rows[0]) throw AppError.invalido('Escolha alguém da sua equipe para receber os leads.');
    }

    let campanhaId: number;
    if ('campanhaId' in d.destino) {
      const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM cadastro.campanhas WHERE id = $1 AND conta_id = ${contaSql()}`,
        [d.destino.campanhaId],
      );
      if (!rows[0]) throw AppError.naoEncontrado('Campanha');
      campanhaId = Number(rows[0].id);
    } else {
      const { nome, nichoId } = d.destino.nova;
      const { rows: nicho } = await pool.query(
        `SELECT 1 FROM cadastro.nichos WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
        [nichoId],
      );
      if (!nicho[0]) throw AppError.invalido('Escolha um nicho da sua conta para a lista.');
      // As cidades da lista: as que mais aparecem (a tela de campanhas mostra).
      const porCidade = new Map<string, { cidade: string; uf: string; n: number }>();
      for (const x of leads) {
        const k = `${normalizarCidade(x.cidade!)}|${x.uf}`;
        const c = porCidade.get(k) ?? { cidade: x.cidade!, uf: x.uf!, n: 0 };
        c.n++;
        porCidade.set(k, c);
      }
      const cidades = [...porCidade.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 30)
        .map(({ cidade, uf }) => ({ cidade, uf }));
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO cadastro.campanhas (conta_id, nome, nicho_id, cidades, raio_km, tipo, status, iniciada_em)
         VALUES (${contaSql()}, $1, $2, $3, NULL, 'importacao', 'ativa', now()) RETURNING id`,
        [nome, nichoId, JSON.stringify(cidades)],
      );
      campanhaId = Number(rows[0]!.id);
    }

    const resultado = {
      ...l.resultado,
      leads: leads.length,
      semCidade,
      semNome: leitura.semNome.length,
      repetidas: leitura.repetidas,
    };
    await pool.query(
      `UPDATE cadastro.importacoes_leads
          SET status = 'na_fila', mapa = $2, opcoes = $3, campanha_id = $4, leads = $5, total = $6,
              gravados = 0, resultado = $7, linhas = '[]'
        WHERE id = $1`,
      [
        l.id,
        JSON.stringify({ campos: d.mapa, cabecalho }),
        JSON.stringify({
          enriquecer: d.enriquecer,
          funil: d.funil,
          cidadePadrao: d.cidadePadrao ?? null,
          ufPadrao: d.ufPadrao ?? null,
        }),
        campanhaId,
        JSON.stringify(leads),
        leads.length,
        JSON.stringify(resultado),
      ],
    );
    await filas.publicar('leads.importar', { importacaoId: l.id });
    log.info(
      { importacaoId: l.id, campanhaId, leads: leads.length, enriquecer: d.enriquecer, funil: !!d.funil },
      'importação de leads na fila',
    );
    res.status(202).json(paraTela(await obter(l.id), false));
  });

  /** Desiste da importação (só antes de importar). */
  r.delete('/:id', exigirAdmin, async (req, res) => {
    await pool.query(
      `DELETE FROM cadastro.importacoes_leads WHERE id = $1 AND conta_id = ${contaSql()} AND status = 'analisada'`,
      [idDaRota(req)],
    );
    res.status(204).end();
  });

  return r;
}
