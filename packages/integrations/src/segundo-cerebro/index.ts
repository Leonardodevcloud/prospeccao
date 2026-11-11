import { buscarNaInternet, EnderecoRecusado } from '../rede.js';

/**
 * O segundo cérebro da empresa (o "Cérebro · Central Tutts", repositório brain): o Prospect Team lê
 * o conhecimento que está valendo lá (regras, decisões, fichas de clientes, POPs) para os agentes de
 * carrosséis, cards e vídeos, e devolve o que aprendeu com o Instagram como RASCUNHO.
 *
 * O outro lado (`/api/externo`) já tira restritos e rascunhos e mascara e-mail, CPF, telefone etc.
 * Aqui: só https (http só nos testes), sem seguir redirecionamento (o token não vai para outro
 * endereço), prazo curto e resposta pequena. Nada aqui derruba o time: quem chama trata o erro.
 */

export const SISTEMA = 'Prospect Team';

export interface ConexaoCerebro {
  /** Endereço base, ex.: https://cerebro.tutts.com.br/api/externo */
  url: string;
  /** Token de sistema gerado no Cérebro (cbr_…). */
  token: string;
}

export interface OpcoesCerebro {
  timeoutMs?: number;
  /** Só nos testes: aceita http e a própria máquina. */
  redeLocal?: boolean;
}

export interface QuemSou {
  ok: true;
  cerebro: string;
  usuario: { nome: string; papel: string };
  pode: { buscar: boolean; ler: boolean; guardarRascunho: boolean };
}

export interface TrechoDoCerebro {
  codigo: string;
  titulo: string;
  tipo: string;
  tipoNome: string;
  status: string;
  emRevisao: boolean;
  trecho: string;
  link: string;
}

export interface RegistroDoCerebro {
  codigo: string;
  titulo: string;
  tipoNome: string;
  status: string;
  conteudo: string;
  link: string;
}

export interface RascunhoParaOCerebro {
  titulo: string;
  conteudo: string;
  tipo?: 'nota' | 'indicador' | 'ocorrencia';
  area?: 'marketing' | 'comercial' | 'atendimento' | 'gestao';
  /** Mandar de novo com o mesmo idExterno não duplica no Cérebro. */
  idExterno?: string;
}

export interface RascunhoGuardado {
  codigo: string;
  status: string;
  link: string;
  jaExistia: boolean;
}

/** Erro que vira mensagem para a pessoa (a tela mostra como está). */
export class ErroDoCerebro extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = 'ErroDoCerebro';
  }
}

/** Aceita o endereço do site do Cérebro, o da API ou o de /api/externo e devolve sempre o de /api/externo. */
export function enderecoDaApi(bruto: string): string {
  const texto = bruto.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw new ErroDoCerebro(
      'Endereço inválido. Cole o endereço que aparece no Cérebro (Integrações › Outros sistemas).',
    );
  }
  url.search = '';
  url.hash = '';
  const caminho = url.pathname.replace(/\/+$/, '');
  if (/\/api\/externo$/.test(caminho)) url.pathname = caminho;
  else if (/\/api$/.test(caminho)) url.pathname = `${caminho}/externo`;
  else url.pathname = `${caminho}/api/externo`;
  return url.href.replace(/\/+$/, '');
}

