import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { receita } from '@prospeccao/integrations';
import type { Logger } from '@prospeccao/shared';

/**
 * De onde vêm os zips da Receita. Em produção, baixados do site oficial; em
 * desenvolvimento ou em caso de bloqueio do site, de uma pasta local.
 */
export interface FonteArquivos {
  /** Mês da publicação que será lida (AAAA-MM). */
  resolverMes(mesPedido: string | null): Promise<string>;
  /** Caminho local do zip, baixando se preciso. */
  obter(nome: string): Promise<string>;
  /** Libera o espaço do zip já processado. */
  liberar(caminho: string): Promise<void>;
}

export class FonteHttp implements FonteArquivos {
  private mes: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly pastaTemp: string,
    private readonly log: Logger,
  ) {}

  async resolverMes(mesPedido: string | null): Promise<string> {
    if (mesPedido) {
      this.mes = mesPedido;
      return mesPedido;
    }
    const meses = await receita.listarMesesPublicados(this.baseUrl);
    const maisRecente = meses[0];
    if (!maisRecente) throw new Error(`Nenhuma publicação encontrada em ${this.baseUrl}`);
    this.mes = maisRecente;
    return maisRecente;
  }

  async obter(nome: string): Promise<string> {
    if (!this.mes) throw new Error('resolverMes() precisa ser chamado antes de obter()');
    const destino = join(this.pastaTemp, this.mes, nome);
    await mkdir(join(this.pastaTemp, this.mes), { recursive: true });
    const url = receita.urlArquivo(this.baseUrl, this.mes, nome);
    const inicio = Date.now();
    const bytes = await receita.baixarArquivo(url, destino, this.baseUrl);
    this.log.info(
      { arquivo: nome, mb: Math.round(bytes / 1e6), s: Math.round((Date.now() - inicio) / 1000) },
      'download concluído',
    );
    return destino;
  }

  async liberar(caminho: string): Promise<void> {
    await rm(caminho, { force: true });
  }
}

/** Zips já baixados numa pasta (útil em dev ou quando o site da Receita está fora). */
export class FontePasta implements FonteArquivos {
  constructor(
    private readonly pasta: string,
    private readonly mesInformado: string,
  ) {}

  async resolverMes(mesPedido: string | null): Promise<string> {
    return mesPedido ?? this.mesInformado;
  }

  async obter(nome: string): Promise<string> {
    const caminho = join(this.pasta, nome);
    await access(caminho);
    return caminho;
  }

  async liberar(): Promise<void> {
    // arquivos locais pertencem a quem os colocou na pasta
  }
}
