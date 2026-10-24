import {
  type CredenciaisAmbiente,
  type CredenciaisEfetivas,
  cacheDeCredenciais,
  type Executor,
  lerChipWhatsapp,
  medidorDeIa,
  type Origem,
} from '@prospeccao/db';
import {
  type AnaliseRespostaEmail,
  type Aprendizado,
  type ContextoAgente,
  classificarRespostaEmail,
  type DecisaoAgente,
  decidirComIa,
  type EntradaAbertura,
  type EntradaResumo,
  extrairAprendizado,
  personalizarAbertura,
  type ResumoPassagem,
  resumirPassagem,
} from '@prospeccao/integrations/agente';
import {
  buscarRecebido,
  type EmailParaEnviar,
  type EmailRecebido,
  enviarEmail,
  verificarResend,
} from '@prospeccao/integrations/email';
import { type ConfigIa, configIa } from '@prospeccao/integrations/ia';
import * as ors from '@prospeccao/integrations/ors';
import {
  assinarInstancia,
  baixarMidia,
  type ConfigWhatsapp,
  cancelarInstancia,
  configurarWebhook,
  criarInstancia,
  desconectar,
  enviarMidia,
  enviarTexto,
  estadoConexao,
  qrCode,
  type StatusWhatsapp,
  statusInstancia,
} from '@prospeccao/integrations/whatsapp';
import { AppError, LISTA_MODULOS, type Modulo } from '@prospeccao/shared';

/**
 * Serviços de fora de cada conta (WhatsApp, IA, e-mail, geocodificação), montados com as
 * credenciais dela. Os módulos pedem `deps.servicos(conta())` e usam o que vier; o que não estiver
 * configurado vem null e a tela explica o que falta.
 */

/**
 * WhatsApp da conta pela Z-API da plataforma. Cada chip é uma instância (ID e token guardados no
 * chip); sem `instancia`, usa o primeiro chip ativo da conta.
 */
export interface WhatsappConta {
  enviar(
    telefone: string,
    texto: string,
    instancia?: string,
    opcoes?: { digitandoMs?: number },
  ): Promise<{ idExterno: string | null }>;
  /** Foto, vídeo, documento ou áudio (base64). */
  enviarMidia?(
    telefone: string,
    m: {
      tipo: 'imagem' | 'audio' | 'video' | 'documento';
      mime: string;
      base64: string;
      nome?: string;
      legenda?: string;
    },
    instancia?: string,
  ): Promise<{ idExterno: string | null }>;
  /** Arquivo de mensagem recebida (a Z-API manda o link no webhook). */
  baixarMidia?(url: string): Promise<{ base64: string; mime: string | null } | null>;
  /** "ok (WhatsApp conectado)" ou o que está errado com o chip. */
  estado?(instancia?: string): Promise<string>;
  /** Conexão do número, para a tela de conectar. */
  status?(instancia: string): Promise<StatusWhatsapp>;
  /** Cria a instância de um número novo na Z-API (teste de 2 dias) e aponta o webhook para o sistema. */
  criar?(nome: string, webhook: string): Promise<{ instancia: string; token: string }>;
  /** QR Code para o cliente ler no celular. */
  qr?(instancia: string): Promise<{ conectado: boolean; imagem: string | null }>;
  desconectar?(instancia: string): Promise<void>;
  /** Assina a instância (passa a cobrar no mês). */
  assinar?(instancia: string): Promise<void>;
  /** Cancela a instância na Z-API (para de cobrar). */
  cancelar?(instancia: string): Promise<void>;
}

export interface EmailConta {
  /** Endereço que aparece como remetente (domínio verificado no Resend da conta). */
  remetente: string;
  /** Domínio de recebimento do Resend: a resposta do lead vai para r-<token>@este domínio. */
  dominioRespostas: string | null;
  /** Segredo do webhook (whsec_…): só aceita avisos assinados pelo Resend da conta. */
  segredoWebhook: string | null;
  enviar(e: EmailParaEnviar): Promise<{ id: string }>;
  verificar?(): Promise<string>;
  buscarRecebido?(id: string): Promise<EmailRecebido>;
}

export interface ServicosConta {
  contaId: number;
  /** Módulos contratados que valem agora (conta sem plano: todos). */
  modulos?: Modulo[];
  whatsapp: WhatsappConta | null;
  /** IA do agente do WhatsApp. Sem ela, a resposta do lead vai direto para a equipe. */
  ia: {
    decidir(contexto: ContextoAgente): Promise<DecisaoAgente>;
    /** Resumo para o vendedor quando a IA passa o lead para o time. */
    resumir?(e: EntradaResumo): Promise<ResumoPassagem | null>;
    /** A resposta do time a uma pergunta que a IA não sabia, escrita para a base. */
    aprender?(e: { empresa: string; pergunta: string; respostaDoTime: string }): Promise<Aprendizado | null>;
  } | null;
  /** IA que lê a resposta do e-mail (tem interesse?). Sem ela, uma regra de palavras decide. */
  classificarEmail:
    | ((c: { sobreEmpresa: string; assunto: string; texto: string }) => Promise<AnaliseRespostaEmail | null>)
    | null;
  /** IA que escreve a abertura de cada e-mail para o lead. */
  personalizarAbertura: ((e: EntradaAbertura) => Promise<string | null>) | null;
  email: EmailConta | null;
  /** Endereço → coordenadas (bases de operação). */
  geocodificar: ((endereco: string) => Promise<{ lat: number; lng: number } | null>) | null;
  /** De onde veio cada credencial (da conta ou da plataforma), para a tela. */
  origem: Record<'places' | 'ors' | 'resend' | 'whatsapp' | 'ia', Origem>;
  /** Descrição da IA em uso ("DeepSeek · deepseek-flash"). */
  iaDescricao: string | null;
  erro: string | null;
}