async function chamar<T>(
  c: ConexaoCerebro,
  o: OpcoesCerebro,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  let r: Awaited<ReturnType<typeof buscarNaInternet>>;
  try {
    r = await buscarNaInternet(`${c.url.replace(/\/+$/, '')}${caminho}`, {
      metodo,
      cabecalhos: {
        authorization: `Bearer ${c.token}`,
        accept: 'application/json',
        'x-sistema': SISTEMA,
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      corpo: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      timeoutMs: o.timeoutMs ?? 8000,
      limiteBytes: 512 * 1024,
      redirecionamentos: 0,
      soHttps: !o.redeLocal,
      redeLocal: !!o.redeLocal,
    });
  } catch (erro) {
    if (erro instanceof EnderecoRecusado) throw new ErroDoCerebro(erro.message);
    if ((erro as Error).name === 'TimeoutError') throw new ErroDoCerebro('O Cérebro demorou para responder.');
    throw new ErroDoCerebro('Não consegui falar com o Cérebro. Confira o endereço.');
  }
  let json: unknown = null;
  try {
    json = r.corpo.length ? JSON.parse(r.corpo.toString('utf8')) : null;
  } catch {
    json = null;
  }
  if (r.status >= 200 && r.status < 300) {
    if (json === null)
      throw new ErroDoCerebro('O endereço respondeu, mas não parece ser o Cérebro.', r.status);
    return json as T;
  }
  const doCerebro = (json as { erro?: { mensagem?: string } } | null)?.erro?.mensagem;
  if (r.status >= 300 && r.status < 400)
    throw new ErroDoCerebro(
      'O endereço redireciona para outro lugar. Cole o endereço final do Cérebro.',
      r.status,
    );
  if (r.status === 401) throw new ErroDoCerebro(doCerebro ?? 'Token recusado pelo Cérebro.', 401);
  if (r.status === 404 && !doCerebro)
    throw new ErroDoCerebro(
      'Esse endereço não tem a API do Cérebro. Confira se o Cérebro está atualizado.',
      404,
    );
  if (r.status === 429)
    throw new ErroDoCerebro('Muitas chamadas seguidas ao Cérebro. Tente em um minuto.', 429);
  throw new ErroDoCerebro(doCerebro ?? `O Cérebro respondeu ${r.status}.`, r.status);
}

const texto = (v: unknown, max: number) => String(v ?? '').slice(0, max);

export function clienteDoCerebro(c: ConexaoCerebro, o: OpcoesCerebro = {}) {
  return {
    /** Confere o token e devolve de quem ele é. */
    async testar(): Promise<QuemSou> {
      const r = await chamar<QuemSou>(c, o, 'GET', '/saude');
      if (!r?.ok || !r.usuario)
        throw new ErroDoCerebro('O endereço respondeu, mas não parece ser o Cérebro.');
      return r;
    },

    /** Trechos do que está valendo no Cérebro sobre o assunto (até 6). */
    async buscar(
      pergunta: string,
      filtro: { area?: string; limite?: number } = {},
    ): Promise<TrechoDoCerebro[]> {
      const p = pergunta.replace(/\s+/g, ' ').trim().slice(0, 1000);
      if (p.length < 3) return [];
      const r = await chamar<{ itens?: TrechoDoCerebro[] }>(c, o, 'POST', '/buscar', {
        pergunta: p,
        ...(filtro.area ? { area: filtro.area } : {}),
        limite: filtro.limite ?? 6,
      });
      return (Array.isArray(r.itens) ? r.itens : []).slice(0, 6).map((i) => ({
        codigo: texto(i.codigo, 20),
        titulo: texto(i.titulo, 200),
        tipo: texto(i.tipo, 20),
        tipoNome: texto(i.tipoNome, 40),
        status: texto(i.status, 20),
        emRevisao: !!i.emRevisao,
        trecho: texto(i.trecho, 2000),
        link: texto(i.link, 500),
      }));
    },

    async ler(codigo: string): Promise<RegistroDoCerebro> {
      if (!/^[A-Za-z]{2,4}-\d{1,6}$/.test(codigo.trim()))
        throw new ErroDoCerebro('Código do registro inválido.');
      const r = await chamar<RegistroDoCerebro>(
        c,
        o,
        'GET',
        `/registros/${encodeURIComponent(codigo.trim())}`,
      );
      return { ...r, conteudo: texto(r.conteudo, 60_000) };
    },

    /** Guarda como rascunho no Cérebro (alguém aprova lá, em Revisar). */
    async guardarRascunho(d: RascunhoParaOCerebro): Promise<RascunhoGuardado> {
      return chamar<RascunhoGuardado>(c, o, 'POST', '/rascunhos', {
        tipo: d.tipo ?? 'nota',
        area: d.area ?? 'marketing',
        titulo: d.titulo.slice(0, 200),
        conteudo: d.conteudo.slice(0, 50_000),
        ...(d.idExterno ? { idExterno: d.idExterno } : {}),
      });
    },
  };
}

export type ClienteDoCerebro = ReturnType<typeof clienteDoCerebro>;
