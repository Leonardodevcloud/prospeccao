import type { Executor } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import type { Request, RequestHandler } from 'express';
import { registrar } from './repositorio.js';

/**
 * Registra toda alteração feita pela tela (POST, PUT, PATCH, DELETE que deram certo): quem, em qual
 * conta, o quê e em qual lead. Leituras e ações que não mudam nada (prévia, estimativa, marcar como
 * lido) ficam de fora. Corre depois da resposta: nunca atrasa nem derruba a requisição.
 */

type Corpo = Record<string, unknown>;
type Descrever = (b: Corpo, p: Record<string, string>) => string;
interface Regra {
  acao: string;
  texto: string | Descrever;
}

const ETAPAS: Record<string, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};
const txt = (v: unknown, max = 80) => (typeof v === 'string' ? `“${v.slice(0, max)}”` : '');
const qtd = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/** null = não registra. */
const REGRAS: Record<string, Regra | null> = {
  'POST /funil/leads': {
    acao: 'funil',
    texto: (b) =>
      `Cadastrou o lead ${txt(b.empresa)}${b.telefoneConversa ? ' a partir de uma conversa do WhatsApp' : ''}`,
  },
  'PUT /conversas/conversa-nova': {
    acao: 'configuração',
    texto: (b) =>
      b.modo === 'criar_lead'
        ? 'Conversa nova no WhatsApp passa a virar lead no funil'
        : 'Conversa nova no WhatsApp passa a esperar em Não identificados',
  },
  'POST /funil': {
    acao: 'funil',
    texto: (b) =>
      b.etapa === 'descartado'
        ? `Descartou ${qtd(b.empresaIds)} lead(s)${b.motivo ? `: ${txt(b.motivo)}` : ''}`
        : `Mandou ${qtd(b.empresaIds)} lead(s) para o funil`,
  },
  'PATCH /funil/:empresaId': {
    acao: 'funil',
    texto: (b) => {
      const partes: string[] = [];
      if (b.etapa) partes.push(`mudou a etapa para ${ETAPAS[String(b.etapa)] ?? b.etapa}`);
      if (b.etapaId) partes.push('mudou a etapa');
      if (b.responsavelId !== undefined) partes.push('trocou o responsável');
      if (b.valorMensal !== undefined) partes.push('alterou o valor');
      if (b.agente !== undefined) partes.push(b.agente ? 'ligou a IA' : 'desligou a IA');
      if (b.proximaAcao !== undefined || b.proximaAcaoEm !== undefined) partes.push('mudou o próximo passo');
      if (b.etiquetas !== undefined) partes.push('mudou as etiquetas');
      const t = partes.join(', ') || 'editou o lead no funil';
      return t[0]!.toUpperCase() + t.slice(1);
    },
  },
  'POST /funil/:empresaId/atividades': {
    acao: 'funil',
    texto: (b) => (b.tipo === 'nota' ? 'Escreveu uma nota' : `Registrou ${String(b.tipo ?? 'contato')}`),
  },
  'DELETE /funil/:empresaId': { acao: 'funil', texto: 'Tirou o lead do funil' },
  'POST /funil/pipelines': { acao: 'configuração', texto: (b) => `Criou o pipeline ${txt(b.nome)}` },
  'PATCH /funil/pipelines/:id': { acao: 'configuração', texto: 'Editou um pipeline' },
  'DELETE /funil/pipelines/:id': { acao: 'configuração', texto: 'Apagou um pipeline' },
  'POST /funil/pipelines/:id/etapas': { acao: 'configuração', texto: (b) => `Criou a etapa ${txt(b.nome)}` },
  'PATCH /funil/etapas/:id': { acao: 'configuração', texto: 'Editou uma etapa do pipeline' },
  'DELETE /funil/etapas/:id': { acao: 'configuração', texto: 'Apagou uma etapa do pipeline' },
  'PUT /funil/cadencia': { acao: 'configuração', texto: 'Mudou a cadência de follow-up' },

  'POST /campanhas': { acao: 'campanha', texto: (b) => `Criou a campanha ${txt(b.nome)}` },
  'PATCH /campanhas/:id': { acao: 'campanha', texto: 'Editou uma campanha' },
  'PUT /campanhas/:id/teto-places': { acao: 'campanha', texto: 'Mudou o teto de gasto do Google Places' },
  'POST /campanhas/:id/iniciar': { acao: 'campanha', texto: 'Iniciou uma campanha' },
  'POST /campanhas/:id/pausar': { acao: 'campanha', texto: 'Pausou uma campanha' },
  'POST /campanhas/:id/parar-enriquecimento': { acao: 'campanha', texto: 'Parou o enriquecimento' },
  'POST /campanhas/:id/reenriquecer': { acao: 'campanha', texto: 'Mandou reenriquecer os leads' },
  'POST /campanhas/:id/encerrar': { acao: 'campanha', texto: 'Encerrou uma campanha' },
  'DELETE /campanhas/:id': { acao: 'campanha', texto: 'Apagou uma campanha' },
  'POST /nichos': { acao: 'configuração', texto: (b) => `Criou o nicho ${txt(b.nome)}` },
  'PATCH /nichos/:id': { acao: 'configuração', texto: 'Editou um nicho' },
  'DELETE /nichos/:id': { acao: 'configuração', texto: 'Apagou um nicho' },
  'POST /bases': { acao: 'configuração', texto: (b) => `Criou a base ${txt(b.nome)}` },
  'PATCH /bases/:id': { acao: 'configuração', texto: 'Editou uma base' },
  'DELETE /bases/:id': { acao: 'configuração', texto: 'Apagou uma base' },
  'PUT /places/config': { acao: 'configuração', texto: 'Mudou a configuração do Google Places' },
  'POST /importacoes/planilha-maps': { acao: 'importação', texto: 'Importou uma planilha do Maps' },
  'POST /importacoes/cnpj': { acao: 'importação', texto: 'Pediu a importação da base CNPJ' },
  'POST /importacoes-leads/analisar': {
    acao: 'importação',
    texto: (b) => `Enviou a lista de leads ${txt(b.nome)}`,
  },
  'POST /importacoes-leads/:id/importar': {
    acao: 'importação',
    texto: (b) =>
      `Importou uma lista de leads${b.enriquecer ? ', com enriquecimento' : ''}${b.funil ? ', direto para o funil' : ''}`,
  },

  'POST /empresas/:id/enriquecer': { acao: 'lead', texto: 'Mandou enriquecer o lead' },
  'POST /empresas/:id/feedback': { acao: 'lead', texto: (b) => `Marcou um contato: ${String(b.tipo ?? '')}` },
  'DELETE /empresas/:id/feedback': { acao: 'lead', texto: 'Desfez a marcação de um contato' },

  'POST /conversas/:empresaId/mensagens': { acao: 'conversa', texto: 'Mandou mensagem no WhatsApp' },
  'POST /conversas/:empresaId/midia': { acao: 'conversa', texto: 'Mandou arquivo no WhatsApp' },
  'POST /conversas/:empresaId/email': { acao: 'conversa', texto: 'Mandou e-mail pela conversa' },
  'POST /conversas/:empresaId/contatos': {
    acao: 'conversa',
    texto: (b) =>
      `Adicionou o contato ${txt(b.nome)}${b.indicadoPorId || b.indicadoPorTexto ? ' (indicação)' : ''}`,
  },
  'PATCH /conversas/:empresaId/contatos/:id': {
    acao: 'conversa',
    texto: (b) =>
      b.confirmar
        ? `Confirmou o contato sugerido ${txt(b.nome)}`
        : b.decisor
          ? 'Marcou o contato como decisor'
          : 'Editou um contato da negociação',
  },
  'DELETE /conversas/:empresaId/contatos/:id': {
    acao: 'conversa',
    texto: 'Removeu um contato da negociação',
  },
  'PUT /conversas/:empresaId/destino': { acao: 'conversa', texto: 'Mudou com quem a conversa segue' },
  'POST /conversas/nao-identificados/:telefone/vincular': {
    acao: 'conversa',
    texto: (b, p) => `Vinculou o número ${p.telefone} ao lead como ${txt(b.nome)}`,
  },
  'POST /conversas/nao-identificados/:telefone/descartar': {
    acao: 'conversa',
    texto: (_b, p) => `Descartou as mensagens do número ${p.telefone}`,
  },
  'POST /conversas/respostas': { acao: 'configuração', texto: 'Criou uma resposta rápida' },
  'PUT /conversas/respostas/:id': { acao: 'configuração', texto: 'Editou uma resposta rápida' },
  'DELETE /conversas/respostas/:id': { acao: 'configuração', texto: 'Apagou uma resposta rápida' },

  'PUT /agente/config': {
    acao: 'configuração',
    texto: (b) => `Mudou o agente (${b.ligado ? 'ligado' : 'desligado'})`,
  },
  'POST /agente/rascunhos/:id/aprovar': { acao: 'agente', texto: 'Aprovou uma mensagem da IA' },
  'POST /agente/rascunhos/:id/descartar': { acao: 'agente', texto: 'Descartou uma mensagem da IA' },
  'POST /agente/ligar-em-massa': { acao: 'agente', texto: 'Ligou a IA em vários leads' },
  'POST /agente/chips': { acao: 'configuração', texto: (b) => `Criou o número de WhatsApp ${txt(b.nome)}` },
  'PATCH /agente/chips/:id': { acao: 'configuração', texto: 'Editou um número de WhatsApp' },
  'POST /agente/chips/:id/desconectar': { acao: 'configuração', texto: 'Desconectou um número de WhatsApp' },
  'DELETE /agente/chips/:id': { acao: 'configuração', texto: 'Removeu um número de WhatsApp' },

  'POST /agenda': { acao: 'agenda', texto: (b) => `Criou ${String(b.tipo ?? 'tarefa')} ${txt(b.titulo)}` },
  'PATCH /agenda/:id': {
    acao: 'agenda',
    texto: (b) => (b.concluida ? 'Concluiu uma tarefa' : 'Editou uma tarefa'),
  },
  'DELETE /agenda/:id': { acao: 'agenda', texto: 'Apagou uma tarefa' },
  'PUT /agenda/config': { acao: 'configuração', texto: 'Mudou a configuração da agenda' },

  'PUT /email/config': {
    acao: 'configuração',
    texto: (b) => `Mudou o envio de e-mail (${b.ligado ? 'ligado' : 'desligado'})`,
  },
  'POST /email/marcas': { acao: 'e-mail', texto: (b) => `Criou a identidade visual ${txt(b.nome)}` },
  'PUT /email/marcas/:id': { acao: 'e-mail', texto: 'Editou uma identidade visual' },
  'DELETE /email/marcas/:id': { acao: 'e-mail', texto: 'Apagou uma identidade visual' },
  'POST /email/modelos': { acao: 'e-mail', texto: (b) => `Criou o modelo ${txt(b.nome)}` },
  'PUT /email/modelos/:id': { acao: 'e-mail', texto: 'Editou um modelo de e-mail' },
  'DELETE /email/modelos/:id': { acao: 'e-mail', texto: 'Apagou um modelo de e-mail' },
  'POST /email/teste': {
    acao: 'e-mail',
    texto: (b) => `Mandou um e-mail de teste para ${String(b.para ?? '')}`,
  },
  'POST /email/campanhas': { acao: 'e-mail', texto: (b) => `Criou a sequência ${txt(b.nome)}` },
  'PATCH /email/campanhas/:id': { acao: 'e-mail', texto: 'Editou uma sequência' },
  'POST /email/campanhas/:id/teste': {
    acao: 'e-mail',
    texto: (b) => `Mandou um teste da sequência para ${String(b.para ?? '')}`,
  },
  'POST /email/campanhas/:id/iniciar': { acao: 'e-mail', texto: 'Começou a enviar uma sequência' },
  'POST /email/campanhas/:id/pausar': { acao: 'e-mail', texto: 'Pausou uma sequência' },
  'DELETE /email/campanhas/:id': { acao: 'e-mail', texto: 'Apagou uma sequência' },
  'POST /email/respostas/:id/classe': {
    acao: 'e-mail',
    texto: (b) => `Corrigiu a leitura de uma resposta (${String(b.classe ?? '')})`,
  },
  'POST /email/respostas/:id/responder': { acao: 'e-mail', texto: 'Respondeu um e-mail' },

  'POST /equipe': { acao: 'equipe', texto: (b) => `Convidou ${txt(b.nome)} (${String(b.papel ?? '')})` },
  'PATCH /equipe/:id': {
    acao: 'equipe',
    texto: (b) =>
      b.ativo === false
        ? 'Desativou uma pessoa'
        : b.papel
          ? `Mudou o papel para ${String(b.papel)}`
          : 'Editou uma pessoa',
  },
  'POST /equipe/:id/convite': { acao: 'equipe', texto: 'Gerou um link de acesso novo' },
  'PUT /equipe/distribuicao': { acao: 'configuração', texto: 'Mudou o rodízio de leads' },
  'POST /equipe/distribuir': { acao: 'equipe', texto: 'Distribuiu os leads sem dono' },
  'PUT /equipe/:id/metas': { acao: 'equipe', texto: 'Mudou as metas' },

  'POST /master/contas': { acao: 'master', texto: (b) => `Criou a conta ${txt(b.nome)}` },
  'PATCH /master/contas/:id': {
    acao: 'master',
    texto: (b) =>
      b.ativa === false ? 'Desativou a conta' : b.ativa === true ? 'Reativou a conta' : 'Editou a conta',
  },
  'PUT /master/contas/:id/credenciais': {
    acao: 'master',
    texto: (b) => {
      const s = Object.keys((b.segredos as Corpo | undefined) ?? {});
      return `Alterou as credenciais${s.length ? ` (${s.join(', ')})` : ''}`;
    },
  },
  'PUT /master/contas/:id/limites': { acao: 'master', texto: 'Mudou os tetos de consumo' },
  'POST /master/contas/:id/usuarios': {
    acao: 'master',
    texto: (b) => `Convidou ${txt(b.nome)} para a conta`,
  },
  'POST /master/usuarios/:id/convite': { acao: 'master', texto: 'Gerou um link de acesso novo' },
  'POST /master/contas/:id/entrar': { acao: 'master', texto: 'Entrou na conta (suporte)' },

  // Não mudam nada (ou são só leitura com corpo).
  'POST /email/previa': null,
  'POST /email/campanhas/estimar': null,
  'POST /email/campanhas/:id/previa': null,
  'POST /email/verificar': null,
  'POST /email/imagens': null,
  'POST /email/anexos': null,
  'POST /email/respostas/:id/lida': null,
  'POST /notificacoes/lidas': null,
  'POST /notificacoes/:id/lida': null,
  'POST /notificacoes/push': null,
  'DELETE /notificacoes/push': null,
  'POST /master/contas/:id/testar': null,
  'POST /master/sair': null,
  'POST /notificacoes/push/teste': null,
  'POST /alertas/conferir': null,
  'POST /agente/chips/:id/testar': null,
  'POST /importacoes-leads/:id/previa': null,
  'DELETE /importacoes-leads/:id': null,
  'POST /email/campanhas/estimar/': null,
};

