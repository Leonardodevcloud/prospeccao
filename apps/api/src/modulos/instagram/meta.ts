import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A Graph API da Meta (Instagram e páginas do Facebook), pelo app da Prospect Team:
 *  • login do cliente (Facebook Login for Business) e o token da página ligada ao Instagram;
 *  • publicações, comentários, resposta pública e a resposta privada (o direct para quem comentou);
 *  • direct (Instagram pela página) e os cadastros dos formulários dos anúncios.
 * Sem META_APP_ID e META_APP_SECRET, a tela explica que a integração ainda não foi liberada.
 */

export interface PublicacaoMeta {
  id: string;
  legenda: string | null;
  tipo: string | null;
  link: string | null;
  imagem: string | null;
  em: string | null;
  comentarios: number | null;
}

export interface ContaInstagramMeta {
  id: string;
  usuario: string | null;
  nome: string | null;
  seguidores: number | null;
  foto: string | null;
}

export interface PaginaMeta {
  id: string;
  nome: string;
  token: string;
  instagram: ContaInstagramMeta | null;
}

export interface PerguntaMeta {
  chave: string;
  rotulo: string;
  tipo: string;
}

export interface CadastroMeta {
  id: string;
  formId: string | null;
  anuncio: string | null;
  campanha: string | null;
  /** ig (Instagram) ou fb (Facebook). */
  plataforma: string | null;
  em: string | null;
  respostas: { chave: string; valores: string[] }[];
}

export interface MensagemDirect {
  texto: string;
  botao?: { texto: string; link: string } | null;
}

export interface ClienteMeta {
  /** Token que a Meta manda ao cadastrar o webhook (hub.verify_token). */
  tokenVerificacao: string | null;
  urlDeLogin(redirect: string, estado: string): string;
  /** Código do login → token da pessoa (de longa duração). */
  trocarCodigo(codigo: string, redirect: string): Promise<string>;
  /** Páginas que a pessoa liberou, com o Instagram profissional ligado a cada uma. */
  paginas(tokenPessoa: string): Promise<PaginaMeta[]>;
  /** O app passa a receber os avisos da página (cadastros e direct). */
  assinarPagina(paginaId: string, token: string): Promise<void>;
  desassinarPagina(paginaId: string, token: string): Promise<void>;
  conferirAssinatura(corpo: Buffer, assinatura: string | undefined): boolean;
  contaInstagram(igId: string, token: string): Promise<ContaInstagramMeta>;
  publicacoes(igId: string, token: string, limite?: number): Promise<PublicacaoMeta[]>;
  publicacao(midiaId: string, token: string): Promise<PublicacaoMeta | null>;
  responderComentario(comentarioId: string, texto: string, token: string): Promise<void>;
  /** Resposta privada: o direct para quem comentou (uma por comentário, até 7 dias). */
  respostaPrivada(
    paginaId: string,
    comentarioId: string,
    m: MensagemDirect,
    token: string,
  ): Promise<string | null>;
  enviarDirect(paginaId: string, pessoaId: string, texto: string, token: string): Promise<string | null>;
  perfil(pessoaId: string, token: string): Promise<{ nome: string | null; usuario: string | null } | null>;
  formularios(
    paginaId: string,
    token: string,
  ): Promise<{ id: string; nome: string; status: string | null }[]>;
  perguntas(formId: string, token: string): Promise<{ nome: string; perguntas: PerguntaMeta[] }>;
  cadastro(leadgenId: string, token: string): Promise<CadastroMeta>;
}

/** Erro da Graph API, com o código da Meta (para reconhecer token vencido e mensagens bloqueadas). */
export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: number | null,
    readonly subcodigo: number | null,
  ) {
    super(mensagem);
  }
  /** Token sem validade (senha trocada, acesso removido): precisa conectar de novo. */
  get tokenInvalido(): boolean {
    return this.codigo === 190 || this.codigo === 102;
  }
  /** O Instagram não deixa o app mexer nas mensagens (o "Permitir acesso às mensagens" está desligado). */
  get mensagensBloqueadas(): boolean {
    return (
      this.subcodigo === 2534022 ||
      this.subcodigo === 2534014 ||
      /allow access to messages|connected tools|ferramentas conectadas/i.test(this.message)
    );
  }
}

/** Permissões pedidas no login (com META_CONFIG_ID, o que vale é a configuração do Login for Business). */
export const PERMISSOES_META = [
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_ads',
  'leads_retrieval',
  'business_management',
];

/** Avisos da página que o app assina (cadastros dos formulários e o direct do Instagram). */
export const CAMPOS_DA_PAGINA = ['leadgen', 'messages'];

interface ConfigMeta {
  appId: string;
  appSecret: string;
  tokenVerificacao?: string | null;
  configId?: string | null;
  versao?: string;
  /** Para os testes. */
  fetch?: typeof fetch;
}

