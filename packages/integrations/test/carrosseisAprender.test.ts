import { describe, expect, it } from 'vitest';
import {
  aprendizados,
  evidenciaConfere,
  lerIdeias,
  linhaDoAprendizado,
  melhorHorario,
  type PostParaAprender,
  preferenciasDasEdicoes,
  testeDaVez,
  vezDeTestar,
} from '../src/carrosseis/index.js';

const post = (o: Partial<PostParaAprender>): PostParaAprender => ({
  tipo: 'carrossel',
  modelos: ['capa', 'texto', 'chamada'],
  slides: 7,
  estilo: 'editorial',
  chamada: 'outra',
  fotos: 0,
  fotosIa: 0,
  objetivo: 'ensinar',
  diaSemana: 2,
  hora: 19,
  alcance: 1000,
  salvos: 20,
  compartilhamentos: 5,
  interacoes: 40,
  leads: 0,
  ...o,
});

describe('o time aprende com os posts', () => {
  it('compara cada característica com a mediana da conta e diz a confiança', () => {
    const posts = [
      ...Array.from({ length: 4 }, () => post({ modelos: ['capa', 'lista', 'chamada'], salvos: 100 })),
      ...Array.from({ length: 4 }, () =>
        post({
          tipo: 'outro',
          modelos: null,
          slides: null,
          fotos: null,
          fotosIa: null,
          chamada: null,
          objetivo: null,
        }),
      ),
    ];
    const a = aprendizados(posts);
    const lista = a.find((x) => x.id === 'lista')!;
    expect(lista).toMatchObject({ metrica: 'salvos', posts: 4, confianca: 'media', evita: false });
    expect(linhaDoAprendizado(lista)).toMatch(
      /^Lista e passo a passo: .*salvos · 4 posts · confiança media$/,
    );
    // Com menos de 3 posts, a característica nem aparece.
    expect(aprendizados(posts.slice(0, 2)).find((x) => x.id === 'lista')).toBeUndefined();
  });

  it('com leads vindos dos posts, os leads pesam mais; o que rende menos o time evita', () => {
    const posts = [
      ...Array.from({ length: 4 }, () => post({ chamada: 'comentar', leads: 6, salvos: 20 })),
      ...Array.from({ length: 4 }, () => post({ chamada: 'outra', leads: 1, salvos: 25 })),
      ...Array.from({ length: 3 }, () =>
        post({ objetivo: 'vender', chamada: 'outra', leads: 0, salvos: 2, alcance: 200 }),
      ),
    ];
    const a = aprendizados(posts);
    expect(a.find((x) => x.id === 'comentar')).toMatchObject({ metrica: 'leads', evita: false });
    expect(a.find((x) => x.id === 'vender')!.evita).toBe(true);
  });

  it('o melhor horário só com 8 posts ou mais', () => {
    const bons = Array.from({ length: 4 }, () => post({ diaSemana: 2, hora: 19, interacoes: 90 }));
    const ruins = Array.from({ length: 4 }, () => post({ diaSemana: 5, hora: 9, interacoes: 10 }));
    expect(melhorHorario([...bons, ...ruins.slice(0, 3)])).toBeNull();
    expect(melhorHorario([...bons, ...ruins])!.texto).toBe('ter e sex, 18h a 20h');
  });

  it('o que quem publica sempre muda no editor (3 edições ou mais)', () => {
    const par = {
      doTime: [{ titulo: 'Um título longo demais para o slide', texto: 'abc' }],
      final: [{ titulo: 'Curto', texto: 'abc' }],
    };
    expect(preferenciasDasEdicoes([par, par])).toEqual([]);
    expect(preferenciasDasEdicoes([par, par, par])[0]).toMatchObject({ de: 3, em: 3 });
  });

  it('2 de cada 10 são teste, e o teste é o formato que a conta menos usou', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(vezDeTestar)).toEqual([5, 10]);
    const posts = Array.from({ length: 3 }, () =>
      post({ modelos: ['capa', 'lista'], slides: 5, chamada: 'comentar', fotos: 2 }),
    );
    expect(testeDaVez(posts)).toContain('número grande');
  });
});

describe('as ideias do time', () => {
  const fontes = { CONVERSAS: '- "Quando trocar a pastilha?" (14 vezes) [WhatsApp]' };
  const entrada = {
    empresa: 'Horizonte',
    dossieTexto: '',
    postsQueFuncionaram: [],
    anteriores: [],
    hoje: 'hoje',
    fontes,
    teste: 'Teste um carrossel curto.',
  };

  it('o número da evidência tem que estar na fonte', () => {
    expect(evidenciaConfere('CONVERSAS', 'Chegou 14 vezes', fontes)).toBe(true);
    expect(evidenciaConfere('CONVERSAS', 'Chegou 99 vezes', fontes)).toBe(false);
    expect(evidenciaConfere('CAMPANHA', 'A promoção', fontes)).toBe(false);
    expect(evidenciaConfere('TESTE', 'qualquer', fontes)).toBe(true);
  });

  it('sem fonte que confere a ideia sai; no máximo 2 testes', () => {
    const teste = {
      titulo: 'Um teste curto',
      gancho: 'Cinco slides só',
      formato: 'Curto',
      objetivo: 'ensinar',
      chamada: 'salvar',
      teste: true,
      fontes: [],
    };
    const ideias = lerIdeias(
      {
        ideias: [
          {
            titulo: 'Os sinais da pastilha',
            gancho: 'Seu freio avisou',
            formato: 'Lista',
            objetivo: 'xx',
            chamada: 'salvar',
            fontes: [{ rotulo: 'CONVERSAS', texto: '14 vezes no WhatsApp' }],
          },
          {
            titulo: 'Número inventado',
            gancho: 'Todo mundo pergunta',
            formato: 'P e R',
            objetivo: 'ensinar',
            chamada: 'salvar',
            fontes: [{ rotulo: 'CONVERSAS', texto: '99 vezes' }],
          },
          teste,
          teste,
          teste,
        ],
      },
      entrada,
    );
    expect(ideias.map((i) => i.titulo)).toEqual([
      'Os sinais da pastilha',
      'Um teste curto',
      'Um teste curto',
    ]);
    expect(ideias[0]!.objetivo).toBe('ensinar');
    expect(ideias[1]!.fontes[0]).toEqual({ rotulo: 'TESTE', texto: 'Teste um carrossel curto.' });
  });
});
