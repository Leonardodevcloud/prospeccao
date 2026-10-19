/**
 * Erro de domínio com status HTTP. Serviços lançam AppError; a API traduz
 * para resposta JSON e os workers decidem se o job deve ser repetido.
 */
export class AppError extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalhes?: unknown;
  /** Para workers: false = não adianta tentar de novo (dado inválido, recurso inexistente). */
  readonly repetivel: boolean;

  constructor(
    status: number,
    codigo: string,
    mensagem: string,
    opcoes: { detalhes?: unknown; repetivel?: boolean; cause?: unknown } = {},
  ) {
    super(mensagem, { cause: opcoes.cause });
    this.name = 'AppError';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = opcoes.detalhes;
    this.repetivel = opcoes.repetivel ?? status >= 500;
  }

  static naoEncontrado(oQue: string) {
    return new AppError(404, 'nao_encontrado', `${oQue} não encontrado.`);
  }

  static invalido(mensagem: string, detalhes?: unknown) {
    return new AppError(422, 'dados_invalidos', mensagem, { detalhes });
  }

  static conflito(mensagem: string) {
    return new AppError(409, 'conflito', mensagem);
  }

  static naoAutorizado(mensagem = 'Faça login para continuar.') {
    return new AppError(401, 'nao_autorizado', mensagem);
  }

  static externo(servico: string, mensagem: string, cause?: unknown) {
    return new AppError(502, 'falha_externa', `${servico}: ${mensagem}`, { cause, repetivel: true });
  }
}

export function ehAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
