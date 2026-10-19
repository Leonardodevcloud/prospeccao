import type { Pool } from '@prospeccao/db';
import { receita } from '@prospeccao/integrations';
import type { Logger } from '@prospeccao/shared';
import type { FonteArquivos } from './fonte.js';
import * as repo from './repositorio.js';

const LOTE = 1000;

export interface ResultadoImportacao {
  mes: string;
  linhasLidas: number;
  estabelecimentos: number;
  empresas: number;
  socios: number;
}

interface Contexto {
  pool: Pool;
  log: Logger;
  fonte: FonteArquivos;
  importacaoId: number;
  /** UFs a importar além das que vêm das campanhas (ex.: praças futuras). */
  ufsExtras: string[];
}

const NOME_DOMINIO: Record<string, string> = {
  municipios: 'municípios',
  qualificacoes: 'qualificações dos sócios',
  cnaes: 'CNAEs',
};

const mb = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const gb = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** "350 MB", "1,1 GB". */
export function fmtBytes(bytes: number): string {
  return bytes >= 1e9 ? `${gb.format(bytes / 1e9)} GB` : `${mb.format(bytes / 1e6)} MB`;
}

/** "baixando 412 MB de 1,1 GB · 2,3 MB/s · faltam ~5 min" */
export function textoDownload(feito: number, tamanho: number | null, ms: number): string {
  const porSegundo = ms > 0 ? feito / (ms / 1000) : 0;
  const partes = [`baixando ${fmtBytes(feito)}${tamanho ? ` de ${fmtBytes(tamanho)}` : ''}`];
  if (porSegundo > 0) partes.push(`${gb.format(porSegundo / 1e6)} MB/s`);
  if (tamanho && porSegundo > 0) {
    const min = Math.ceil((tamanho - feito) / porSegundo / 60);
    partes.push(min <= 1 ? 'falta ~1 min' : `faltam ~${min} min`);
  }
  return partes.join(' · ');
}

/**
 * Grava o andamento na tabela de importações sem martelar o banco: `agora` grava na hora
 * (troca de etapa), `talvez` só se passou o intervalo (download, leitura). As gravações vão
 * em fila, uma depois da outra, então a última etapa sempre prevalece.
 */
export class Andamento {
  private ultimaGravacao = 0;
  private etapa = '';
  private fila: Promise<void> = Promise.resolve();

  constructor(
    private readonly gravar: (etapa: string) => Promise<void>,
    private readonly intervaloMs = 4_000,
  ) {}

  agora(etapa: string): Promise<void> {
    this.etapa = etapa;
    this.ultimaGravacao = Date.now();
    this.fila = this.fila.then(() => this.gravar(etapa)).catch(() => {});
    return this.fila;
  }

  /** Chamado em callbacks síncronos (download): não espera a gravação. */
  talvez(etapa: string): void {
    this.etapa = etapa;
    if (Date.now() - this.ultimaGravacao >= this.intervaloMs) void this.agora(etapa);
  }

  /** Durante a leitura: regrava a etapa atual com os contadores novos, se passou o intervalo. */
  async talvezAgora(): Promise<void> {
    if (Date.now() - this.ultimaGravacao >= this.intervaloMs) await this.agora(this.etapa);
  }

  terminar(): Promise<void> {
    return this.fila;
  }
}

/** Acumula itens e grava em lotes, sem duplicar chave dentro do mesmo lote. */
class Lote<T> {
  private itens = new Map<string, T>();
  constructor(
    private readonly chave: (item: T) => string,
    private readonly gravar: (itens: T[]) => Promise<void>,
    private readonly tamanho = LOTE,
  ) {}

  async adicionar(item: T) {
    this.itens.set(this.chave(item), item);
    if (this.itens.size >= this.tamanho) await this.descarregar();
  }

  async descarregar() {
    if (!this.itens.size) return;
    const itens = [...this.itens.values()];
    this.itens.clear();
    await this.gravar(itens);
  }
}

/**
 * Importa uma publicação da Receita mantendo só o que interessa às campanhas:
 * estabelecimentos das UFs e CNAEs-alvo (qualquer situação, para registrar
 * fechamentos), depois as empresas e os sócios desses estabelecimentos.
 */
