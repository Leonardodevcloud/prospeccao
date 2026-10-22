import {
  type CredenciaisAmbiente,
  type CredenciaisEfetivas,
  cacheDeCredenciais,
  type Executor,
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
import { baixarMidia, enviarMidia, enviarTexto, estadoConexao } from '@prospeccao/integrations/whatsapp';
import { LISTA_MODULOS, type Modulo } from '@prospeccao/shared';

/**
 * Serviços de fora de cada conta (WhatsApp, IA, e-mail, geocodificação), montados com as
 * credenciais dela. Os módulos pedem `deps.servicos(conta())` e usam o que vier; o que não estiver
 * configurado vem null e a tela explica o que falta.
 */

/**
 * WhatsApp da conta: a Evolution dela (endereço e chave) e as instâncias (chips). Sem `instancia`,
 * usa a das credenciais.
 */
export interface WhatsappConta {
  /** Instância das credenciais (o chip de quando não há chips cadastrados). */
  instancia: string;
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
  /** Arquivo de mensagem recebida, quando não vem junto no webhook. */
  baixarMidia?(
    idExterno: string,
    instancia?: string,
  ): Promise<{ base64: string; mime: string | null } | null>;
  /** "ok (WhatsApp conectado)" ou o que está errado com o chip. */
  estado?(instancia?: string): Promise<string>;
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
  origem: Record<'places' | 'ors' | 'resend' | 'evolution' | 'ia', Origem>;
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
export function servicosDe(c: CredenciaisEfetivas, db?: Executor): ServicosConta {
  const evolution = c.evolution;
  // Mesma Evolution, outra instância (chip).
  const chip = (instancia?: string) => ({ ...evolution!, instancia: instancia || evolution!.instancia });
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
      evolution && temWhatsapp
        ? {
            instancia: evolution.instancia,
            enviar: (tel, texto, inst, op) => enviarTexto(chip(inst), tel, texto, op),
            enviarMidia: (tel, m, inst) => enviarMidia(chip(inst), tel, m),
            baixarMidia: (id, inst) => baixarMidia(chip(inst), id),
            estado: (inst) => estadoConexao(chip(inst)),
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
    servicos: (async (contaId: number) => servicosDe(await cache.obter(contaId), db)) as ResolverServicos,
    invalidar: (contaId?: number) => cache.invalidar(contaId),
  };
}
