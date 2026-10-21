import { describe, expect, it } from 'vitest';
import {
  contatosDosDiretorios,
  extrairContatos,
  palavrasDaEmpresa,
  siteProprioNosResultados,
} from '../src/enriquecimento/index.js';

const palavras = palavrasDaEmpresa('Alcoolmaq', 'ALCOOLMAQ ROLAMENTOS E PECAS LTDA');
const r = (url: string, titulo: string, descricao: string) => ({ url, titulo, descricao });

describe('caso Alcoolmaq: o que a busca da razão social já mostrava', () => {
  const resultados = [
    r(
      'https://www.econodata.com.br/x',
      'Alcoolmaq Rolamentos',
      'Tel (71) 3616-3452 contato@econodata.com.br',
    ),
    r(
      'https://alcoolmaq.com.br/contato',
      'Alcoolmaq Rolamentos e Peças',
      'Fale conosco: (71) 3616-3452 · vendas@alcoolmaq.com.br',
    ),
  ];

  it('o site próprio vem do domínio com o nome da empresa, não de diretório', () => {
    expect(siteProprioNosResultados(resultados, palavras)).toBe('https://alcoolmaq.com.br');
    expect(siteProprioNosResultados(resultados.slice(0, 1), palavras)).toBeNull();
  });

  it('e-mail do site da empresa fica; e-mail do diretório sai', () => {
    const emails = contatosDosDiretorios(resultados, palavras).filter((c) => c.canal === 'email');
    expect(emails.map((e) => e.valor)).toEqual(['vendas@alcoolmaq.com.br']);
  });
});

describe('página do link da bio, qualquer modelo', () => {
  it('acha o WhatsApp no JSON escapado (Linktree) e no api.whatsapp.com', () => {
    const html = `<script id="__NEXT_DATA__">{"links":[{"url":"https:\\/\\/wa.me\\/5571991487670"},{"url":"https://api.whatsapp.com/send?phone=5571986013417&text=Ola"}]}</script>`;
    expect(extrairContatos(html).whatsapps.sort()).toEqual(['71986013417', '71991487670']);
  });
});
