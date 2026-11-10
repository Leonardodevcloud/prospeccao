import { describe, expect, it } from 'vitest';
import {
  conferirDirectDaPromocao,
  directPadrao,
  legendaBate,
  linkWhatsapp,
  numeroWhatsapp,
  palavraDaChamada,
  palavrasDaLegenda,
  podeReconhecer,
  publicacaoEntrada,
  situacaoDaPublicacao,
} from '../src/carrosseisPublicacao.js';
import { divulgarEntrada } from '../src/carrosseisTime.js';

const LEGENDA =
  'Barulho de metal, pedal baixo, carro puxando de lado… Seu freio avisa antes de falhar. Arraste e veja os 5 sinais que pedem revisão.\n\nComente FREIO que a gente manda o checklist no seu direct.\n\n#freios #autopecas #salvador';

describe('palavra do último slide', () => {
  it('lê a palavra do botão "Comente X" da chamada final', () => {
    expect(
      palavraDaChamada([
        { modelo: 'capa', botao: '' },
        { modelo: 'chamada', botao: 'Comente freio' },
      ]),
    ).toBe('FREIO');
    expect(palavraDaChamada([{ modelo: 'chamada', botao: 'Comente “QUERO”' }])).toBe('QUERO');
  });
  it('sem chamada de comentar: null', () => {
    expect(palavraDaChamada([{ modelo: 'chamada', botao: 'Chame no WhatsApp' }])).toBeNull();
    expect(palavraDaChamada([{ modelo: 'lista', botao: 'Comente FREIO' }])).toBeNull();
    expect(palavraDaChamada([])).toBeNull();
  });
});

describe('reconhecer o post pela legenda', () => {
  it('tira link, hashtag, @, acento e palavra curta', () => {
    expect(palavrasDaLegenda('Revisão já! #freio @loja veja https://x.com/a de')).toEqual([
      'revisao',
      'veja',
    ]);
  });

  it('a mesma legenda bate, com ou sem hashtags e emoji', () => {
    expect(legendaBate(LEGENDA, LEGENDA)).toBe(true);
    const postado = LEGENDA.replace(/#\S+/g, '').replace('Arraste', '👉 Arraste');
    expect(legendaBate(LEGENDA, postado)).toBe(true);
  });

  it('trocar algumas palavras ao postar ainda bate', () => {
    const postado = LEGENDA.replace('Barulho de metal', 'Chiado').replace('pedal baixo', 'pedal mole');
    expect(legendaBate(LEGENDA, postado)).toBe(true);
  });

  it('outro post não bate', () => {
    expect(
      legendaBate(LEGENDA, 'Chegou óleo 5W30 para a linha GM. Corre que é por tempo limitado na loja!'),
    ).toBe(false);
    expect(legendaBate(LEGENDA, null)).toBe(false);
  });

  it('legenda curta demais não reconhece (escolher o post à mão)', () => {
    expect(podeReconhecer('Comente FREIO')).toBe(false);
    expect(legendaBate('Comente FREIO', 'Comente FREIO')).toBe(false);
    expect(podeReconhecer(LEGENDA)).toBe(true);
  });
});

describe('WhatsApp da promoção', () => {
  it('guarda só DDD + número', () => {
    expect(numeroWhatsapp('+55 (71) 99812-4410')).toBe('71998124410');
    expect(numeroWhatsapp('(71) 3333-0000')).toBe('7133330000');
  });
  it('o link abre a conversa com o texto pronto', () => {
    expect(linkWhatsapp('71998124410', 'Quero a promoção')).toBe(
      'https://wa.me/5571998124410?text=Quero%20a%20promo%C3%A7%C3%A3o',
    );
  });
});

describe('entrada da aba Publicação', () => {
  const base = { palavras: ['freio', 'FREIO', 'freios'], mensagem: 'Oi, {nome}! Aqui está.' };

  it('link: completa o https e põe o botão padrão', () => {
    const d = publicacaoEntrada.parse({ ...base, entrega: 'link', link: 'loja.com.br/freio' });
    expect(d.link).toBe('https://loja.com.br/freio');
    expect(d.botaoTexto).toBe('Abrir o link');
    expect(d.palavras).toEqual(['FREIO', 'FREIOS']);
  });

  it('link sem endereço: recusa', () => {
    expect(publicacaoEntrada.safeParse({ ...base, entrega: 'link' }).success).toBe(false);
  });

  it('promoção pede a promoção e o WhatsApp', () => {
    expect(publicacaoEntrada.safeParse({ ...base, entrega: 'promocao' }).success).toBe(false);
    const d = publicacaoEntrada.parse({
      ...base,
      entrega: 'promocao',
      divulgarId: 3,
      whatsapp: '(71) 99812-4410',
    });
    expect(d.whatsapp).toBe('71998124410');
    expect(d.botaoTexto).toBe('Pedir no WhatsApp');
  });

  it('só a conversa não tem botão', () => {
    const d = publicacaoEntrada.parse({ ...base, entrega: 'conversa', botaoTexto: 'Ver' });
    expect(d.botaoTexto).toBe('');
  });
});

describe('direct padrão e conferência da promoção', () => {
  const promo = divulgarEntrada.parse({
    tipo: 'promocao',
    titulo: 'Pastilha Cobreq Onix',
    produto: 'A pastilha Cobreq do Onix',
    precoDe: 'R$ 162,00',
    precoPor: 'R$ 139,90',
    validade: 'até sábado',
  });

  it('a promoção sai com o preço e a validade digitados', () => {
    const t = directPadrao('promocao', 'freio', promo);
    expect(t).toContain('de R$ 162,00 por R$ 139,90 até sábado');
    expect(conferirDirectDaPromocao(promo, t)).toEqual([]);
  });

  it('preço inventado ou validade faltando é apontado', () => {
    expect(conferirDirectDaPromocao(promo, 'Oi! A pastilha está por R$ 99,90.').length).toBeGreaterThan(0);
  });
});

describe('situação da aba', () => {
  const agora = new Date('2026-11-09T12:00:00Z');
  const base = {
    temRegra: true,
    instagram: true,
    carrossel: 'pronto' as const,
    postLigado: false,
    esperandoDesde: '2026-11-08T12:00:00Z',
    agora,
  };
  it('espera, e avisa depois de 3 dias', () => {
    expect(situacaoDaPublicacao(base)).toBe('esperando');
    expect(situacaoDaPublicacao({ ...base, esperandoDesde: '2026-11-06T11:00:00Z' })).toBe('nao_achado');
  });
  it('rascunho, sem Instagram, sem regra e publicado', () => {
    expect(situacaoDaPublicacao({ ...base, carrossel: 'rascunho' })).toBe('rascunho');
    expect(situacaoDaPublicacao({ ...base, instagram: false })).toBe('sem_instagram');
    expect(situacaoDaPublicacao({ ...base, temRegra: false })).toBe('sem_regra');
    expect(situacaoDaPublicacao({ ...base, postLigado: true })).toBe('publicado');
  });
});
