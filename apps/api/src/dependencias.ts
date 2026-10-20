import type { Pool } from '@prospeccao/db';
import type { AnaliseRespostaEmail, ContextoAgente, DecisaoAgente } from '@prospeccao/integrations/agente';
import type { EmailParaEnviar, EmailRecebido } from '@prospeccao/integrations/email';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

export interface DepsApi {
  pool: Pool;
  filas: Pick<Filas, 'publicar' | 'publicarVarios' | 'cancelarPendentes' | 'tamanhos'>;
  log: Logger;
  auth: {
    jwtSegredo: string;
    adminEmail: string;
    adminSenhaHash: string;
    sessaoHoras: number;
    cookieSeguro: boolean;
  };
  origens: string[];
  /** Geocodificação de endereço de base; ausente quando não há chave do ORS. */
  geocodificar?: (endereco: string) => Promise<{ lat: number; lng: number } | null>;
  /** Envio pelo WhatsApp (Evolution). Sem ele, o agente prepara mas não envia. */
  whatsapp?: {
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
  } | null;
  /** E-mail da empresa: envia por SMTP e (com IMAP) lê as respostas. */
  email?: {
    /** Endereço que aparece como remetente. */
    remetente: string;
    enviar(e: EmailParaEnviar): Promise<{ messageId: string }>;
    verificar?(): Promise<void>;
    lerNovos?(desdeUid: number | null): Promise<{ itens: EmailRecebido[]; ultimoUid: number }>;
  } | null;
  /** IA que lê a resposta do e-mail (tem interesse?). Sem ela, uma regra de palavras decide. */
  classificarEmail?:
    | ((c: { sobreEmpresa: string; assunto: string; texto: string }) => Promise<AnaliseRespostaEmail | null>)
    | null;
  /** IA do agente (Gemini). Sem ela, resposta do lead vai direto para você. */
  ia?: { decidir(contexto: ContextoAgente): Promise<DecisaoAgente> } | null;
}
