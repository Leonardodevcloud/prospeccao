import { describe, expect, it } from 'vitest';
import {
  formatoDoArquivo,
  linhasDoPdfSemIa,
  pedacosDoTexto,
  textoDoCsv,
} from '../src/modulos/importacao-leads/leitura.js';

describe('leitura do arquivo de leads', () => {
  it('reconhece o formato e recusa planilha antiga com orientação', () => {
    expect(formatoDoArquivo('Clientes.XLSX', '')).toBe('xlsx');
    expect(formatoDoArquivo('lista.csv', '')).toBe('csv');
    expect(formatoDoArquivo('contatos', 'application/pdf')).toBe('pdf');
    expect(() => formatoDoArquivo('antiga.xls', '')).toThrow(/salve como \.xlsx/);
    expect(() => formatoDoArquivo('foto.png', 'image/png')).toThrow(/Excel/);
  });

  it('CSV salvo pelo Excel brasileiro (Windows-1252) mantém os acentos', () => {
    const latin1 = Buffer.from('Razão Social;Município\nAuto Peças São João;Feira de Santana\n', 'latin1');
    expect(textoDoCsv(latin1)).toContain('Auto Peças São João');
    expect(textoDoCsv(Buffer.from('Peças;Ok', 'utf8'))).toBe('Peças;Ok');
  });

  it('PDF sem IA: cada linha com telefone ou e-mail vira um lead', () => {
    const texto = `Lista de clientes - página 1
Auto Peças Silva - Tel: (71) 99999-1111 - compras@silva.com.br
Moto Center Bahia | 75 3222-1000
Rodapé da página`;
    expect(linhasDoPdfSemIa(texto)).toEqual([
      ['Auto Peças Silva', '71999991111', 'compras@silva.com.br'],
      ['Moto Center Bahia', '7532221000', ''],
    ]);
  });

  it('divide o texto do PDF sem cortar linha', () => {
    const p = pedacosDoTexto(['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)].join('\n'), 14);
    expect(p).toEqual(['aaaaaa\nbbbbbb\n', 'cccccc\n']);
  });
});
