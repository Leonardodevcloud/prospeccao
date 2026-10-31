import {
  atividadeApiEntrada,
  avisoEntrada,
  CABECALHO_ASSINATURA,
  EVENTOS_AVISO,
  LIMITES_API,
  LISTA_EVENTOS_AVISO,
  leadApiAtualizar,
  leadApiEntrada,
  type PERMISSOES_API,
} from '@prospeccao/shared';
import { z } from 'zod';

/**
 * A descrição da API v1 em OpenAPI 3.1 (para o Postman, Insomnia, Make e Zapier importarem). Os
 * corpos dos pedidos saem dos mesmos esquemas que validam os pedidos: não fica desatualizada.
 */

const esquema = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

const erro = { $ref: '#/components/schemas/Erro' };
const resposta = (descricao: string, ref?: string) => ({
  description: descricao,
  ...(ref ? { content: { 'application/json': { schema: { $ref: ref } } } } : {}),
});
const erros = {
  '401': {
    description: 'Sem chave, chave inválida, revogada ou vencida.',
    content: { 'application/json': { schema: erro } },
  },
  '403': {
    description: 'A chave não tem a permissão (ou o plano não tem a API).',
    content: { 'application/json': { schema: erro } },
  },
  '422': {
    description: 'Dados inválidos (detalhes por campo).',
    content: { 'application/json': { schema: erro } },
  },
  '429': {
    description: 'Passou do limite por minuto ou por dia.',
    content: { 'application/json': { schema: erro } },
  },
};
const permissao = (p: keyof typeof PERMISSOES_API) => ({ 'x-permissao': p });
const id = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