export type ResolverServicos = (contaId: number) => Promise<ServicosConta>;

const ROTULO_IA: Record<string, string> = { deepseek: 'DeepSeek', gemini: 'Gemini', openai: 'OpenAI' };

/**
 * Monta os serviços a partir das credenciais já resolvidas (também usado nos testes). Com o banco,
 * cada chamada à IA é medida (e bloqueada no teto do mês, se for pela chave da plataforma).
 */
export function servicosDe(c: CredenciaisEfetivas, db?: Executor, chave?: string | null): ServicosConta {
  const zapi = c.whatsapp;
  // Instância e token do chip (o pedido ou o primeiro ativo da conta).
  const chip = async (instancia?: string): Promise<ConfigWhatsapp> => {
    const ch = db ? await lerChipWhatsapp(db, c.contaId, chave, instancia) : null;
    if (!ch)
      throw AppError.invalido(
        'Nenhum número de WhatsApp conectado nesta conta. Conecte em Agente → Números de WhatsApp.',
      );
    return { ...ch, clientToken: zapi?.clientToken ?? null };
  };
  const parceiro = zapi ? { token: zapi.parceiroToken } : null;
  const medidor = db && c.origem.ia ? medidorDeIa(db, c.contaId, c.origem.ia) : null;
  const iaCfg: ConfigIa | null = c.ia ? configIa(c.ia, medidor) : null;
  // Módulo não contratado: o serviço fica desligado para a conta (a tela diz que não está no plano).
  const modulos = c.modulos ? LISTA_MODULOS.filter((m) => c.modulos!.includes(m)) : [...LISTA_MODULOS];
  const temWhatsapp = modulos.includes('whatsapp');
  const temAgente = modulos.includes('agente_ia') && temWhatsapp;
  const temEmail = modulos.includes('email');
  const resend = temEmail ? c.resend : null;
  return {
    contaId: c.contaId,
    modulos,
    whatsapp:
      zapi && parceiro && temWhatsapp
        ? {
            enviar: async (tel, texto, inst, op) => enviarTexto(await chip(inst), tel, texto, op),
            enviarMidia: async (tel, m, inst) => enviarMidia(await chip(inst), tel, m),
            baixarMidia: (url) => baixarMidia(url),
            estado: async (inst) => estadoConexao(await chip(inst)),
            status: async (inst) => statusInstancia(await chip(inst)),
            criar: async (nome, webhook) => {
              const nova = await criarInstancia(parceiro, nome);
              await configurarWebhook({ ...nova, clientToken: zapi.clientToken }, webhook);
              return { instancia: nova.instancia, token: nova.token };
            },
            qr: async (inst) => qrCode(await chip(inst)),
            desconectar: async (inst) => desconectar(await chip(inst)),
            assinar: async (inst) => assinarInstancia(parceiro, await chip(inst)),
            cancelar: async (inst) => cancelarInstancia(parceiro, await chip(inst)),
          }
        : null,
    ia:
      iaCfg && temAgente
        ? {
            decidir: (ctx) => decidirComIa(iaCfg, ctx),
            resumir: (e) => resumirPassagem(iaCfg, e),
            aprender: (e) => extrairAprendizado(iaCfg, e),
          }
        : null,
    classificarEmail: iaCfg && temEmail ? (ctx) => classificarRespostaEmail(iaCfg, ctx) : null,
    personalizarAbertura: iaCfg && temEmail ? (e) => personalizarAbertura(iaCfg, e) : null,
    email: resend
      ? {
          remetente: resend.remetente,
          dominioRespostas: resend.dominioRespostas,
          segredoWebhook: resend.webhookSegredo,
          enviar: (e) => enviarEmail({ apiKey: resend.apiKey }, e),
          verificar: () => verificarResend({ apiKey: resend.apiKey }, resend.remetente),
          buscarRecebido: (id) => buscarRecebido({ apiKey: resend.apiKey }, id),
        }
      : null,
    geocodificar: c.ors
      ? async (endereco) => {
          const r = await ors.geocodificar({ apiKey: c.ors!.apiKey }, endereco);
          return r && r.confianca >= 0.6 ? { lat: r.lat, lng: r.lng } : null;
        }
      : null,
    origem: c.origem,
    iaDescricao: iaCfg ? `${ROTULO_IA[iaCfg.provedor] ?? iaCfg.provedor} · ${iaCfg.modelo}` : null,
    erro: c.erro,
  };
}

/** Serviços por conta, com as credenciais lembradas por um minuto (a tela do master limpa ao salvar). */
export function criarServicos(db: Executor, chave: string | null, ambiente: CredenciaisAmbiente) {
  const cache = cacheDeCredenciais(db, chave, ambiente);
  return {
    servicos: (async (contaId: number) =>
      servicosDe(await cache.obter(contaId), db, chave)) as ResolverServicos,
    invalidar: (contaId?: number) => cache.invalidar(contaId),
  };
}