const CAMPOS_MIDIA =
  'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,comments_count';

type Midia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  comments_count?: number;
};

const paraPublicacao = (m: Midia): PublicacaoMeta => ({
  id: m.id,
  legenda: m.caption ?? null,
  tipo: m.media_product_type === 'REELS' ? 'REELS' : (m.media_type ?? null),
  link: m.permalink ?? null,
  // Vídeo e reels: a capa; foto e carrossel: a própria imagem.
  imagem: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? null : (m.media_url ?? null)),
  em: m.timestamp ?? null,
  comentarios: m.comments_count ?? null,
});

export function clienteMeta(cfg: ConfigMeta): ClienteMeta {
  const f = cfg.fetch ?? fetch;
  const versao = cfg.versao ?? 'v23.0';
  const base = `https://graph.facebook.com/${versao}`;

  async function chamar<T>(
    caminho: string,
    opcoes: {
      token?: string;
      metodo?: 'GET' | 'POST' | 'DELETE';
      params?: Record<string, string>;
      corpo?: unknown;
    } = {},
  ): Promise<T> {
    const url = new URL(caminho.startsWith('http') ? caminho : `${base}${caminho}`);
    for (const [k, v] of Object.entries(opcoes.params ?? {})) url.searchParams.set(k, v);
    if (opcoes.token) url.searchParams.set('access_token', opcoes.token);
    const r = await f(url, {
      method: opcoes.metodo ?? 'GET',
      headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    const erro = (
      json as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } }
    )?.error;
    if (!r.ok || erro)
      throw new ErroMeta(
        erro?.error_user_msg || erro?.message || `A Meta respondeu ${r.status}`,
        r.status,
        erro?.code ?? null,
        erro?.error_subcode ?? null,
      );
    return json as T;
  }

  const paraConta = (x: {
    id: string;
    username?: string;
    name?: string;
    followers_count?: number;
    profile_picture_url?: string;
  }): ContaInstagramMeta => ({
    id: x.id,
    usuario: x.username ?? null,
    nome: x.name ?? null,
    seguidores: x.followers_count ?? null,
    foto: x.profile_picture_url ?? null,
  });

  return {
    tokenVerificacao: cfg.tokenVerificacao ?? null,

    urlDeLogin(redirect, estado) {
      const u = new URL(`https://www.facebook.com/${versao}/dialog/oauth`);
      u.searchParams.set('client_id', cfg.appId);
      u.searchParams.set('redirect_uri', redirect);
      u.searchParams.set('state', estado);
      u.searchParams.set('response_type', 'code');
      if (cfg.configId) u.searchParams.set('config_id', cfg.configId);
      else u.searchParams.set('scope', PERMISSOES_META.join(','));
      return u.toString();
    },

    async trocarCodigo(codigo, redirect) {
      const curto = await chamar<{ access_token: string }>('/oauth/access_token', {
        params: { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirect, code: codigo },
      });
      const longo = await chamar<{ access_token: string }>('/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          fb_exchange_token: curto.access_token,
        },
      });
      return longo.access_token;
    },

    async paginas(tokenPessoa) {
      const r = await chamar<{
        data: {
          id: string;
          name: string;
          access_token: string;
          instagram_business_account?: {
            id: string;
            username?: string;
            name?: string;
            followers_count?: number;
            profile_picture_url?: string;
          };
        }[];
      }>('/me/accounts', {
        token: tokenPessoa,
        params: {
          fields:
            'id,name,access_token,instagram_business_account{id,username,name,followers_count,profile_picture_url}',
          limit: '100',
        },
      });
      return r.data.map((p) => ({
        id: p.id,
        nome: p.name,
        token: p.access_token,
        instagram: p.instagram_business_account ? paraConta(p.instagram_business_account) : null,
      }));
    },

    async assinarPagina(paginaId, token) {
      await chamar(`/${paginaId}/subscribed_apps`, {
        token,
        metodo: 'POST',
        params: { subscribed_fields: CAMPOS_DA_PAGINA.join(',') },
      });
    },

    async desassinarPagina(paginaId, token) {
      await chamar(`/${paginaId}/subscribed_apps`, { token, metodo: 'DELETE' });
    },

    conferirAssinatura(corpo, assinatura) {
      if (!assinatura?.startsWith('sha256=')) return false;
      const esperado = createHmac('sha256', cfg.appSecret).update(corpo).digest();
      const recebido = Buffer.from(assinatura.slice(7), 'hex');
      return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
    },

    async contaInstagram(igId, token) {
      return paraConta(
        await chamar(`/${igId}`, {
          token,
          params: { fields: 'id,username,name,followers_count,profile_picture_url' },
        }),
      );
    },

    async publicacoes(igId, token, limite = 24) {
      const r = await chamar<{ data: Midia[] }>(`/${igId}/media`, {
        token,
        params: { fields: CAMPOS_MIDIA, limit: String(limite) },
      });
      return r.data.map(paraPublicacao);
    },

    async publicacao(midiaId, token) {
      try {
        return paraPublicacao(
          await chamar<Midia>(`/${midiaId}`, { token, params: { fields: CAMPOS_MIDIA } }),
        );
      } catch (erro) {
        if (erro instanceof ErroMeta && erro.status === 400 && !erro.tokenInvalido) return null;
        throw erro;
      }
    },

    async responderComentario(comentarioId, texto, token) {
      await chamar(`/${comentarioId}/replies`, { token, metodo: 'POST', params: { message: texto } });
    },

    async respostaPrivada(paginaId, comentarioId, m, token) {
      const enviar = (message: unknown) =>
        chamar<{ message_id?: string }>(`/${paginaId}/messages`, {
          token,
          metodo: 'POST',
          corpo: { recipient: { comment_id: comentarioId }, message },
        });
      if (m.botao) {
        try {
          const r = await enviar({
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: m.texto.slice(0, 640),
                buttons: [{ type: 'web_url', url: m.botao.link, title: m.botao.texto.slice(0, 20) }],
              },
            },
          });
          return r.message_id ?? null;
        } catch (erro) {
          // Botão recusado: manda o mesmo texto com o link no fim (o resto do erro sobe).
          if (!(erro instanceof ErroMeta) || erro.tokenInvalido || erro.mensagensBloqueadas) throw erro;
        }
      }
      const texto = m.botao ? `${m.texto}\n\n👉 ${m.botao.texto}: ${m.botao.link}` : m.texto;
      const r = await enviar({ text: texto.slice(0, 1000) });
      return r.message_id ?? null;
    },

    async enviarDirect(paginaId, pessoaId, texto, token) {
      const r = await chamar<{ message_id?: string }>(`/${paginaId}/messages`, {
        token,
        metodo: 'POST',
        corpo: { recipient: { id: pessoaId }, message: { text: texto.slice(0, 1000) } },
      });
      return r.message_id ?? null;
    },

    async perfil(pessoaId, token) {
      try {
        const r = await chamar<{ name?: string; username?: string }>(`/${pessoaId}`, {
          token,
          params: { fields: 'name,username' },
        });
        return { nome: r.name ?? null, usuario: r.username ?? null };
      } catch (erro) {
        if (erro instanceof ErroMeta && erro.tokenInvalido) throw erro;
        return null;
      }
    },

    async formularios(paginaId, token) {
      const r = await chamar<{ data: { id: string; name: string; status?: string }[] }>(
        `/${paginaId}/leadgen_forms`,
        { token, params: { fields: 'id,name,status', limit: '100' } },
      );
      return r.data.map((x) => ({ id: x.id, nome: x.name, status: x.status ?? null }));
    },

    async perguntas(formId, token) {
      const r = await chamar<{ name?: string; questions?: { key: string; label?: string; type?: string }[] }>(
        `/${formId}`,
        { token, params: { fields: 'name,questions{key,label,type}' } },
      );
      return {
        nome: r.name ?? 'Formulário',
        perguntas: (r.questions ?? []).map((q) => ({
          chave: q.key,
          rotulo: q.label ?? q.key,
          tipo: q.type ?? 'CUSTOM',
        })),
      };
    },

    async cadastro(leadgenId, token) {
      const r = await chamar<{
        id: string;
        created_time?: string;
        form_id?: string;
        ad_name?: string;
        campaign_name?: string;
        platform?: string;
        field_data?: { name: string; values?: string[] }[];
      }>(`/${leadgenId}`, {
        token,
        params: { fields: 'id,created_time,form_id,ad_name,campaign_name,platform,field_data' },
      });
      return {
        id: r.id,
        formId: r.form_id ?? null,
        anuncio: r.ad_name ?? null,
        campanha: r.campaign_name ?? null,
        plataforma: r.platform ?? null,
        em: r.created_time ?? null,
        respostas: (r.field_data ?? []).map((c) => ({ chave: c.name, valores: c.values ?? [] })),
      };
    },
  };
}

/** O cliente da Meta pelas variáveis do ambiente (null: integração não configurada). */
export function metaDoAmbiente(amb: {
  metaAppId?: string | null;
  metaAppSecret?: string | null;
  metaTokenVerificacao?: string | null;
  metaConfigId?: string | null;
  metaVersao?: string | null;
}): ClienteMeta | null {
  if (!amb.metaAppId || !amb.metaAppSecret) return null;
  return clienteMeta({
    appId: amb.metaAppId,
    appSecret: amb.metaAppSecret,
    tokenVerificacao: amb.metaTokenVerificacao ?? null,
    configId: amb.metaConfigId ?? null,
    versao: amb.metaVersao ?? undefined,
  });
}
