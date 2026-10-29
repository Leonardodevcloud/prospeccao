import PDFDocument from 'pdfkit';
import type { PainelOrganizacao } from './painel.js';

/**
 * Relatório consolidado da organização em PDF (para a diretoria): números do período, unidades,
 * pessoas, funil e consumo do plano. Fonte padrão do PDF (Helvetica), que já tem os acentos.
 */

const COR = {
  marca: '#0f6b5c',
  texto: '#1d1d1b',
  quieto: '#6b6b66',
  linha: '#e4e4df',
  fundo: '#f4f4f1',
};

const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'));
const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function gerarPdf(
  d: PainelOrganizacao,
  organizacao: string,
  marca?: { cor?: string | null },
): Promise<Buffer> {
  const cor = marca?.cor && /^#[0-9a-f]{6}$/i.test(marca.cor) ? marca.cor : COR.marca;
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: 48, bottom: 48, left: 48, right: 48 },
    info: { Title: `Relatório ${organizacao} · ${d.periodo.rotulo}`, Author: 'Prospect Team' },
  });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const largura = doc.page.width - 96;
  const esquerda = 48;

  // Cabeçalho
  doc.rect(0, 0, doc.page.width, 6).fill(cor);
  doc.fillColor(COR.quieto).font('Helvetica').fontSize(9).text('RELATÓRIO DE PROSPECÇÃO', esquerda, 30);
  doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(22).text(organizacao, esquerda, 44);
  doc
    .fillColor(COR.quieto)
    .font('Helvetica')
    .fontSize(11)
    .text(
      `${d.periodo.rotulo} · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
    );
  doc.moveDown(1.2);

  // Números principais (cartões)
  const t = d.totais;
  const cartoes: [string, string][] = [
    ['Leads enriquecidos', n(t.leads)],
    ['Empresas abordadas', n(t.abordados)],
    ['Responderam', `${n(t.responderam)} (${pct(t.taxaResposta)})`],
    ['Reuniões', n(t.reunioes)],
    ['Ganhos', n(t.ganhos)],
    ['Valor ganho (mensal)', reais(t.valorGanho)],
  ];
  const col = 3;
  const w = (largura - (col - 1) * 10) / col;
  const h = 52;
  let y = doc.y;
  cartoes.forEach(([rotulo, valor], i) => {
    const x = esquerda + (i % col) * (w + 10);
    const yy = y + Math.floor(i / col) * (h + 10);
    doc.roundedRect(x, yy, w, h, 6).fill(COR.fundo);
    doc
      .fillColor(COR.quieto)
      .font('Helvetica')
      .fontSize(8.5)
      .text(rotulo, x + 10, yy + 9, { width: w - 20 });
    doc
      .fillColor(COR.texto)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(valor, x + 10, yy + 24, { width: w - 20 });
  });
  y += 2 * (h + 10) + 8;
  doc.y = y;

  const titulo = (txt: string) => {
    if (doc.y > doc.page.height - 110) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(cor).font('Helvetica-Bold').fontSize(12).text(txt, esquerda);
    doc.moveDown(0.3);
  };

  /** Tabela simples: cabeçalho e linhas, com quebra de página. */
  const tabela = (colunas: { t: string; w: number; dir?: boolean }[], linhas: string[][]) => {
    const total = colunas.reduce((s, c) => s + c.w, 0);
    const escala = largura / total;
    const linha = (valores: string[], negrito: boolean) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y0 = doc.y;
      let x = esquerda;
      let alt = 0;
      doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      colunas.forEach((c, i) => {
        const cw = c.w * escala;
        const hh = doc.heightOfString(valores[i] ?? '', { width: cw - 8 });
        alt = Math.max(alt, hh);
        x += cw;
      });
      x = esquerda;
      colunas.forEach((c, i) => {
        const cw = c.w * escala;
        doc
          .fillColor(negrito ? COR.quieto : COR.texto)
          .text(valores[i] ?? '', x + 4, y0 + 5, { width: cw - 8, align: c.dir ? 'right' : 'left' });
        x += cw;
      });
      doc.y = y0 + alt + 10;
      doc
        .moveTo(esquerda, doc.y - 2)
        .lineTo(esquerda + largura, doc.y - 2)
        .strokeColor(COR.linha)
        .lineWidth(0.6)
        .stroke();
    };
    linha(
      colunas.map((c) => c.t),
      true,
    );
    for (const l of linhas) linha(l, false);
  };

  titulo('Unidades');
  tabela(
    [
      { t: 'Unidade', w: 26 },
      { t: 'Leads', w: 10, dir: true },
      { t: 'Abordadas', w: 11, dir: true },
      { t: 'Respostas', w: 12, dir: true },
      { t: 'Reuniões', w: 10, dir: true },
      { t: 'Ganhos', w: 9, dir: true },
      { t: 'Valor', w: 12, dir: true },
      { t: 'No funil', w: 10, dir: true },
    ],
    [...d.unidades]
      .filter((u) => u.ativa)
      .sort((a, b) => b.ganhos - a.ganhos || b.reunioes - a.reunioes || b.abordados - a.abordados)
      .map((u) => [
        u.nome,
        n(u.leads),
        n(u.abordados),
        n(u.responderam),
        n(u.reunioes),
        n(u.ganhos),
        reais(u.valorGanho),
        n(u.noFunil),
      ]),
  );

  titulo('Funil das negociações abertas no período');
  const f = d.funil as Record<string, number>;
  tabela(
    [
      { t: 'Etapa alcançada', w: 50 },
      { t: 'Negociações', w: 25, dir: true },
      { t: 'Da entrada', w: 25, dir: true },
    ],
    (
      [
        ['a_abordar', 'Entraram no funil'],
        ['abordado', 'Abordadas'],
        ['respondeu', 'Responderam'],
        ['reuniao', 'Reunião'],
        ['proposta', 'Proposta'],
        ['ganho', 'Ganho'],
      ] as const
    ).map(([k, rotulo]) => [rotulo, n(f[k] ?? 0), f.a_abordar ? pct((f[k] ?? 0) / f.a_abordar) : '—']),
  );

  titulo('Pessoas');
  tabela(
    [
      { t: 'Pessoa', w: 22 },
      { t: 'Unidade', w: 20 },
      { t: 'Contatos', w: 11, dir: true },
      { t: 'Respostas', w: 11, dir: true },
      { t: 'Reuniões', w: 11, dir: true },
      { t: 'Ganhos', w: 9, dir: true },
      { t: 'Atrasados', w: 11, dir: true },
    ],
    d.pessoas
      .slice(0, 40)
      .map((p) => [
        p.nome,
        p.unidade,
        n(p.contatos),
        n(p.respostas),
        `${n(p.reunioes)} / ${n(p.metaReunioes)}`,
        `${n(p.ganhos)} / ${n(p.metaGanhos)}`,
        n(p.atrasados),
      ]),
  );
  doc
    .fillColor(COR.quieto)
    .font('Helvetica')
    .fontSize(8)
    .text('Reuniões e ganhos: feito no período / meta mensal da pessoa.', esquerda);

  titulo('Plano');
  doc
    .fillColor(COR.texto)
    .font('Helvetica')
    .fontSize(10)
    .text(
      `Leads enriquecidos neste mês: ${n(d.plano.usoLeadsMes)}${d.plano.leadsMes != null ? ` de ${n(d.plano.leadsMes)}` : ''}. ` +
        `Pessoas com acesso: ${n(d.plano.usoUsuarios)}${d.plano.usuarios != null ? ` de ${n(d.plano.usuarios)}` : ''}.`,
      esquerda,
      undefined,
      { width: largura },
    );
  doc.moveDown(0.4);
  doc
    .fillColor(COR.quieto)
    .fontSize(8)
    .text(
      'Leads: empresas enriquecidas no período. Abordadas: empresas com pelo menos um contato enviado (WhatsApp, ligação, e-mail ou visita). ' +
        'Responderam: empresas que mandaram mensagem ou passaram para "Respondeu". Valor: soma do valor mensal das negociações ganhas.',
      esquerda,
      undefined,
      { width: largura },
    );

  // Rodapé com página
  const paginas = doc.bufferedPageRange();
  for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .fillColor(COR.quieto)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Prospect Team · ${organizacao} · página ${i + 1} de ${paginas.count}`,
        esquerda,
        doc.page.height - 34,
        {
          width: largura,
          align: 'center',
          lineBreak: false,
        },
      );
  }
  doc.end();
  return fim;
}
