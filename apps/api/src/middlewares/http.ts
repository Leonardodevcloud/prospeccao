import { AppError } from '@prospeccao/shared';
import type { Request } from 'express';
import type { z } from 'zod';

/** Lê e valida o corpo; lança ZodError (vira 422 no tratador de erros). */
export function corpo<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return schema.parse(req.body ?? {});
}

export function consulta<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return schema.parse(req.query);
}

/** :id numérico da rota. */
export function idDaRota(req: Request, nome = 'id'): number {
  const valor = Number(req.params[nome]);
  if (!Number.isInteger(valor) || valor <= 0)
    throw new AppError(400, 'id_invalido', `"${req.params[nome]}" não é um id válido.`);
  return valor;
}
