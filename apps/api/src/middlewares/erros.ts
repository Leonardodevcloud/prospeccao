import { AppError, ehAppError, type Logger } from '@prospeccao/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { caminhoParaLog } from './logs.js';

/** Toda resposta de erro tem o mesmo formato: { erro: { codigo, mensagem, detalhes? } }. */
export function tratarErros(log: Logger): ErrorRequestHandler {
  return (erro, req, res, _next) => {
    if (erro instanceof ZodError) {
      res.status(422).json({
        erro: {
          codigo: 'dados_invalidos',
          mensagem: erro.issues[0]?.message ?? 'Dados inválidos.',
          detalhes: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
        },
      });
      return;
    }
    if (ehAppError(erro)) {
      if (erro.status >= 500) log.error({ err: erro, rota: caminhoParaLog(req.originalUrl) }, erro.message);
      res
        .status(erro.status)
        .json({ erro: { codigo: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes } });
      return;
    }
    // JSON malformado no corpo
    if ((erro as { type?: string }).type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ erro: { codigo: 'json_invalido', mensagem: 'O corpo da requisição não é um JSON válido.' } });
      return;
    }
    // Corpo grande demais (acima do limite da rota) ou num formato que a rota não lê.
    const doCorpo = erro as { type?: string; status?: number };
    if (doCorpo.type === 'entity.too.large') {
      res.status(413).json({
        erro: { codigo: 'grande_demais', mensagem: 'O arquivo ou o conteúdo enviado é grande demais.' },
      });
      return;
    }
    if (typeof doCorpo.status === 'number' && doCorpo.status >= 400 && doCorpo.status < 500) {
      res
        .status(doCorpo.status)
        .json({ erro: { codigo: 'requisicao_invalida', mensagem: 'Não consegui ler o que foi enviado.' } });
      return;
    }
    log.error({ err: erro, rota: caminhoParaLog(req.originalUrl) }, 'erro inesperado');
    res
      .status(500)
      .json({ erro: { codigo: 'erro_interno', mensagem: 'Algo deu errado do nosso lado. Tente de novo.' } });
  };
}

export const rotaNaoEncontrada: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'rota_inexistente', `Rota ${req.method} ${req.path} não existe.`));
};
