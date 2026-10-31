import { describe, expect, it } from 'vitest';
import { cenasDoTour, falaDaCena, frasesDaFala, paraFalarNoNavegador, varianteDoTour } from '../src/tour.js';

const TUDO = {
  modulos: ['whatsapp', 'agente_ia', 'email', 'ligacoes'],
  recursos: ['reunioes', 'instagram', 'argos'],
};

describe('tour do sistema', () => {
  it('só entram as cenas do que a conta contratou', () => {
    expect(cenasDoTour(TUDO).map((c) => c.id)).toEqual([
      'abertura',
      'meu-dia',
      'campanhas',
      'enriquecimento',
      'conversas',
      'ligacao',
      'ligacao-resumo',
      'reunioes',
      'email',
      'instagram',
      'instagram-conteudo',
      'argos',
      'fim',
    ]);
    const start = cenasDoTour({ modulos: ['whatsapp'], recursos: [] });
    expect(start.map((c) => c.id)).toEqual([
      'abertura',
      'meu-dia',
      'campanhas',
      'enriquecimento',
      'conversas',
      'fim',
    ]);
    // Sem o Argos, ele não se apresenta como assistente; sem a IA, a cena de conversas não fala dela.
    expect(start[0]!.fala).not.toContain('assistente');
    expect(start.find((c) => c.id === 'conversas')!.fala).not.toContain('Agente de IA');
    expect(cenasDoTour(TUDO)[0]!.fala).toContain('Eu sou o Argos');
  });

  it('todo destaque aponta para uma palavra da fala, na ordem em que ela é dita', () => {
    for (const ctx of [
      TUDO,
      { modulos: ['whatsapp', 'email', 'ligacoes'], recursos: ['reunioes', 'instagram'] },
    ])
      for (const c of cenasDoTour(ctx)) {
        expect(c.fala.length, c.id).toBeGreaterThan(40);
        if (c.img) expect(c.focos?.length, c.id).toBeGreaterThan(0);
        const posicoes = (c.focos ?? []).map((f) => c.fala.indexOf(f.em)).filter((i) => i >= 0);
        if (c.img) expect(posicoes.length, c.id).toBeGreaterThan(0);
        expect(posicoes, c.id).toEqual([...posicoes].sort((a, b) => a - b));
        for (const f of c.focos ?? []) {
          const [x, y, w, h] = f.r;
          expect(x >= 0 && y >= 0 && x + w <= 100.5 && y + h <= 100.5, `${c.id}: ${f.rotulo}`).toBe(true);
        }
      }
  });

  it('o áudio só fala o texto do tour, na variante certa', () => {
    expect(varianteDoTour(TUDO)).toBe('ai');
    expect(varianteDoTour({ modulos: [], recursos: [] })).toBe('-');
    expect(falaDaCena('abertura', 'ai')).toContain('Eu sou o Argos');
    expect(falaDaCena('abertura', '-')).not.toContain('Eu sou o Argos');
    expect(falaDaCena('conversas', 'i')).toContain('Agente de IA');
    expect(falaDaCena('nao-existe', 'ai')).toBeNull();
  });

  it('legenda por frase e pronúncia para a voz do navegador', () => {
    const f = frasesDaFala('Primeira frase. Segunda frase? Terceira!');
    expect(f.map((x) => x.texto)).toEqual(['Primeira frase.', 'Segunda frase?', 'Terceira!']);
    expect(f[1]!.inicio).toBe(16);
    expect(frasesDaFala('Marca uma reunião com o Dr. Renato amanhã. Pronto!').map((x) => x.texto)).toEqual([
      'Marca uma reunião com o Dr. Renato amanhã.',
      'Pronto!',
    ]);
    expect(paraFalarNoNavegador('O WhatsApp do lead e a IA no CRM')).toBe(
      'O uótzap do lídi e a i á no cê erre ême',
    );
  });
});