/** Campos que nunca vão para o registro (segredos, senhas, arquivos). */
const PROIBIDO = /senha|segredo|secret|key|token|base64|auth|p256dh|endpoint/i;

export function limparCorpo(v: unknown, nivel = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (nivel > 2) return '…';
  if (Array.isArray(v))
    return v.length > 20
      ? [...v.slice(0, 20).map((x) => limparCorpo(x, nivel + 1)), '…']
      : v.map((x) => limparCorpo(x, nivel + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Corpo))
      out[k] = PROIBIDO.test(k) ? (x ? '(oculto)' : x) : limparCorpo(x, nivel + 1);
    return out;
  }
  return null;
}

const ip = (req: Request) => (req.ip ?? '').replace(/^::ffff:/, '') || null;

export function padraoDaRota(req: Request): string {
  const caminho = `${req.baseUrl}${(req.route?.path as string | undefined) ?? ''}`.replace(/\/+$/, '') || '/';
  return `${req.method} ${caminho}`;
}

export function auditar(db: Executor, log: Logger): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.usuario) return;
      const chave = padraoDaRota(req);
      const regra = REGRAS[chave];
      if (regra === null) return;
      const corpo = (req.body ?? {}) as Corpo;
      const params = (req.params ?? {}) as Record<string, string>;
      const u = req.usuario;
      const master = chave.includes(' /master/');
      // No painel master a ação é sobre a conta da rota (ou da plataforma, sem conta).
      const contaId = master
        ? chave.includes('/master/contas/:id')
          ? Number(params.id) || null
          : null
        : u.contaId;
      const empresaId = Number(params.empresaId) || null;
      let descricao: string;
      try {
        descricao = regra
          ? typeof regra.texto === 'string'
            ? regra.texto
            : regra.texto(corpo, params)
          : chave;
      } catch {
        descricao = chave;
      }
      registrar(db, {
        contaId,
        usuarioId: u.id,
        usuarioNome: u.nome,
        comoMaster: master || u.contaId !== u.contaPropria,
        acao: regra?.acao ?? 'outro',
        descricao,
        metodo: req.method,
        caminho: chave.split(' ')[1] ?? null,
        empresaId,
        detalhes: { params, corpo: limparCorpo(corpo) } as Record<string, unknown>,
        ip: ip(req),
      }).catch((erro) => log.warn({ err: erro, rota: chave }, 'auditoria: não consegui registrar'));
    });
    next();
  };
}

/** Para eventos fora das rotas logadas (login, senha esquecida). */
export function ipDe(req: Request): string | null {
  return ip(req);
}
