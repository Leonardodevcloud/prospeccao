import { AppError, ehAppError, type Logger } from '@prospeccao/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

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
      if (erro.status >= 500) log.error({ err: erro, rota: req.originalUrl }, erro.message);
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
    log.error({ err: erro, rota: req.originalUrl }, 'erro inesperado');
    res
      .status(500)
      .json({ erro: { codigo: 'erro_interno', mensagem: 'Algo deu errado do nosso lado. Tente de novo.' } });
  };
}

export const rotaNaoEncontrada: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'rota_inexistente', `Rota ${req.method} ${req.path} não existe.`));
};
