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
  const progresso = (etapa: string) => repo.registrarProgresso(pool, importacaoId, { etapa, ...placar });

  // 1. Tabelas de domínio (pequenas).
  const dominios = [
    ['municipios', receita.ARQUIVOS.municipios, (c: string) => c.padStart(4, '0')],
    ['qualificacoes', receita.ARQUIVOS.qualificacoes, (c: string) => c.padStart(2, '0')],
    ['cnaes', receita.ARQUIVOS.cnaes, (c: string) => c.padStart(7, '0')],
  ] as const;
  for (const [tabela, arquivos, normalizarCodigo] of dominios) {
    await progresso(tabela);
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
    await progresso(`estabelecimentos ${i + 1}/${receita.ARQUIVOS.estabelecimentos.length}`);
    const caminho = await fonte.obter(nome);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
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
    await progresso(`empresas ${i + 1}/${receita.ARQUIVOS.empresas.length}`);
    const caminho = await fonte.obter(nome);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
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
    await progresso(`socios ${i + 1}/${receita.ARQUIVOS.socios.length}`);
    const caminho = await fonte.obter(nome);
    for await (const linha of receita.lerZipReceita(caminho)) {
      placar.linhasLidas++;
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

  await progresso('finalizando');
  log_.info(placar, 'importação concluída');
  return placar;
}
