import type { Executor } from '@prospeccao/db';

/**
 * Dados fictícios do CRM de demonstração: a "Nexo Sistemas" vende um sistema de gestão para
 * clínicas, construtoras e pet shops de Salvador. Tudo é inventado (empresas, pessoas, telefones) e
 * sai sempre parecido (sorteio com semente fixa), com datas relativas a hoje.
 */

/* ───────────── sorteio com semente (a demonstração sai igual toda vez) ───────────── */

function sorteio(semente: number) {
  let a = semente >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    r,
    int: (min: number, max: number) => min + Math.floor(r() * (max - min + 1)),
    um: <T>(l: readonly T[]): T => l[Math.floor(r() * l.length)]!,
  };
}

const BAIRROS: [string, number, number, string][] = [
  ['Pituba', -12.999, -38.456, 'Salvador'],
  ['Itaigara', -12.987, -38.459, 'Salvador'],
  ['Rio Vermelho', -13.011, -38.49, 'Salvador'],
  ['Barra', -13.008, -38.528, 'Salvador'],
  ['Graça', -12.999, -38.521, 'Salvador'],
  ['Ondina', -13.009, -38.506, 'Salvador'],
  ['Caminho das Árvores', -12.982, -38.463, 'Salvador'],
  ['Imbuí', -12.968, -38.435, 'Salvador'],
  ['Stella Maris', -12.941, -38.338, 'Salvador'],
  ['Brotas', -12.985, -38.495, 'Salvador'],
  ['Costa Azul', -12.995, -38.445, 'Salvador'],
  ['Patamares', -12.957, -38.405, 'Salvador'],
  ['Piatã', -12.951, -38.383, 'Salvador'],
  ['Federação', -13.0, -38.508, 'Salvador'],
  ['Nazaré', -12.979, -38.503, 'Salvador'],
  ['Canela', -12.993, -38.517, 'Salvador'],
  ['Centro', -12.894, -38.327, 'Lauro de Freitas'],
  ['Vilas do Atlântico', -12.886, -38.304, 'Lauro de Freitas'],
];

const NOMES = [
  'Renato',
  'Camila',
  'Marcos',
  'Juliana',
  'Fernanda',
  'Ricardo',
  'Patrícia',
  'André',
  'Helena',
  'Gustavo',
  'Beatriz',
  'Rodrigo',
  'Larissa',
  'Eduardo',
  'Tatiana',
  'Felipe',
  'Mariana',
  'Leonardo',
  'Vanessa',
  'Thiago',
  'Aline',
  'Bruno',
  'Carla',
  'Daniel',
  'Priscila',
];
const SOBRENOMES = [
  'Lima',
  'Souza',
  'Almeida',
  'Cardoso',
  'Matos',
  'Fontes',
  'Pinheiro',
  'Nogueira',
  'Barreto',
  'Teixeira',
  'Moura',
  'Queiroz',
  'Andrade',
  'Rocha',
  'Menezes',
  'Prado',
  'Brandão',
  'Castro',
  'Sampaio',
  'Lacerda',
];

interface Nicho {
  nome: string;
  campanha: string;
  cnae: string;
  termos: string[];
  categoria: string;
  prefixos: string[];
  nomes: string[];
  cargo: string;
  /** Valor mensal típico do sistema para esse tipo de empresa. */
  valor: [number, number];
  dor: string;
}

