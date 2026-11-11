import { describe, expect, it } from 'vitest';
import { planoEfetivo, TABELA_PADRAO, tabelaCompleta } from '../src/planos.js';
import {
  duracaoDosTrechos,
  fmtDuracao,
  fraseDaChamada,
  novoVideoEntrada,
  opcoesVideoEntrada,
  revisaoEntrada,
  tempoNoEditado,
  trechosQueFicam,
} from '../src/videos.js';

const corte = (inicio: number, fim: number, decisao: 'cortar' | 'devolver' = 'cortar') => ({
  inicio,
  fim,
  decisao,
});

describe('vídeos: os trechos que ficam', () => {
  it('tira os cortes, junta os que se encostam e descarta sobras minúsculas', () => {
    const ficam = trechosQueFicam(20, [
      corte(0, 1),
      corte(5, 6),
      corte(6.05, 7),
      corte(10, 12, 'devolver'),
      corte(15, 15.1),
      corte(15.15, 16),
    ]);
    expect(ficam).toEqual([
      { inicio: 1, fim: 5 },
      { inicio: 7, fim: 15 },
      { inicio: 16, fim: 20 },
    ]);
    expect(duracaoDosTrechos(ficam)).toBe(16);
  });

  it('leva um instante do original para o editado (null dentro de um corte)', () => {
    const ficam = trechosQueFicam(20, [corte(0, 1), corte(5, 7)]);
    expect(tempoNoEditado(0.5, ficam)).toBeNull();
    expect(tempoNoEditado(2, ficam)).toBe(1);
    expect(tempoNoEditado(6, ficam)).toBeNull();
    expect(tempoNoEditado(8, ficam)).toBe(5);
  });

  it('frase e botão da tela final de cada chamada', () => {
    expect(fraseDaChamada({ tipo: 'comente', palavra: 'FREIO', texto: '' })).toEqual({
      frase: 'Quer saber mais?',
      botao: 'Comente FREIO',
    });
    expect(fraseDaChamada({ tipo: 'texto', palavra: '', texto: 'Até sábado!' })).toEqual({
      frase: 'Até sábado!',
      botao: '',
    });
    expect(fraseDaChamada({ tipo: 'nenhuma', palavra: '', texto: 'x' })).toEqual({ frase: '', botao: '' });
  });

  it('entradas: padrões, palavra do Comente em maiúsculas e limites', () => {
    const o = opcoesVideoEntrada.parse({ chamada: { tipo: 'comente', palavra: 'freio' } });
    expect(o).toMatchObject({
      estilo: 'acesa',
      ritmo: 'dinamico',
      transicao: 'alternada',
      chamada: { palavra: 'FREIO', texto: '' },
    });
    expect(
      novoVideoEntrada.safeParse({ nome: 'a.exe', tipo: 'application/x-msdownload', bytes: 10, opcoes: {} })
        .success,
    ).toBe(false);
    expect(
      novoVideoEntrada.safeParse({ nome: 'a.mp4', tipo: 'video/mp4', bytes: 2 * 1024 ** 3, opcoes: {} })
        .success,
    ).toBe(false);
    expect(revisaoEntrada.parse({ versao: 2 })).toMatchObject({ cortes: [], palavras: [] });
    expect(fmtDuracao(78)).toBe('1:18');
    expect(fmtDuracao(null)).toBe('—');
  });

  it('o módulo Vídeos com IA no plano: preço, franquia padrão e a própria da conta', () => {
    expect(TABELA_PADRAO.modulos.videos).toBe(200);
    const sem = planoEfetivo({
      plano: 'time',
      limiteUsuarios: null,
      limiteLeadsMes: null,
      modulos: [],
      mensalidadeManual: null,
    });
    expect(sem.videosMes).toBe(0);
    const com = planoEfetivo({
      plano: 'time',
      limiteUsuarios: null,
      limiteLeadsMes: null,
      modulos: ['videos'],
      mensalidadeManual: null,
    });
    expect(com.videosMes).toBe(60);
    expect(com.itens).toContainEqual({ rotulo: 'Vídeos com IA', valor: 200 });
    const proprio = planoEfetivo({
      plano: 'time',
      limiteUsuarios: null,
      limiteLeadsMes: null,
      modulos: ['videos'],
      mensalidadeManual: null,
      videosMes: 10,
    });
    expect(proprio.videosMes).toBe(10);
    // Tabela salva antes do módulo existir ganha o padrão.
    const antiga = tabelaCompleta({
      modulos: { whatsapp: 250, agente_ia: 297, email: 200, ligacoes: 499, carrosseis: 200 },
    });
    expect(antiga.modulos.videos).toBe(200);
    expect(antiga.videosMes).toBe(60);
  });
});