export function documentoOpenApi(base: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Prospect Team — API v1',
      version: '1.0.0',
      description: `Ligue o CRM ao site, ao ERP, à loja virtual e ao Make/Zapier. Crie a chave em Gestão › Integrações e mande no cabeçalho \`Authorization: Bearer <chave>\`. Limites: ${LIMITES_API.porMinuto} chamadas por minuto por chave e ${LIMITES_API.porDia} por dia por conta. Erros sempre no formato { "erro": { "codigo", "mensagem", "detalhes" } }.`,
    },
    servers: [{ url: base }],
    security: [{ chave: [] }],
    tags: [
      { name: 'Leads' },
      { name: 'Funil e equipe' },
      { name: 'Formulários' },
      { name: 'Avisos (webhooks)' },
    ],
    paths: {
      '/': {
        get: {
          summary: 'Quem sou eu',
          description: 'A conta e as permissões da chave (bom para conferir a conexão).',
          responses: { '200': resposta('A conta e a chave.'), ...erros },
        },
      },
      '/leads': {
        post: {
          tags: ['Leads'],
          summary: 'Criar lead',
          description:
            'Cria o lead no funil. Se já existe um lead com o mesmo telefone, e-mail ou CNPJ, junta nele (registra o que chegou numa nota) e responde 200 com "duplicado": true. Mande o cabeçalho Idempotency-Key para repetir o pedido sem criar dois.',
          ...permissao('leads:criar'),
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 120 } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: esquema(leadApiEntrada) } },
          },
          responses: {
            '201': resposta('Criado.', '#/components/schemas/LeadCriado'),
            '200': resposta('Já existia: juntou no lead.', '#/components/schemas/LeadCriado'),
            ...erros,
          },
        },
        get: {
          tags: ['Leads'],
          summary: 'Listar leads',
          description:
            'Do mais novo para o mais velho, em páginas. Para a próxima página, mande "depois" com o valor de "proximo".',
          ...permissao('leads:ler'),
          parameters: [
            { name: 'etapaId', in: 'query', schema: { type: 'integer' } },
            { name: 'responsavelId', in: 'query', schema: { type: 'integer' } },
            { name: 'atualizadoDesde', in: 'query', schema: { type: 'string', format: 'date-time' } },
            {
              name: 'busca',
              in: 'query',
              description: 'Parte do nome da empresa.',
              schema: { type: 'string' },
            },
            { name: 'telefone', in: 'query', schema: { type: 'string' } },
            { name: 'email', in: 'query', schema: { type: 'string' } },
            { name: 'cnpj', in: 'query', schema: { type: 'string' } },
            {
              name: 'limite',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
            { name: 'depois', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': resposta('Uma página.', '#/components/schemas/PaginaLeads'), ...erros },
        },
      },
      '/leads/{id}': {
        get: {
          tags: ['Leads'],
          summary: 'Ver um lead',
          description: 'O lead, as pessoas da negociação e as últimas 20 atividades.',
          ...permissao('leads:ler'),
          parameters: [id],
          responses: {
            '200': resposta('O lead.', '#/components/schemas/Lead'),
            '404': resposta('Não existe nesta conta.'),
            ...erros,
          },
        },
        patch: {
          tags: ['Leads'],
          summary: 'Mudar etapa, responsável e dados',
          description:
            'Para marcar ganho, mande o etapaId da etapa de ganho (veja GET /funis). Para perdido, o motivo é obrigatório.',
          ...permissao('leads:mover'),
          parameters: [id],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: esquema(leadApiAtualizar) } },
          },
          responses: { '200': resposta('O lead depois da mudança.', '#/components/schemas/Lead'), ...erros },
        },
      },
      '/leads/{id}/atividades': {
        post: {
          tags: ['Leads'],
          summary: 'Registrar atividade ou nota',
          description: 'Contato feito (a etapa anda sozinha quando faz sentido) ou nota.',
          ...permissao('atividades'),
          parameters: [id],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: esquema(atividadeApiEntrada) } },
          },
          responses: { '201': resposta('Registrada.'), ...erros },
        },
      },
      '/funis': {
        get: {
          tags: ['Funil e equipe'],
          summary: 'Funis e etapas',
          ...permissao('funil:ler'),
          responses: { '200': resposta('Os funis, cada um com as etapas na ordem.'), ...erros },
        },
      },
      '/usuarios': {
        get: {
          tags: ['Funil e equipe'],
          summary: 'Usuários',
          ...permissao('funil:ler'),
          responses: { '200': resposta('As pessoas da conta (id para o responsavelId).'), ...erros },
        },
      },
      '/entrada/{chave}': {
        post: {
          tags: ['Formulários'],
          summary: 'Entrada de formulário',
          description:
            'Sem chave da API: o endereço de cada formulário aparece em Gestão › Integrações › Formulários do site. Aceita JSON ou formulário HTML (application/x-www-form-urlencoded), do jeito que o construtor mandar (Elementor, RD Station, Typeform…). Campo escondido "pt_confirmar" vazio protege contra robôs.',
          security: [],
          parameters: [{ name: 'chave', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': { schema: { type: 'object', additionalProperties: true } },
              'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: true } },
            },
          },
          responses: {
            '201': resposta('Recebido.'),
            '303': resposta('Formulário HTML: volta para a página escolhida.'),
            '404': resposta('Formulário não existe.'),
          },
        },
      },
      '/avisos': {
        get: {
          tags: ['Avisos (webhooks)'],
          summary: 'Listar avisos',
          ...permissao('avisos'),
          responses: { '200': resposta('Os avisos da conta.'), ...erros },
        },
        post: {
          tags: ['Avisos (webhooks)'],
          summary: 'Criar aviso',
          description: `O CRM manda um POST com JSON para a url a cada evento, assinado no cabeçalho ${CABECALHO_ASSINATURA} ("t=<segundos>,v1=<HMAC-SHA256 hex de \`<t>.<corpo>\` com o segredo>"). Responda 2xx em até 10 s; senão o CRM tenta de novo (1 min, 5 min, 30 min, 2 h, 6 h e 24 h). Eventos: ${LISTA_EVENTOS_AVISO.map((e) => `${e} (${EVENTOS_AVISO[e]})`).join(', ')}.`,
          ...permissao('avisos'),
          requestBody: { required: true, content: { 'application/json': { schema: esquema(avisoEntrada) } } },
          responses: { '201': resposta('Criado; o segredo vem só nesta resposta.'), ...erros },
        },
      },
      '/avisos/{id}': {
        delete: {
          tags: ['Avisos (webhooks)'],
          summary: 'Apagar aviso',
          description: 'Só os criados por esta mesma chave.',
          ...permissao('avisos'),
          parameters: [id],
          responses: { '204': resposta('Apagado.'), ...erros },
        },
      },
    },
    components: {
      securitySchemes: {
        chave: { type: 'http', scheme: 'bearer', description: 'Chave pt_live_… (Gestão › Integrações).' },
      },
      schemas: {
        Erro: {
          type: 'object',
          properties: {
            erro: {
              type: 'object',
              properties: {
                codigo: { type: 'string' },
                mensagem: { type: 'string' },
                detalhes: {},
              },
            },
          },
        },
        Lead: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            empresa: { type: 'string' },
            cnpj: { type: ['string', 'null'] },
            cidade: { type: ['string', 'null'] },
            uf: { type: ['string', 'null'] },
            site: { type: ['string', 'null'] },
            etapa: {
              type: 'object',
              properties: {
                id: { type: ['integer', 'null'] },
                nome: { type: 'string' },
                papel: { type: 'string' },
              },
            },
            funil: {
              type: ['object', 'null'],
              properties: { id: { type: 'integer' }, nome: { type: 'string' } },
            },
            responsavel: {
              type: ['object', 'null'],
              properties: { id: { type: 'integer' }, nome: { type: 'string' } },
            },
            contato: {
              type: 'object',
              properties: {
                nome: { type: ['string', 'null'] },
                cargo: { type: ['string', 'null'] },
                telefone: { type: ['string', 'null'] },
                email: { type: ['string', 'null'] },
              },
            },
            valorMensal: { type: ['number', 'null'] },
            etiquetas: { type: 'array', items: { type: 'string' } },
            proximaAcao: { type: ['string', 'null'] },
            proximaAcaoEm: { type: ['string', 'null'], format: 'date-time' },
            ultimoContatoEm: { type: ['string', 'null'], format: 'date-time' },
            motivo: { type: ['string', 'null'] },
            criadoEm: { type: 'string', format: 'date-time' },
            atualizadoEm: { type: 'string', format: 'date-time' },
            link: { type: 'string' },
          },
        },
        LeadCriado: {
          allOf: [
            { $ref: '#/components/schemas/Lead' },
            { type: 'object', properties: { duplicado: { type: 'boolean' } } },
          ],
        },
        PaginaLeads: {
          type: 'object',
          properties: {
            dados: { type: 'array', items: { $ref: '#/components/schemas/Lead' } },
            proximo: { type: ['integer', 'null'] },
          },
        },
      },
    },
  };
}
