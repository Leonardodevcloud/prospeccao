import { describe, expect, it } from 'vitest';
import { planoEfetivo, TABELA_PADRAO, tabelaCompleta } from '../src/planos.js';
import {
  aplicarTrechos,
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

describe('v142: cortar e devolver um trecho palavra por palavra', () => {
  const palavras = [
    { t: 'se', i: 1, f: 1.2 },
    { t: 'você', i: 1.25, f: 1.5 },
    { t: 'deseja', i: 1.55, f: 2 },
    { t: 'saber', i: 2.1, f: 2.4 },
    { t: 'mais', i: 2.45, f: 2.8 },
  ];
  const corte = (inicio: number, fim: number, id = 'c1') => ({
    id,
    inicio,
    fim,
    tipo: 'outro' as const,
    motivo: 'Fala embolada',
    trecho: '',
    duvida: true,
    decisao: 'cortar' as const,
    conferido: false,
  });

  it('cortar vira um corte manual com as palavras do trecho', () => {
    const r = aplicarTrechos([], palavras, [{ acao: 'cortar', inicio: 1.5, fim: 2.05 }], 'x');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: 'mx0',
      tipo: 'manual',
      decisao: 'cortar',
      trecho: 'deseja',
      duvida: false,
    });
  });

  it('devolver no meio de um corte parte ele em dois e a palavra volta', () => {
    const r = aplicarTrechos([corte(1, 2.8)], palavras, [{ acao: 'devolver', inicio: 1.5, fim: 2.05 }], 'x');
    expect(r.map((c) => [c.inicio, c.fim, c.decisao])).toEqual([
      [1, 1.5, 'cortar'],
      [2.05, 2.8, 'cortar'],
    ]);
    expect(r[0]!.id).toBe('c1');
    expect(r[1]!.id).toBe('c1-x0');
    expect(r.map((c) => c.trecho)).toEqual(['se você', 'saber mais']);
    expect(r.every((c) => c.conferido)).toBe(true);
  });

  it('devolver na ponta encolhe o corte; cobrindo tudo, devolve o corte inteiro', () => {
    const ponta = aplicarTrechos(
      [corte(1, 2.8)],
      palavras,
      [{ acao: 'devolver', inicio: 2.05, fim: 2.9 }],
      'x',
    );
    expect(ponta.map((c) => [c.inicio, c.fim, c.id])).toEqual([[1, 2.05, 'c1']]);
    const tudo = aplicarTrechos(
      [corte(1.5, 2.05)],
      palavras,
      [{ acao: 'devolver', inicio: 1.4, fim: 2.1 }],
      'x',
    );
    expect(tudo.map((c) => c.decisao)).toEqual(['devolver']);
  });

  it('cortes já devolvidos e os que não encostam ficam como estão', () => {
    const devolvido = { ...corte(1, 1.2, 'd'), decisao: 'devolver' as const };
    const longe = corte(5, 6, 'l');
    const r = aplicarTrechos(
      [devolvido, longe],
      palavras,
      [{ acao: 'devolver', inicio: 0.9, fim: 1.3 }],
      'x',
    );
    expect(r).toEqual([devolvido, longe]);
  });
});