export async function importarBaseCnpj(ctx: Contexto): Promise<ResultadoImportacao> {
  const { pool, log, fonte, importacaoId } = ctx;
  const importacao = await repo.obterImportacao(pool, importacaoId);
  if (!importacao) throw new Error(`Importação ${importacaoId} não existe`);

  const alvos = await repo.lerAlvos(pool);
  const ufs = [...new Set([...alvos.ufs, ...ctx.ufsExtras])].sort();
  const cnaes = new Set(alvos.cnaes);
  if (!cnaes.size) throw new Error('Nenhum nicho ativo com CNAE: cadastre um nicho antes de importar.');
  if (!ufs.length)
    throw new Error('Nenhuma UF alvo: crie uma campanha com cidades ou defina CNPJ_UFS_EXTRAS.');
  const ufsAlvo = new Set(ufs);

  const mes = await fonte.resolverMes(importacao.mes === 'auto' ? null : importacao.mes);
  await repo.marcarInicio(pool, importacaoId, mes, ufs, [...cnaes]);
  const log_ = log.child({ importacaoId, mes });
  log_.info({ ufs, cnaes: cnaes.size }, 'importação iniciada');

  const placar: ResultadoImportacao = { mes, linhasLidas: 0, estabelecimentos: 0, empresas: 0, socios: 0 };
  const andamento = new Andamento((etapa) =>
    repo.registrarProgresso(pool, importacaoId, { etapa, ...placar }),
  );
  const progresso = (etapa: string) => andamento.agora(etapa);

  // 1. Tabelas de domínio (pequenas).
  const dominios = [
    ['municipios', receita.ARQUIVOS.municipios, (c: string) => c.padStart(4, '0')],
    ['qualificacoes', receita.ARQUIVOS.qualificacoes, (c: string) => c.padStart(2, '0')],
    ['cnaes', receita.ARQUIVOS.cnaes, (c: string) => c.padStart(7, '0')],
  ] as const;
  for (const [tabela, arquivos, normalizarCodigo] of dominios) {
    await progresso(`Etapa 1 de 4 · Tabelas de apoio (${NOME_DOMINIO[tabela]})`);
    for (const nome of arquivos) {
      const caminho = await fonte.obter(nome);
      const lote = new Lote<{ codigo: string; descricao: string }>(
        (i) => i.codigo,
        (itens) => repo.salvarDominio(pool, tabela, itens),
      );
      for await (const linha of receita.lerZipReceita(caminho)) {
        const item = receita.lerCodigoDescricao(linha);
        if (item) await lote.adicionar({ codigo: normalizarCodigo(item.codigo), descricao: item.descricao });
      }
      await lote.descarregar();
      await fonte.liberar(caminho);
    }
  }

  // 2. Estabelecimentos: o filtro principal (UF + CNAE).
  const basicos = new Set<string>();
  const loteEstab = new Lote<receita.Estabelecimento>(
    (e) => e.cnpj,
    (itens) => repo.salvarEstabelecimentos(pool, importacaoId, itens),
  );
  for (const [i, nome] of receita.ARQUIVOS.estabelecimentos.entries()) {
    const total = receita.ARQUIVOS.estabelecimentos.length;
    const etapa = `Etapa 2 de 4 · Estabelecimentos · arquivo ${i + 1} de ${total}`;
    await progresso(`${etapa} · baixando`);
    const inicioDownload = Date.now();
    const caminho = await fonte.obter(nome, (feito, tamanho) =>
      andamento.talvez(`${etapa} · ${textoDownload(feito, tamanho, Date.now() - inicioDownload)}`),
    );
    await progresso(`${etapa} · lendo`);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
      if (placar.linhasLidas % 50_000 === 0) await andamento.talvezAgora();
      // Filtro barato antes do parse completo: UF fica na coluna 19.
      if (!ufsAlvo.has(linha[19] ?? '')) continue;
      const e = receita.lerEstabelecimento(linha);
      if (!e) continue;
      if (!cnaes.has(e.cnaePrincipal) && !e.cnaesSecundarios.some((c) => cnaes.has(c))) continue;
      await loteEstab.adicionar(e);
      basicos.add(e.cnpjBasico);
      placar.estabelecimentos++;
    }
    await loteEstab.descarregar();
    await fonte.liberar(caminho);
    log_.info({ arquivo: nome, ...placar }, 'arquivo de estabelecimentos processado');
  }

  // 3. Empresas (razão social, porte) só dos estabelecimentos guardados.
  const loteEmp = new Lote<receita.Empresa>(
    (e) => e.cnpjBasico,
    (itens) => repo.salvarEmpresas(pool, importacaoId, itens),
  );
  for (const [i, nome] of receita.ARQUIVOS.empresas.entries()) {
    const total = receita.ARQUIVOS.empresas.length;
    const etapa = `Etapa 3 de 4 · Empresas (razão social e porte) · arquivo ${i + 1} de ${total}`;
    await progresso(`${etapa} · baixando`);
    const inicioDownload = Date.now();
    const caminho = await fonte.obter(nome, (feito, tamanho) =>
      andamento.talvez(`${etapa} · ${textoDownload(feito, tamanho, Date.now() - inicioDownload)}`),
    );
    await progresso(`${etapa} · lendo`);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
      if (placar.linhasLidas % 50_000 === 0) await andamento.talvezAgora();
      if (!basicos.has((linha[0] ?? '').padStart(8, '0'))) continue;
      const e = receita.lerEmpresa(linha);
      if (!e) continue;
      await loteEmp.adicionar(e);
      placar.empresas++;
    }
    await loteEmp.descarregar();
    await fonte.liberar(caminho);
  }

  // 4. Sócios: quadro substituído por inteiro.
  await repo.limparSocios(pool, [...basicos]);
  let loteSocios: receita.Socio[] = [];
  for (const [i, nome] of receita.ARQUIVOS.socios.entries()) {
    const total = receita.ARQUIVOS.socios.length;
    const etapa = `Etapa 4 de 4 · Sócios · arquivo ${i + 1} de ${total}`;
    await progresso(`${etapa} · baixando`);
    const inicioDownload = Date.now();
    const caminho = await fonte.obter(nome, (feito, tamanho) =>
      andamento.talvez(`${etapa} · ${textoDownload(feito, tamanho, Date.now() - inicioDownload)}`),
    );
    await progresso(`${etapa} · lendo`);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
      if (placar.linhasLidas % 50_000 === 0) await andamento.talvezAgora();
      if (!basicos.has((linha[0] ?? '').padStart(8, '0'))) continue;
      const s = receita.lerSocio(linha);
      if (!s) continue;
      loteSocios.push(s);
      placar.socios++;
      if (loteSocios.length >= LOTE) {
        await repo.salvarSocios(pool, importacaoId, loteSocios);
        loteSocios = [];
      }
    }
    await repo.salvarSocios(pool, importacaoId, loteSocios);
    loteSocios = [];
    await fonte.liberar(caminho);
  }

  await progresso('Finalizando');
  await andamento.terminar();
  log_.info(placar, 'importação concluída');
  return placar;
}
