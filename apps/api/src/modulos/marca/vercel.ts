/**
 * Domínio próprio dos clientes no Vercel (o projeto do painel): cadastrar, conferir e remover.
 * O cliente só cria o registro no DNS dele; o resto (cadastro no projeto, certificado HTTPS,
 * conferência) é feito daqui. Sem VERCEL_TOKEN e VERCEL_PROJETO, a tela explica que falta.
 */

export interface RegistroDns {
  tipo: 'CNAME' | 'A' | 'TXT';
  /** Nome como o painel de DNS pede (o pedaço antes do domínio; "@" na raiz). */
  nome: string;
  /** O host completo do registro (para quem prefere conferir). */
  host: string;
  valor: string;
}

export interface SituacaoDominio {
  /** O domínio está liberado para este projeto (sem TXT pendente). */
  verificado: boolean;
  /** O DNS aponta para o Vercel e o certificado HTTPS pode ser gerado. */
  configurado: boolean;
  registros: RegistroDns[];
}

export interface DominiosSite {
  /** Cadastra no projeto (se já estiver, segue) e devolve o que o cliente precisa criar no DNS. */
  adicionar(dominio: string): Promise<SituacaoDominio>;
  /** Confere de novo (pede a verificação do TXT, quando é o caso). */
  conferir(dominio: string): Promise<SituacaoDominio>;
  remover(dominio: string): Promise<void>;
}

export class ErroVercel extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: string | null,
  ) {
    super(mensagem);
  }
}

interface Config {
  token: string;
  projeto: string;
  time?: string | null;
  /** Para os testes. */
  fetch?: typeof fetch;
}

/** O pedaço do host antes do domínio raiz ("crm" em crm.empresa.com.br; "@" na raiz). */
function nomeRelativo(host: string, raiz: string): string {
  if (host === raiz) return '@';
  return host.endsWith(`.${raiz}`) ? host.slice(0, -(raiz.length + 1)) : host;
}

export function dominiosVercel(cfg: Config): DominiosSite {
  const f = cfg.fetch ?? fetch;
  const projeto = encodeURIComponent(cfg.projeto);
  const time = cfg.time ? `teamId=${encodeURIComponent(cfg.time)}` : '';
  const url = (caminho: string, extra = '') => {
    const q = [time, extra].filter(Boolean).join('&');
    return `https://api.vercel.com${caminho}${q ? `?${q}` : ''}`;
  };

  async function chamar<T>(metodo: string, caminho: string, corpo?: unknown, extra = ''): Promise<T> {
    const r = await f(url(caminho, extra), {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text();
    const dados = texto
      ? (JSON.parse(texto) as T & { error?: { code?: string; message?: string } })
      : ({} as T);
    if (!r.ok) {
      const e = (dados as { error?: { code?: string; message?: string } }).error;
      throw new ErroVercel(e?.message ?? `Vercel respondeu ${r.status}`, r.status, e?.code ?? null);
    }
    return dados;
  }

  interface DominioProjeto {
    name: string;
    apexName: string;
    verified: boolean;
    verification?: { type: string; domain: string; value: string; reason: string }[];
  }
  interface ConfigDominio {
    misconfigured: boolean;
    recommendedCNAME?: { rank: number; value: string }[];
    recommendedIPv4?: { rank: number; value: string[] }[];
  }

  async function situacao(d: DominioProjeto): Promise<SituacaoDominio> {
    const c = await chamar<ConfigDominio>(
      'GET',
      `/v6/domains/${encodeURIComponent(d.name)}/config`,
      undefined,
      `projectIdOrName=${projeto}`,
    );
    const raiz = d.apexName || d.name;
    const registros: RegistroDns[] = [];
    if (d.name === raiz) {
      // Raiz do domínio (empresa.com.br): CNAME não vale na raiz, vai um registro A.
      const ip = [...(c.recommendedIPv4 ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value[0] ?? '76.76.21.21';
      registros.push({ tipo: 'A', nome: '@', host: d.name, valor: ip });
    } else {
      const cname =
        [...(c.recommendedCNAME ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value ?? 'cname.vercel-dns.com';
      registros.push({
        tipo: 'CNAME',
        nome: nomeRelativo(d.name, raiz),
        host: d.name,
        valor: cname.replace(/\.$/, ''),
      });
    }
    // O domínio já é usado em outra conta do Vercel: ele pede um TXT provando que é seu.
    for (const v of d.verified ? [] : (d.verification ?? []))
      if (v.type === 'TXT')
        registros.push({ tipo: 'TXT', nome: nomeRelativo(v.domain, raiz), host: v.domain, valor: v.value });
    return { verificado: d.verified, configurado: !c.misconfigured, registros };
  }

  return {
    async adicionar(dominio) {
      let d: DominioProjeto;
      try {
        d = await chamar<DominioProjeto>('POST', `/v10/projects/${projeto}/domains`, { name: dominio });
      } catch (erro) {
        // Já está no projeto (o cliente tentou de novo): segue com o que já existe.
        if (erro instanceof ErroVercel && erro.status === 400 && /already|exist/i.test(erro.message))
          d = await chamar<DominioProjeto>(
            'GET',
            `/v9/projects/${projeto}/domains/${encodeURIComponent(dominio)}`,
          );
        else throw erro;
      }
      return situacao(d);
    },
    async conferir(dominio) {
      let d = await chamar<DominioProjeto>(
        'GET',
        `/v9/projects/${projeto}/domains/${encodeURIComponent(dominio)}`,
      );
      if (!d.verified)
        d = await chamar<DominioProjeto>(
          'POST',
          `/v9/projects/${projeto}/domains/${encodeURIComponent(dominio)}/verify`,
        ).catch(() => d);
      return situacao(d);
    },
    async remover(dominio) {
      await chamar('DELETE', `/v9/projects/${projeto}/domains/${encodeURIComponent(dominio)}`).catch(
        (erro) => {
          // Já não estava no projeto: tudo bem.
          if (!(erro instanceof ErroVercel && erro.status === 404)) throw erro;
        },
      );
    },
  };
}

/** Pelas variáveis do Railway; sem token ou projeto, null (a tela explica que falta configurar). */
export function dominiosDoAmbiente(amb: {
  vercelToken?: string | null;
  vercelProjeto?: string | null;
  vercelTime?: string | null;
}): DominiosSite | null {
  if (!amb.vercelToken || !amb.vercelProjeto) return null;
  return dominiosVercel({ token: amb.vercelToken, projeto: amb.vercelProjeto, time: amb.vercelTime });
}

/** Mensagem para o cliente quando o Vercel recusa o domínio. */
export function explicarErroVercel(erro: unknown): string {
  if (erro instanceof ErroVercel) {
    if (erro.status === 409)
      return 'Este endereço já está em uso em outro site. Use outro subdomínio (por exemplo, crm. ou sistema.).';
    if (erro.status === 400) return 'O Vercel não aceitou este endereço. Confira se está escrito certo.';
    if (erro.status === 401 || erro.status === 403)
      return 'A plataforma não conseguiu cadastrar o domínio agora. Avise o suporte.';
  }
  return 'Não deu para falar com o serviço de domínios agora. Tente de novo em alguns minutos.';
}
