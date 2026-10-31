import type { CredenciaisAmbiente, Pool } from '@prospeccao/db';
import type { ServicoCobranca } from '@prospeccao/integrations/cobranca';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';
import type { DepsAssistente } from './modulos/assistente/rotas.js';
import type { ServicoDominios } from './modulos/email/dominio.js';
import type { ClienteMeta } from './modulos/instagram/meta.js';
import type { DepsTelefonia } from './modulos/ligacoes/servico.js';
import type { DominiosSite } from './modulos/marca/vercel.js';
import type { AoEncerrar, DepsReunioes } from './modulos/reunioes/servico.js';
import type { ResolverServicos } from './servicos.js';

export type {
  EmailConta,
  ResolverServicos,
  ServicosConta,
  WhatsappConta,
} from './servicos.js';

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
  /** WhatsApp, IA, e-mail e geocodificação de cada conta, com as credenciais dela. */
  servicos: ResolverServicos;
  /** Credenciais das contas (painel master): chave de cifra, o que o ambiente tem e o cache. */
  credenciais: {
    /** CHAVE_CREDENCIAIS (sem ela, não dá para guardar chaves de API das contas). */
    chave: string | null;
    ambiente: CredenciaisAmbiente;
    /** Esquece as credenciais lembradas (depois de salvar no painel). */
    invalidar(contaId?: number): void;
  };
  /** Domínios de e-mail no Resend da plataforma (padrão: pela RESEND_API_KEY; os testes simulam). */
  dominiosEmail?: ServicoDominios | null;
  /** Argos (o assistente): acesso só leitura aos dados, ouvir e falar. Sem isso, ele explica o que falta. */
  assistente?: DepsAssistente | null;
  /**
   * Reuniões por vídeo: LiveKit, armazenamento das gravações e transcrição (o que faltar fica
   * desligado e a tela explica). aoEncerrar chama o processamento logo que uma reunião gravada acaba.
   */
  reunioes?: (DepsReunioes & { aoEncerrar?: AoEncerrar }) | null;
  /** Domínio próprio dos clientes no Vercel (padrão: pelas variáveis VERCEL_*; os testes simulam). */
  dominiosSite?: DominiosSite | null;
  /** App da Meta: Instagram e cadastros dos anúncios (padrão: pelas variáveis META_*; os testes simulam). */
  meta?: ClienteMeta | null;
  /** Ligações: LiveKit com o tronco SIP, onde gravar, transcrição e a voz do aviso (o que faltar fica desligado). */
  telefonia?: DepsTelefonia | null;
  /** Assinatura pelo sistema: cobrança recorrente no Asaas (sem: a tela diz que falta ligar). */
  cobranca?: ServicoCobranca | null;
  /** Token que o Asaas manda no aviso de pagamento (cabeçalho asaas-access-token). */
  asaasTokenWebhook?: string | null;
  /** Captcha do cadastro do teste grátis (Cloudflare Turnstile). */
  captcha?: { site: string; segredo: string } | null;
}
