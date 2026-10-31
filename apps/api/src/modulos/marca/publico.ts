import type { Request } from 'express';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import * as repo from './repositorio.js';

/**
 * Marca pelo endereço (sem login): a tela de login, o ícone da aba, o app do celular e a prévia do
 * link no WhatsApp mostram a marca do cliente quando o sistema é aberto no domínio próprio dele.
 * Só leitura; endereço que não é de cliente devolve marca vazia (fica a do Prospect Team).
 */

const cor = (c: string | null) => c ?? '#0b6b63';

export function rotasMarcaPublica({ pool }: DepsApi): Router {
  const r = Router();

  /** Organização do endereço, com a marca no plano; senão, null. */
  const daRequisicao = async (req: Request) => {
    const host = typeof req.query.host === 'string' ? req.query.host : '';
    const org = host ? await repo.organizacaoDoEndereco(pool, host) : null;
    if (!org || !(await repo.marcaNoPlano(pool, org))) return null;
    return { host: host.toLowerCase(), dados: await repo.dados(pool, org) };
  };

  r.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    const m = await daRequisicao(req);
    if (!m) return void res.json({ marca: null });
    const d = m.dados;
    const url = (tipo: string, tem: boolean) =>
      tem ? `/publico/marca/arquivo/${tipo}?host=${encodeURIComponent(m.host)}&v=${d.versao}` : null;
    res.json({
      marca: {
        nome: d.nome || d.organizacaoNome,
        cor: d.cor,
        corSecundaria: d.corSecundaria,
        corDestaque: d.corDestaque,
        corClara: d.corClara,
        logo: url('logo', d.logo),
        logoEscuro: url('logoEscuro', d.logoEscuro),
        icone: url('icone', d.icone),
        // A aba e o app usam o ícone da marca quando não têm o próprio.
        favicon: d.favicon ? url('favicon', true) : url('icone', d.icone),
        app: d.app ? url('app', true) : url('icone', d.icone),
        imagem: url('imagem', d.imagem),
        versao: d.versao,
      },
    });
  });

  r.get('/arquivo/:tipo', async (req, res) => {
    const tipo = String(req.params.tipo) as repo.ArquivoMarca;
    const m = repo.ARQUIVOS_MARCA.includes(tipo) ? await daRequisicao(req) : null;
    const a = m ? await repo.arquivo(pool, m.dados.organizacaoId, tipo) : null;
    if (!a) return void res.status(404).end();
    res.setHeader('Content-Type', a.tipo);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(a.dados);
  });

  /** Manifesto do app (celular): nome, cor e ícone do cliente. */
  r.get('/manifest', async (req, res) => {
    const m = await daRequisicao(req);
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (!m) {
      res.json({
        name: 'Prospect Team',
        short_name: 'Prospect Team',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#0b6b63',
        icons: [
          { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      return;
    }
    const d = m.dados;
    const nome = d.nome || d.organizacaoNome;
    const tipoIcone = d.app ? 'app' : d.icone ? 'icone' : null;
    const icone = tipoIcone
      ? `/api/publico/marca/arquivo/${tipoIcone}?host=${encodeURIComponent(m.host)}&v=${d.versao}`
      : '/icone-512.png';
    res.json({
      name: nome,
      short_name: nome.slice(0, 24),
      start_url: '/',
      display: 'standalone',
      // A abertura do app fica na cor secundária (ou na primária).
      background_color: d.corSecundaria ?? '#f7f7f5',
      theme_color: d.corSecundaria ?? cor(d.cor),
      icons: [
        { src: icone, sizes: '192x192', type: 'image/png' },
        { src: icone, sizes: '512x512', type: 'image/png' },
      ],
    });
  });

  return r;
}
