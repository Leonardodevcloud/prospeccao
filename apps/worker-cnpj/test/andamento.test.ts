import { describe, expect, it } from 'vitest';
import { Andamento, fmtBytes } from '../src/importador.js';

describe('andamento da importação', () => {
  it('formata tamanhos de arquivo', () => {
    expect(fmtBytes(350_400_000)).toBe('350 MB');
    expect(fmtBytes(1_120_000_000)).toBe('1,1 GB');
  });

  it('grava troca de etapa na hora e segura atualizações seguidas', async () => {
    const gravadas: string[] = [];
    const a = new Andamento(async (e) => {
      gravadas.push(e);
    }, 60_000);
    await a.agora('Etapa 2 de 4 · baixando');
    a.talvez('Etapa 2 de 4 · baixando 10 MB'); // dentro do intervalo: não grava
    await a.talvezAgora();
    await a.agora('Etapa 2 de 4 · lendo');
    await a.terminar();
    expect(gravadas).toEqual(['Etapa 2 de 4 · baixando', 'Etapa 2 de 4 · lendo']);
  });

  it('depois do intervalo, regrava a etapa atual com os contadores novos', async () => {
    const gravadas: string[] = [];
    const a = new Andamento(async (e) => {
      gravadas.push(e);
    }, 0);
    a.talvez('baixando 10 MB');
    a.talvez('baixando 20 MB');
    await a.talvezAgora();
    await a.terminar();
    expect(gravadas).toEqual(['baixando 10 MB', 'baixando 20 MB', 'baixando 20 MB']);
  });
});