const NICHOS: Nicho[] = [
  {
    nome: 'Clínicas odontológicas',
    campanha: 'Clínicas odontológicas · Salvador',
    cnae: '8630504',
    termos: ['clínica odontológica', 'dentista'],
    categoria: 'Clínica odontológica',
    prefixos: ['Clínica', 'Odonto', 'Sorriso', 'Instituto Dental', 'Centro Odontológico'],
    nomes: [
      'Atlântico',
      'Vila Laura',
      'Itaigara',
      'Barra Sul',
      'Rio Vermelho',
      'Pituba Center',
      'da Graça',
      'Ondina',
      'das Árvores',
      'Stella',
      'Brotas',
      'Imbuí',
      'Patamares',
      'Piatã',
      'Costa Azul',
      'Horto',
      'Canela',
      'Federação',
      'Nazaré',
      'Bem Estar',
      'Prime',
      'Família',
      'Vida',
      'Leve',
      'Pleno',
    ],
    cargo: 'Sócio-administrador',
    valor: [690, 1890],
    dor: 'orçamentos que não voltam',
  },
  {
    nome: 'Construtoras',
    campanha: 'Construtoras · Salvador e Lauro de Freitas',
    cnae: '4120400',
    termos: ['construtora', 'incorporadora'],
    categoria: 'Construtora',
    prefixos: ['Construtora', 'Incorporadora', 'Engenharia', 'Construções'],
    nomes: [
      'Horizonte Azul',
      'Farol',
      'Alicerce',
      'Baía',
      'Pedra Forte',
      'Atlântica',
      'Litoral',
      'Prumo',
      'Nova Era',
      'Solidez',
      'Mirante',
      'Concreto Real',
      'Vértice',
      'Bahia Sul',
      'Porto Seguro',
      'Coqueiral',
      'Itapuã',
      'Jaguaribe',
      'Âncora',
      'Monte Verde',
    ],
    cargo: 'Diretor comercial',
    valor: [1490, 3900],
    dor: 'leads de lançamento que esfriam',
  },
  {
    nome: 'Pet shops e clínicas veterinárias',
    campanha: 'Pet shops · Salvador',
    cnae: '4789004',
    termos: ['pet shop', 'clínica veterinária'],
    categoria: 'Pet shop',
    prefixos: ['Pet Center', 'Pet Shop', 'Clínica Vet', 'Mundo Pet', 'Casa do Pet'],
    nomes: [
      'Vilas',
      'Amigo Fiel',
      'Patas',
      'Focinho',
      'Quatro Patas',
      'Bicho Feliz',
      'Pelúcia',
      'Companheiro',
      'Vida Animal',
      'Bom Pra Cachorro',
      'Miau',
      'Bichos & Cia',
      'Pet Mais',
      'Cão Amigo',
      'Pet Prime',
      'Toca',
      'Arca',
      'Lambeijo',
      'Pet Point',
      'Rabo Abanando',
    ],
    cargo: 'Proprietário',
    valor: [390, 990],
    dor: 'clientes que somem depois do primeiro banho',
  },
];

const VENDEDORES = [
  { nome: 'Paula Ribeiro', papel: 'closer', email: 'paula.ribeiro' },
  { nome: 'Lúcia Ferraz', papel: 'sdr', email: 'lucia.ferraz' },
  { nome: 'Ana Paula Rocha', papel: 'sdr', email: 'ana.rocha' },
  { nome: 'Diego Martins', papel: 'closer', email: 'diego.martins' },
  { nome: 'Rafael Costa', papel: 'closer', email: 'rafael.costa' },
] as const;

type Etapa = 'a_abordar' | 'abordado' | 'respondeu' | 'reuniao' | 'proposta' | 'ganho' | 'perdido';
/** Quantas oportunidades em cada etapa (por nicho). */
const DISTRIBUICAO: [Etapa, number][] = [
  ['a_abordar', 10],
  ['abordado', 8],
  ['respondeu', 5],
  ['reuniao', 3],
  ['proposta', 3],
  ['ganho', 2],
  ['perdido', 2],
];

const CONVERSAS: Record<
  'clinica' | 'construtora' | 'pet',
  [direcao: 'enviada' | 'recebida', texto: string][]
> = {
  clinica: [
    [
      'enviada',
      'Oi, {nome}! Aqui é a Lia, da Nexo Sistemas. Vi que a {empresa} tem bastante avaliação boa no Google. Como vocês fazem hoje o retorno dos orçamentos que não fecham?',
    ],
    ['recebida', 'Oi Lia. Fazemos na mão, pelo caderno da recepção. Muita coisa se perde.'],
    [
      'enviada',
      'É bem comum. Dá para automatizar: cada orçamento ganha data de retorno e lembrete. Posso te mostrar em 20 minutos. Quinta às 10h ou sexta às 15h?',
    ],
    ['recebida', 'Sexta às 15h fica bom.'],
  ],
  construtora: [
    [
      'enviada',
      'Bom dia, {nome}! Sou a Lia, da Nexo Sistemas. Vocês estão com lançamento em andamento? Ajudamos construtoras a não perder os leads que chegam pelos portais.',
    ],
    [
      'recebida',
      'Bom dia. Temos um lançamento em Patamares, sim. O corretor não dá conta de responder todo mundo.',
    ],
    [
      'enviada',
      'Faz sentido. O sistema responde na hora e passa para o corretor quem pediu visita. Te mostro numa conversa rápida?',
    ],
    ['recebida', 'Pode ser. Me manda um horário na semana que vem.'],
  ],
  pet: [
    [
      'enviada',
      'Oi, {nome}! Aqui é da Nexo Sistemas. Como vocês lembram o cliente de voltar para o próximo banho?',
    ],
    ['recebida', 'Oi! Não lembramos, ele que volta quando quer kkk'],
    [
      'enviada',
      'A gente manda o lembrete sozinho pelo WhatsApp, com a data do próximo banho. Quer ver como fica?',
    ],
  ],
};

