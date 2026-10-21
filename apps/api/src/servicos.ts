import {
  type CredenciaisAmbiente,
  type CredenciaisEfetivas,
  cacheDeCredenciais,
  type Executor,
  type Origem,
} from '@prospeccao/db';
import {
  type AnaliseRespostaEmail,
  type ContextoAgente,
  classificarRespostaEmail,
  type DecisaoAgente,
  decidirComIa,
  type EntradaAbertura,
  personalizarAbertura,
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
import { baixarMidia, enviarMidia, enviarTexto } from '@prospeccao/integrations/whatsapp';

/**
 * Serviços de fora de cada conta (WhatsApp, IA, e-mail, geocodificação), montados com as
 * credenciais dela. Os módulos pedem `deps.servicos(conta())` e usam o que vier; o que não estiver
 * configurado vem null e a tela explica o que falta.
 */

export interface WhatsappConta {
  enviar(telefone: string, texto: string): Promise<{ idExterno: string | null }>;
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
  ): Promise<{ idExterno: string | null }>;
  /** Arquivo de mensagem recebida, quando não vem junto no webhook. */
  baixarMidia?(idExterno: string): Promise<{ base64: string; mime: string | null } | null>;
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
  whatsapp: WhatsappConta | null;
  /** IA do agente do WhatsApp. Sem ela, a resposta do lead vai direto para a equipe. */
  ia: { decidir(contexto: ContextoAgente): Promise<DecisaoAgente> } | null;
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

/** Monta os serviços a partir das credenciais já resolvidas (também usado nos testes). */
export function servicosDe(c: CredenciaisEfetivas): ServicosConta {
  const evolution = c.evolution;
  const iaCfg: ConfigIa | null = c.ia ? configIa(c.ia) : null;
  const resend = c.resend;
  return {
    contaId: c.contaId,
    whatsapp: evolution
      ? {
          enviar: (tel, texto) => enviarTexto(evolution, tel, texto),
          enviarMidia: (tel, m) => enviarMidia(evolution, tel, m),
          baixarMidia: (id) => baixarMidia(evolution, id),
        }
      : null,
    ia: iaCfg ? { decidir: (ctx) => decidirComIa(iaCfg, ctx) } : null,
    classificarEmail: iaCfg ? (ctx) => classificarRespostaEmail(iaCfg, ctx) : null,
    personalizarAbertura: iaCfg ? (e) => personalizarAbertura(iaCfg, e) : null,
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
    servicos: (async (contaId: number) => servicosDe(await cache.obter(contaId))) as ResolverServicos,
    invalidar: (contaId?: number) => cache.invalidar(contaId),
  };
}
