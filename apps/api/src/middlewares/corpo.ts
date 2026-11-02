import express, { type RequestHandler } from 'express';

/*
 * Corpos grandes (anexo da conversa e do e-mail, imagem da marca, lista de leads para importar)
 * só são lidos depois de quem chama ter sido conferido. O resto fica no limite de 200 kb.
 */
export const jsonGrande = express.json({ limit: '15mb' });
const jsonPlanilha = express.json({ limit: '21mb' });
const ROTAS_GRANDES =
  /^\/marca$|^\/marca\/fundos\/fotos$|^\/meus-fundos$|^\/organizacao\/marca$|^\/conversas\/\d+\/midia$|^\/email\/(anexos|imagens)$|^\/agente\/conhecimento\/arquivo$|^\/agente\/ia\/sugestoes$|^\/salas\/[a-z0-9-]+\/arquivos$/;
export const corpoGrande = (caminho: string) =>
  caminho === '/importacoes-leads/analisar' || ROTAS_GRANDES.test(caminho);
/** Lê o corpo grande (só depois de quem chama ter sido conferido). */
export const lerCorpoGrande: RequestHandler = (req, res, next) =>
  req.path === '/importacoes-leads/analisar'
    ? jsonPlanilha(req, res, next)
    : ROTAS_GRANDES.test(req.path)
      ? jsonGrande(req, res, next)
      : next();