const TELEFONE = (i: number) => `719001${String(100000 + i).slice(1)}`;
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const DIA = 86_400_000;
const dias = (n: number, hora = 10, minuto = 0) => {
  const d = new Date(Date.now() + n * DIA);
  // Hora de Brasília (UTC−3).
  d.setUTCHours(hora + 3, minuto, 0, 0);
  return d.toISOString();
};
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const CODIGO = 'abcdefghjkmnpqrstuvwxyz23456789';

export async function gerarDados(tx: Executor, contaId: number): Promise<void> {
  const s = sorteio(20261030);
  const q = (sql: string, p: unknown[] = []) => tx.query(sql, p);

  /* Configuração da conta: IA ligada (revisando), cadência sem encerrar sozinha, agente descrito. */
  await q(
    `UPDATE comercial.config_agente SET ligado = true, revisar_antes = true,
            sobre_empresa = 'A Nexo Sistemas vende um sistema de gestão para clínicas, construtoras e pet shops: agenda, retorno automático de orçamentos e lembretes pelo WhatsApp. Implantação em 2 semanas, com treino da equipe.'
      WHERE conta_id = $1`,
    [contaId],
  );
  await q('UPDATE comercial.config_cadencia SET encerrar_sem_resposta = false WHERE conta_id = $1', [
    contaId,
  ]);

  /* Equipe fictícia (não consegue entrar: a senha não é válida). */
  const usuarios: number[] = [];
  for (const [i, v] of VENDEDORES.entries()) {
    const { rows } = await q(
      `INSERT INTO cadastro.usuarios (conta_id, nome, email, papel, senha_hash, ativo, recebe_leads, ultimo_acesso, termos_versao, termos_aceitos_em)
       VALUES ($1, $2, $3, $4, '!demonstracao', true, true, now() - ($5 || ' hours')::interval, '1', now())
       RETURNING id`,
      [contaId, v.nome, `${v.email}@demonstracao.prospectteam.com.br`, v.papel, String(1 + i * 3)],
    );
    usuarios.push(Number(rows[0]!.id));
  }
  for (const u of usuarios)
    await q(
      'INSERT INTO comercial.metas (usuario_id, abordagens_dia, reunioes_mes, ganhos_mes) VALUES ($1, 25, 8, 3) ON CONFLICT DO NOTHING',
      [u],
    );
  const [paula, lucia, ana, diego, rafael] = usuarios as [number, number, number, number, number];

  /* Etapas do funil da conta (o preparar_conta cria SDR e Closer). */
  const { rows: etapas } = await q(
    `SELECT e.id, e.papel FROM comercial.etapas e JOIN comercial.pipelines p ON p.id = e.pipeline_id
      WHERE e.conta_id = $1 ORDER BY p.ordem, e.ordem`,
    [contaId],
  );
  const etapaId = (papel: Etapa) => Number(etapas.find((e) => e.papel === papel)?.id ?? null);

  /* Base (ponto de partida das visitas). */
  await q(
    `INSERT INTO cadastro.bases (conta_id, nome, endereco, lat, lng) VALUES ($1, 'Escritório Nexo', 'Av. Tancredo Neves, Caminho das Árvores, Salvador', -12.982, -38.461)`,
    [contaId],
  );

  let fone = 0;
  const decisores = new Map<number, string>();
  const empresasDe: number[][] = [];
  const campanhas: number[] = [];
  for (const [ni, n] of NICHOS.entries()) {
    const { rows: ni_ } = await q(
      `INSERT INTO cadastro.nichos (conta_id, nome, cnaes, termos_maps, cargos_alvo) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [contaId, n.nome, [n.cnae], n.termos, [n.cargo]],
    );
    const cidades =
      ni === 1
        ? [
            { cidade: 'Salvador', uf: 'BA' },
            { cidade: 'Lauro de Freitas', uf: 'BA' },
          ]
        : [{ cidade: 'Salvador', uf: 'BA' }];
    const { rows: ca } = await q(
      `INSERT INTO cadastro.campanhas (conta_id, nome, nicho_id, cidades, status, tipo, iniciada_em, criado_em, meta_diaria)
       VALUES ($1, $2, $3, $4, 'ativa', 'busca', now() - interval '24 days', now() - interval '25 days', 20) RETURNING id`,
      [contaId, n.campanha, ni_[0]!.id, JSON.stringify(cidades)],
    );
    const campanhaId = Number(ca[0]!.id);
    campanhas.push(campanhaId);
    const ids: number[] = [];
    const usados = new Set<string>();
    for (let k = 0; k < 50; k++) {
      let nome = '';
      do nome = `${s.um(n.prefixos)} ${s.um(n.nomes)}`;
      while (usados.has(nome));
      usados.add(nome);
      const [bairro, lat, lng, cidade] = s.um(BAIRROS);
      const nota = Math.round((3.9 + s.r() * 1.1) * 10) / 10;
      const aval = s.int(18, 640);
      const telefone = TELEFONE(fone++);
      const { rows: e } = await q(
        `INSERT INTO descoberta.empresas
           (nome, razao_social, cidade, uf, bairro, logradouro, numero, lat, lng, geo_fonte, maps_nome, maps_categoria,
            maps_nota, maps_avaliacoes, maps_telefone, maps_site, maps_endereco, maps_em, porte, data_abertura, demonstracao)
         VALUES ($1, $2, $3, 'BA', $4, $5, $6, $7, $8, 'maps', $1, $9, $10, $11, $12, $13, $14, now(), $15, $16, true)
         RETURNING id`,
        [
          nome,
          `${nome} Ltda`,
          cidade,
          bairro,
          s.um([
            'Rua das Hortênsias',
            'Av. Paulo VI',
            'Rua Ceará',
            'Av. Oceânica',
            'Rua Rio Grande do Sul',
            'Alameda das Espatódeas',
            'Rua Guillard Muniz',
          ]),
          String(s.int(20, 1800)),
          lat + (s.r() - 0.5) * 0.012,
          lng + (s.r() - 0.5) * 0.012,
          n.categoria,
          nota,
          aval,
          telefone,
          `https://www.${slug(nome)}.com.br`,
          `${bairro}, ${cidade} - BA`,
          s.um(['ME', 'EPP', 'DEMAIS']),
          new Date(Date.now() - s.int(2, 22) * 365 * DIA).toISOString().slice(0, 10),
        ],
      );
      const empresaId = Number(e[0]!.id);
      ids.push(empresaId);
      await q(
        `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio, enriquecimento_solicitado_em, adicionada_em, conta_id, liberado_em)
         VALUES ($1, $2, 'ambos', true, now() - interval '20 days', now() - interval '22 days', $3, now() - interval '20 days')`,
        [campanhaId, empresaId, contaId],
      );
      // Nota e motivo
      const score = Math.min(98, Math.max(32, Math.round(40 + nota * 8 + Math.log(aval) * 3 + s.int(-6, 6))));
      const faixa = score >= 75 ? 'A' : score >= 55 ? 'B' : 'C';
      const decisor = `${s.um(NOMES)} ${s.um(SOBRENOMES)}`;
      const motivo =
        faixa === 'A'
          ? `Bem avaliada (${nota.toLocaleString('pt-BR')} com ${aval} avaliações), decisor encontrado e WhatsApp verificado.`
          : faixa === 'B'
            ? `Avaliação boa, mas poucas informações de contato do decisor.`
            : `Pouca presença online e sem decisor confirmado.`;
      await q(
        `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status, faixa, score, motivo, resumo, site_url, instagram,
           maps_nota, maps_avaliacoes, maps_categoria, maps_endereco, solicitado_em, iniciado_em, concluido_em)
         VALUES ($1, $2, 'concluido', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 now() - ($13 || ' days')::interval, now() - ($13 || ' days')::interval, now() - ($13 || ' days')::interval + interval '3 minutes')`,
        [
          empresaId,
          campanhaId,
          faixa,
          score,
          motivo,
          `${n.categoria} em ${bairro}. Atende com agendamento e tem ${aval} avaliações no Google.`,
          `https://www.${slug(nome)}.com.br`,
          `@${slug(nome)}`,
          nota,
          aval,
          n.categoria,
          `${bairro}, ${cidade} - BA`,
          String(s.int(0, 20)),
        ],
      );
      const { rows: pe } = await q(
        `INSERT INTO enriquecimento.pessoas (empresa_id, nome, cargo, papel, decisor, prioridade, fontes, evidencia)
         VALUES ($1, $2, $3, 'socio', true, 1, '{receita}', 'Quadro de sócios da Receita') RETURNING id`,
        [empresaId, decisor, n.cargo],
      );
      const pessoaId = Number(pe[0]!.id);
      const contatos: [string, string, string, string | null, boolean][] = [
        ['whatsapp', telefone, 'maps', null, true],
        ['telefone', `71${s.int(30000000, 39999999)}`, 'receita', null, false],
        ['email', `contato@${slug(nome)}.com.br`, 'site', null, false],
        ['instagram', `https://instagram.com/${slug(nome)}`, 'site', null, false],
      ];
      for (const [canal, valor, fonte, , principal] of contatos)
        await q(
          `INSERT INTO enriquecimento.contatos (empresa_id, pessoa_id, canal, valor, fonte, fontes, confianca, status, whatsapp, verificado_em, principal)
           VALUES ($1, $2, $3, $4, $5, ARRAY[$5::text], $6, $7, $8, now(), $9)`,
          [
            empresaId,
            canal === 'whatsapp' ? pessoaId : null,
            canal,
            valor,
            fonte,
            canal === 'whatsapp' ? 95 : 70,
            canal === 'whatsapp' || canal === 'email' ? 'verificado' : 'nao_verificado',
            canal === 'whatsapp' ? true : null,
            principal,
          ],
        );
      decisores.set(empresaId, decisor);
    }
    empresasDe.push(ids);
  }

  /* Funil: oportunidades em todas as etapas, com histórico, próximo passo e responsável. */
  const sdrs = [lucia, ana];
  const closers = [paula, diego, rafael];
  const reunioesMarcadas: {
    empresaId: number;
    nome: string;
    decisor: string;
    nicho: number;
    quem: number;
  }[] = [];
  const conversasCom: {
    empresaId: number;
    telefone: string;
    nicho: number;
    decisor: string;
    nome: string;
  }[] = [];
  for (const [ni, ids] of empresasDe.entries()) {
    const n = NICHOS[ni]!;
    let k = 0;
    for (const [etapa, qtd] of DISTRIBUICAO) {
      for (let j = 0; j < qtd; j++) {
        const empresaId = ids[k++]!;
        const { rows: emp } = await q(
          'SELECT nome, maps_telefone AS tel FROM descoberta.empresas WHERE id = $1',
          [empresaId],
        );
        const nome = emp[0]!.nome as string;
        const decisor = decisores.get(empresaId)!;
        const fechamento = ['reuniao', 'proposta', 'ganho'].includes(etapa);
        const quem = fechamento ? closers[(k + ni) % closers.length]! : sdrs[(k + ni) % sdrs.length]!;
        const valor = s.int(n.valor[0] / 10, n.valor[1] / 10) * 10;
        const desde = s.int(1, 18);
        const proximo: Record<Etapa, [string | null, number | null]> = {
          // Poucos para hoje (o dia fica cheio, mas sem um monte de atrasados) e o resto nos próximos dias.
          a_abordar: ['Primeira mensagem', j < 3 ? 0 : s.int(1, 4)],
          abordado: [s.um(['Follow-up 1', 'Follow-up 2', 'Ligar para o decisor']), j < 2 ? 0 : s.int(1, 3)],
          respondeu: [
            s.um(['Marcar a reunião', 'Mandar material', 'Responder a dúvida de preço']),
            j < 1 ? 0 : s.int(1, 2),
          ],
          reuniao: ['Reunião de apresentação', s.int(1, 4)],
          proposta: [
            s.um(['Cobrar a proposta', 'Ajustar a proposta', 'Ligar para fechar']),
            j < 1 ? 0 : s.int(1, 3),
          ],
          ganho: [null, null],
          perdido: [null, null],
        };
        const [acao, em] = proximo[etapa];
        await q(
          `INSERT INTO comercial.oportunidades
             (conta_id, empresa_id, campanha_id, etapa, etapa_id, posicao, motivo, valor_mensal, proxima_acao, proxima_acao_em,
              ultimo_contato_em, etapa_desde, faixa_entrada, score_entrada, criado_em, tentativas, agente, etiquetas, responsavel_id)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() - ($12 || ' days')::interval, l.faixa, l.score,
                  now() - (($12::int + 3) || ' days')::interval, $13, $14, $15, $16
             FROM enriquecimento.leads l WHERE l.empresa_id = $2`,
          [
            contaId,
            empresaId,
            campanhas[ni],
            etapa,
            etapaId(etapa),
            j + 1,
            etapa === 'perdido' ? s.um(['Achou caro', 'Já tem fornecedor', 'Sem tempo agora']) : null,
            etapa === 'a_abordar' ? null : valor,
            acao,
            em == null ? null : dias(em, s.int(9, 17), s.um([0, 30])),
            etapa === 'a_abordar' ? null : dias(-s.int(0, 4), s.int(9, 18)),
            String(desde),
            etapa === 'a_abordar' ? 0 : s.int(1, 4),
            etapa === 'respondeu' && j < 2,
            etapa === 'proposta' && j === 0
              ? ['Prioridade']
              : etapa === 'reuniao' && j === 0
                ? ['Indicação']
                : [],
            quem,
          ],
        );
        // Histórico
        const hist: [string, string | null, string | null, string, number][] = [];
        const ordem: Etapa[] = ['a_abordar', 'abordado', 'respondeu', 'reuniao', 'proposta', 'ganho'];
        const ate = etapa === 'perdido' ? 2 : ordem.indexOf(etapa);
        for (let x = 1; x <= ate; x++)
          hist.push(['etapa', ordem[x - 1]!, ordem[x]!, `Moveu para ${ordem[x]}`, desde + (ate - x) * 2 + 1]);
        if (etapa === 'perdido') hist.push(['etapa', 'respondeu', 'perdido', 'Perdido', desde]);
        for (const [tipo, de, para, texto, d] of hist)
          await q(
            `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, de_etapa, para_etapa, texto, autor, usuario_id, criado_em)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - ($9 || ' days')::interval)`,
            [
              contaId,
              empresaId,
              tipo,
              de,
              para,
              texto,
              VENDEDORES[usuarios.indexOf(quem)]!.nome,
              quem,
              String(d),
            ],
          );
        if (['respondeu', 'reuniao', 'proposta', 'ganho'].includes(etapa) && conversasCom.length < 14)
          conversasCom.push({ empresaId, telefone: emp[0]!.tel as string, nicho: ni, decisor, nome });
        if (etapa === 'reuniao' || (etapa === 'proposta' && j < 2) || etapa === 'ganho')
          reunioesMarcadas.push({ empresaId, nome, decisor, nicho: ni, quem });
        if (etapa === 'ganho')
          await q(
            `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id, criado_em)
             VALUES ($1, $2, 'nota', $3, $4, $5, now() - interval '1 day')`,
            [
              contaId,
              empresaId,
              `Contrato assinado: R$ ${valor.toLocaleString('pt-BR')}/mês. Implantação começa segunda.`,
              VENDEDORES[usuarios.indexOf(quem)]!.nome,
              quem,
            ],
          );
      }
    }
  }

  /* Conversas do WhatsApp (algumas não lidas), com a IA e com pessoas do time. */
  for (const [i, c] of conversasCom.entries()) {
    const roteiro = CONVERSAS[c.nicho === 0 ? 'clinica' : c.nicho === 1 ? 'construtora' : 'pet'];
    const primeiro = c.decisor.split(' ')[0]!;
    const base = s.int(1, 6) * 24 * 60 + s.int(0, 600);
    for (const [m, [direcao, texto]] of roteiro.entries()) {
      const minutos = base - m * s.int(8, 50);
      const t = texto.replace('{nome}', primeiro).replace('{empresa}', c.nome);
      const ultima = m === roteiro.length - 1;
      await q(
        `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem, criado_em, enviado_em, lida_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8 || ' minutes')::interval, now() - ($8 || ' minutes')::interval, $9)`,
        [
          contaId,
          c.empresaId,
          direcao,
          t,
          c.telefone,
          direcao === 'enviada' ? 'enviada' : 'recebida',
          direcao === 'enviada' ? (m === 0 ? 'agente' : i % 2 ? 'humano' : 'agente') : 'lead',
          String(Math.max(5, minutos - (i < 4 ? base - 40 : 0))),
          direcao === 'recebida' && ultima && i < 4 ? null : new Date().toISOString(),
        ],
      );
      await q(
        `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, direcao, texto, autor, criado_em)
         VALUES ($1, $2, 'whatsapp', $3, $4, $5, now() - ($6 || ' minutes')::interval)`,
        [
          contaId,
          c.empresaId,
          direcao,
          t,
          direcao === 'enviada' ? (m === 0 ? 'agente' : 'Lúcia Ferraz') : c.decisor,
          String(Math.max(5, minutos)),
        ],
      );
    }
  }

  /* Meu dia: tarefas de hoje para cada pessoa. */
  const tarefasHoje: [number, string, string, number, number][] = [
    [lucia, 'ligacao', 'Ligar para o decisor', 9, 30],
    [lucia, 'tarefa', 'Mandar material para quem respondeu', 11, 0],
    [ana, 'ligacao', 'Retornar o pedido de orçamento', 10, 0],
    [paula, 'tarefa', 'Ajustar a proposta e reenviar', 14, 0],
    [rafael, 'ligacao', 'Ligar para fechar', 16, 0],
  ];
  for (const [i, [quem, tipo, titulo, h, m]] of tarefasHoje.entries()) {
    const alvo = conversasCom[i % conversasCom.length]!;
    await q(
      `INSERT INTO comercial.tarefas (conta_id, empresa_id, usuario_id, tipo, titulo, inicio, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $3)`,
      [contaId, alvo.empresaId, quem, tipo, `${titulo} · ${alvo.nome}`, dias(0, h, m)],
    );
  }

  /* Reuniões: as que já aconteceram (gravadas, com transcrição e resumo) e as de hoje e amanhã. */
  const codigo = () =>
    `${Array.from({ length: 4 }, () => s.um([...CODIGO])).join('')}-${Array.from({ length: 4 }, () => s.um([...CODIGO])).join('')}`;
  for (const [i, r] of reunioesMarcadas.slice(0, 12).entries()) {
    const n = NICHOS[r.nicho]!;
    const feita = i >= 3;
    const quando = feita ? dias(-s.int(1, 12), s.int(9, 16)) : dias(i === 0 ? 0 : i, i === 0 ? 15 : 10);
    const anfitriao = VENDEDORES[usuarios.indexOf(r.quem)]!.nome;
    const { rows: t } = await q(
      `INSERT INTO comercial.tarefas (conta_id, empresa_id, usuario_id, tipo, titulo, inicio, fim, criado_por, concluida_em)
       VALUES ($1, $2, $3, 'reuniao', $4, $5, $5::timestamptz + interval '45 minutes', $3, $6) RETURNING id`,
      [contaId, r.empresaId, r.quem, `Apresentação · ${r.nome}`, quando, feita ? quando : null],
    );
    const { rows: sala } = await q(
      `INSERT INTO comercial.salas (conta_id, tarefa_id, empresa_id, anfitriao_id, codigo, titulo, inicio, fim, gravar, transcrever, status, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7::timestamptz + interval '45 minutes', true, true, $8, $4) RETURNING id`,
      [
        contaId,
        t[0]!.id,
        r.empresaId,
        r.quem,
        codigo(),
        `Apresentação · ${r.nome}`,
        quando,
        feita ? 'encerrada' : 'marcada',
      ],
    );
    if (!feita) continue;
    const salaId = Number(sala[0]!.id);
    const duracao = s.int(28, 52) * 60;
    const primeiro = r.decisor.split(' ')[0]!;
    const falas: [string, string, string][] = [
      ['u', anfitriao, `Obrigado pelo tempo, ${primeiro}. Me conta: hoje, como vocês lidam com ${n.dor}?`],
      ['c', r.decisor, `Sinceramente, na mão. A recepção anota e muita coisa se perde no caminho.`],
      [
        'u',
        anfitriao,
        'Com o sistema, cada caso ganha um próximo passo com data, e o lembrete chega no WhatsApp da equipe.',
      ],
      ['c', r.decisor, 'Isso resolveria. Quanto fica e em quanto tempo dá para colocar para rodar?'],
      ['u', anfitriao, 'A implantação leva duas semanas, com treino. Mando a proposta até sexta.'],
      ['c', r.decisor, 'Perfeito. Vou envolver meu sócio na decisão.'],
    ];
    const resumo = {
      resumo: `${primeiro} quer parar de perder ${n.dor}. Gostou do retorno automático e pediu proposta; a decisão é com o sócio.`,
      interesse: s.um(['alto', 'alto', 'medio']),
      destaques: [
        { tipo: 'dor', texto: `Perdem ${n.dor} por falta de retorno.`, segundo: 70 },
        { tipo: 'decisor', texto: 'Decide junto com o sócio.', segundo: Math.round(duracao * 0.8) },
        { tipo: 'prazo', texto: 'Quer saber o prazo de implantação.', segundo: Math.round(duracao * 0.55) },
      ],
      proximosPassos: [
        { texto: 'Mandar a proposta', quem: anfitriao.split(' ')[0], prazo: 'sexta' },
        { texto: 'Marcar conversa com o sócio', quem: primeiro, prazo: 'semana que vem' },
      ],
      momentos: [
        { segundo: 70, titulo: 'A dor', tipo: 'outro' },
        { segundo: Math.round(duracao * 0.55), titulo: 'Preço e prazo', tipo: 'preco' },
        { segundo: Math.round(duracao * 0.8), titulo: 'Pediu a proposta', tipo: 'proximo_passo' },
      ],
      sugestaoEtapa: 'proposta',
      motivoSugestao: 'pediu proposta formal',
    };
    const { rows: ss } = await q(
      `INSERT INTO comercial.sala_sessoes (sala_id, conta_id, sala_video, iniciada_em, encerrada_em, gravar, transcrever, situacao,
         duracao_segundos, transcricao, resumo, resumo_em)
       VALUES ($1, $2, $3, $4, $4::timestamptz + make_interval(secs => $5::int), true, true, 'pronta', $5::int, 'pronta', $6, $4)
       RETURNING id`,
      [salaId, contaId, `demo-${salaId}`, quando, String(duracao), JSON.stringify(resumo)],
    );
    const sessaoId = Number(ss[0]!.id);
    const parte = Math.floor((duracao * 1000) / falas.length);
    for (const [f, [quemFala, nome, texto]] of falas.entries())
      await q(
        `INSERT INTO comercial.sala_falas (sessao_id, conta_id, identidade, nome, inicio_ms, fim_ms, texto)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessaoId,
          contaId,
          quemFala === 'u' ? `u-${r.quem}` : 'c-1',
          nome,
          f * parte + 5000,
          f * parte + parte - 2000,
          texto,
        ],
      );
    for (const [identidade, nome, tipo, usuarioId, seg] of [
      [`u-${r.quem}`, anfitriao, 'equipe', r.quem, duracao],
      ['c-1', r.decisor, 'convidado', null, duracao - 60],
    ] as [string, string, string, number | null, number][])
      await q(
        `INSERT INTO comercial.sala_participantes (sala_id, conta_id, identidade, nome, tipo, usuario_id, situacao, entrou_em, saiu_em, segundos_na_sala)
         VALUES ($1, $2, $3, $4, $5, $6, 'liberado', $7, $7::timestamptz + make_interval(secs => $8::int), $8::int)`,
        [salaId, contaId, identidade, nome, tipo, usuarioId, quando, String(seg)],
      );
    await q(
      `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id, criado_em)
       VALUES ($1, $2, 'reuniao', $3, $4, $5, $6)`,
      [contaId, r.empresaId, `Reunião gravada: ${resumo.resumo}`, anfitriao, r.quem, quando],
    );
  }

  /* Vendas na rua: o roteiro de hoje do Diego, com as primeiras visitas feitas. */
  const { rows: perto } = await q(
    `SELECT o.empresa_id AS id FROM comercial.oportunidades o JOIN descoberta.empresas e ON e.id = o.empresa_id
      WHERE o.conta_id = $1 AND o.etapa IN ('a_abordar', 'abordado') AND e.cidade = 'Salvador'
      ORDER BY (e.lat + 12.98) ^ 2 + (e.lng + 38.46) ^ 2 LIMIT 7`,
    [contaId],
  );
  const { rows: rot } = await q(
    `INSERT INTO comercial.roteiros (conta_id, vendedor_id, dia, campanha_id, partida_rotulo, partida_lat, partida_lng, inicio, fim,
       minutos_visita, almoco_inicio, almoco_minutos, km, minutos_rota, calculo, enviado_em, criado_por)
     VALUES ($1, $2, $3, $4, 'Escritório Nexo', -12.982, -38.461, '08:30', '17:30', 40, '12:00', 60, 31, 96, 'estimado', now() - interval '3 hours', $5)
     RETURNING id`,
    [contaId, diego, hojeSp(), campanhas[0], paula],
  );
  const chegadas = ['09:00', '10:05', '11:15', '13:40', '14:50', '16:00', '17:00'];
  for (const [i, p] of perto.entries()) {
    const feita = i < 2;
    await q(
      `INSERT INTO comercial.roteiro_paradas (roteiro_id, conta_id, empresa_id, ordem, chegada_prevista, km_trecho, minutos_trecho,
         almoco_antes, situacao, chegou_em, concluida_em, resultado, anotacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        rot[0]!.id,
        contaId,
        p.id,
        i + 1,
        chegadas[i],
        s.int(2, 7),
        s.int(8, 22),
        i === 3,
        feita ? 'feita' : i === 2 ? 'em_visita' : 'pendente',
        feita || i === 2 ? dias(0, Number(chegadas[i]!.slice(0, 2)), Number(chegadas[i]!.slice(3))) : null,
        feita ? dias(0, Number(chegadas[i]!.slice(0, 2)), Number(chegadas[i]!.slice(3)) + 35) : null,
        feita ? (i === 0 ? 'proposta' : 'decisor') : null,
        feita
          ? i === 0
            ? 'Gostou, quer a proposta com duas unidades.'
            : 'Falei com a gerente; o dono volta na quinta.'
          : null,
      ],
    );
  }
}
