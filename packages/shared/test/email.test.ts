import { describe, expect, it } from 'vitest';
import { corSegura, corSobre, marcaEmailEntrada, montarEmail } from '../src/email.js';

const lead = { nome: 'Marcos', empresa: 'Auto Peças Silva', cidade: 'Salvador', remetente: 'Ana' };
const marca = {
  nome: 'Fiix Peças',
  estilo: 'cartao' as const,
  corPrimaria: '#e11d48',
  corFundo: '#f1f5f9',
  corTexto: '#111827',
  corCabecalho: '#0f172a',
  logoUrl: 'https://api.exemplo.com/e/i/abc',
  larguraLogo: 160,
  capaUrl: 'https://api.exemplo.com/e/i/capa',
  rodape: 'Fiix Peças LTDA\nAv. Sete, 100 - Salvador',
};

describe('Montagem do e-mail com a marca', () => {
  it('a abertura da IA entra no lugar de {abertura}; sem ela, o parágrafo some', () => {
    const modelo = {
      assunto: 'Ideia para a {empresa}',
      corpo: '{saudacao}\n\n{abertura}\n\nSou {remetente}.',
    };
    const com = montarEmail(modelo, { ...lead, abertura: 'Vi que vocês têm 312 avaliações no Google.' });
    expect(com.texto).toBe('Olá, Marcos!\n\nVi que vocês têm 312 avaliações no Google.\n\nSou Ana.');
    const sem = montarEmail(modelo, lead);
    expect(sem.texto).toBe('Olá, Marcos!\n\nSou Ana.');
    expect(sem.html).not.toMatch(/<p style="[^"]*"><\/p>/);
  });

  it('estilo cartão: cabeçalho com a logo, capa, cores da marca, botão e rodapé', () => {
    const e = montarEmail(
      {
        assunto: 'Proposta',
        corpo: '{saudacao}\n\nVeja a proposta:\n\n[[Ver proposta|https://fiix.com.br/proposta]]\n\nAbraço',
      },
      lead,
      {
        marca,
        assinatura: '{remetente}\nFiix Peças',
        descadastro: 'https://api/e/sair/x',
        rastrearLink: (i) => `https://api/e/c/t/${i}`,
      },
    );
    expect(e.html).toContain('background:#f1f5f9');
    expect(e.html).toContain('src="https://api.exemplo.com/e/i/abc" width="160"');
    expect(e.html).toContain('src="https://api.exemplo.com/e/i/capa"');
    expect(e.html).toContain('border-bottom:3px solid #e11d48');
    // Botão na cor da marca, com o texto legível e o link rastreado.
    expect(e.html).toMatch(/background:#e11d48"><a href="https:\/\/api\/e\/c\/t\/0"[^>]*color:#ffffff/);
    expect(e.links).toEqual(['https://fiix.com.br/proposta']);
    expect(e.html).toContain('Fiix Peças LTDA<br>Av. Sete, 100 - Salvador');
    expect(e.html).toContain('Clique aqui para sair da lista');
    expect(e.texto).toContain('Ver proposta: https://fiix.com.br/proposta');
  });

  it('estilo simples: parece e-mail pessoal, logo pequena na assinatura', () => {
    const e = montarEmail({ assunto: 'Oi', corpo: 'Texto com www.fiix.com.br' }, lead, {
      marca: { ...marca, estilo: 'simples' },
      assinatura: 'Ana',
    });
    expect(e.html).toContain('background:#ffffff');
    expect(e.html).not.toContain('border-bottom:3px solid');
    expect(e.html).toContain('width="120"');
    expect(e.html).toContain('color:#e11d48;text-decoration:underline');
  });

  it('não deixa cor nem nome da marca injetarem HTML', () => {
    expect(corSegura('red;background:url(x)', '#000000')).toBe('#000000');
    expect(corSegura('#ABC', '#000000')).toBe('#ABC');
    const e = montarEmail({ assunto: 'x', corpo: 'y' }, lead, {
      marca: { ...marca, nome: '<script>x</script>', logoUrl: null, corPrimaria: 'javascript:alert(1)' },
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).not.toContain('javascript:');
  });

  it('escolhe texto branco no fundo escuro e escuro no claro', () => {
    expect(corSobre('#0f172a')).toBe('#ffffff');
    expect(corSobre('#fde047')).toBe('#111827');
  });

  it('valida a identidade visual', () => {
    const ok = marcaEmailEntrada.safeParse({
      nome: 'Tutts',
      remetenteNome: 'Ana da Tutts',
      remetenteEmail: '',
      corPrimaria: '#7c3aed',
      corFundo: '#f4f4f5',
      corTexto: '#1f2933',
      corCabecalho: '#ffffff',
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.remetenteEmail).toBeNull();
    const ruim = marcaEmailEntrada.safeParse({ ...ok.data, corPrimaria: 'roxo' });
    expect(ruim.success).toBe(false);
  });
});
