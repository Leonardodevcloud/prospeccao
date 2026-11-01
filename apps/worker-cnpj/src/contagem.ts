import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import { NICHOS_PRONTOS } from '@prospeccao/shared';

/**
 * Contador público do site: estabelecimentos ativos de cada nicho pronto por município, no Brasil
 * todo. Lido junto com os estabelecimentos (todas as linhas, antes do filtro de UF da campanha);
 * cada arquivo soma na tabela "nova", que troca pela publicada quando os estabelecimentos acabam.
 */

const soDigitos = (v: string) => v.replace(/\D/g, '');

/** CNAE (7 dígitos) → nichos prontos que o usam. */
const NICHOS_DO_CNAE = (() => {
  const m = new Map<string, string[]>();
  for (const n of NICHOS_PRONTOS)
    for (const c of n.cnaes) {
      const d = soDigitos(c);
      m.set(d, [...(m.get(d) ?? []), n.id]);
    }
  return m;
})();

export class ContagemNichos {
  private contas = new Map<string, number>();

  /** Uma linha do arquivo de estabelecimentos da Receita (colunas cruas). */
  linha(c: string[]): void {
    if ((c[5] ?? '').padStart(2, '0') !== '02') return;
    const uf = (c[19] ?? '').trim().toUpperCase();
    const municipio = (c[20] ?? '').trim().padStart(4, '0');
    if (uf.length !== 2 || !municipio.trim()) return;
    let nichos: Set<string> | null = null;
    const somar = (cnae: string) => {
      const ns = NICHOS_DO_CNAE.get(soDigitos(cnae));
      if (!ns) return;
      nichos ??= new Set();
      for (const n of ns) nichos.add(n);
    };
    somar(c[11] ?? '');
    const sec = c[12] ?? '';
    if (sec) for (const x of sec.split(',')) somar(x);
    if (!nichos) return;
    for (const n of nichos as Set<string>) {
      const k = `${uf}|${municipio}|${n}`;
      this.contas.set(k, (this.contas.get(k) ?? 0) + 1);
    }
  }

  get tamanho(): number {
    return this.contas.size;
  }

  /** Soma o que juntou na contagem nova e começa de novo. */
  async descarregar(db: Executor): Promise<void> {
    const itens = [...this.contas.entries()];
    this.contas.clear();
    for (let i = 0; i < itens.length; i += 5000) {
      const parte = itens
        .slice(i, i + 5000)
        .map(([k, v]) => [...k.split('|'), v] as [string, string, string, number]);
      await db.query(
        `INSERT INTO base_cnpj.contagem_nichos_nova (uf, municipio_codigo, nicho, ativas)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
         ON CONFLICT (uf, municipio_codigo, nicho) DO UPDATE
           SET ativas = base_cnpj.contagem_nichos_nova.ativas + EXCLUDED.ativas`,
        [parte.map((p) => p[0]), parte.map((p) => p[1]), parte.map((p) => p[2]), parte.map((p) => p[3])],
      );
    }
  }
}

/** Importação nova (não retomada): a contagem nova começa do zero. */
export async function zerarContagemNova(db: Executor): Promise<void> {
  await db.query('TRUNCATE base_cnpj.contagem_nichos_nova');
}

/** Os estabelecimentos acabaram: a contagem nova vira a publicada (se juntou alguma coisa). */
export async function publicarContagem(pool: Pool): Promise<number> {
  return comTransacao(pool, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM base_cnpj.contagem_nichos_nova',
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) {
      await c.query('DELETE FROM base_cnpj.contagem_nichos');
      await c.query('INSERT INTO base_cnpj.contagem_nichos SELECT * FROM base_cnpj.contagem_nichos_nova');
      await c.query('TRUNCATE base_cnpj.contagem_nichos_nova');
    }
    return n;
  });
}
