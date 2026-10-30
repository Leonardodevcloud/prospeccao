import { INICIO_MES_SP, INICIO_MES_SP_TS } from '@prospeccao/db';
import type { DepsApi } from '../../dependencias.js';

/**
 * Configurações da plataforma (painel master): cada serviço que a plataforma usa para todos os
 * clientes, se está configurado, o que falta e o uso do mês. Nada aqui mostra chave: só se existe.
 */

export type EstadoServico = 'ok' | 'aviso' | 'falta';

export interface ServicoPlataforma {
  id: string;
  nome: string;
  /** O que ele faz no sistema. */
  papel: string;
  estado: EstadoServico;
  detalhe: string;
  /** Como resolver quando falta ou tem aviso (variáveis e onde). */
  comoFazer: string | null;
  /** Dá para testar pela tela (chama o serviço com o mínimo possível). */
  testavel: boolean;
}

const n = (x: number) => x.toLocaleString('pt-BR');

export async function servicosDaPlataforma(deps: DepsApi): Promise<ServicoPlataforma[]> {
  const { pool, credenciais } = deps;
  const amb = credenciais.ambiente;
  const { rows } = await pool.query<{
    numeros: number;
    contas_numeros: number;
    dominios: number;
    dominios_ok: number;
    ia: number;
    minutos: number;
    transcritas: number;
    gb: number;
    places_usd: number;
    buscas: number;
    buscas_7d: number;
    dominios_ativos: number;
    dominios_pendentes: number;
  }>(
    `SELECT (SELECT count(*) FROM comercial.chips WHERE ativo AND token_cifrado IS NOT NULL AND estado LIKE 'ok%')::int AS numeros,
            (SELECT count(DISTINCT conta_id) FROM comercial.chips WHERE ativo AND token_cifrado IS NOT NULL AND estado LIKE 'ok%')::int AS contas_numeros,
            (SELECT count(*) FROM cadastro.dominios_email)::int AS dominios,
            (SELECT count(*) FROM cadastro.dominios_email WHERE situacao = 'verificado')::int AS dominios_ok,
            coalesce((SELECT sum(chamadas) FROM cadastro.consumo_ia WHERE origem = 'plataforma' AND dia >= ${INICIO_MES_SP}), 0)::int AS ia,
            coalesce((SELECT sum(segundos_na_sala) FROM comercial.sala_participantes WHERE entrou_em >= ${INICIO_MES_SP_TS}), 0)::float8 / 60 AS minutos,
            coalesce((SELECT sum(duracao_segundos) FROM comercial.sala_sessoes WHERE transcricao = 'pronta' AND iniciada_em >= ${INICIO_MES_SP_TS}), 0)::float8 / 3600 AS transcritas,
            coalesce((SELECT sum(video_bytes) FROM comercial.sala_sessoes), 0)::float8 / 1e9 AS gb,
            coalesce((SELECT sum(gasto_usd) FROM descoberta.v_uso_places_mes WHERE mes = ${INICIO_MES_SP}), 0)::float8 AS places_usd,
            coalesce((SELECT sum(buscas) FROM cadastro.consumo_buscas WHERE dia >= ${INICIO_MES_SP}), 0)::int AS buscas,
            coalesce((SELECT sum(buscas) FROM cadastro.consumo_buscas WHERE dia >= current_date - 7), 0)::int AS buscas_7d,
            (SELECT count(*) FROM cadastro.organizacoes WHERE dominio_situacao = 'ativo')::int AS dominios_ativos,
            (SELECT count(*) FROM cadastro.organizacoes WHERE dominio_situacao = 'pendente')::int AS dominios_pendentes`,
  );
  const u = rows[0]!;
  const reun = deps.reunioes ?? null;
  const ass = deps.assistente ?? null;
  const lista: ServicoPlataforma[] = [];

  // WhatsApp
  lista.push({
    id: 'whatsapp',
    nome: 'WhatsApp · Z-API',
    papel: 'Conecta os números dos clientes (cada número vira uma instância na Z-API).',
    estado: amb.zapiParceiroToken ? (amb.zapiClientToken ? 'ok' : 'aviso') : 'falta',
    detalhe: amb.zapiParceiroToken
      ? `${n(u.numeros)} ${u.numeros === 1 ? 'número conectado' : 'números conectados'} em ${n(u.contas_numeros)} ${u.contas_numeros === 1 ? 'conta' : 'contas'}${amb.zapiClientToken ? '' : ' · sem o token de segurança'}`
      : 'Sem o token de parceiro: os clientes não conseguem conectar números.',
    comoFazer: amb.zapiParceiroToken
      ? amb.zapiClientToken
        ? null
        : 'Ative o token de segurança da conta na Z-API e coloque em ZAPI_CLIENT_TOKEN (api e worker-enriquecimento).'
      : 'Peça à Z-API o token de parceiro (integrador "on-demand") e coloque em ZAPI_PARCEIRO_TOKEN e ZAPI_CLIENT_TOKEN, nos serviços api e worker-enriquecimento do Railway.',
    testavel: !!amb.zapiParceiroToken,
  });

  // E-mail
  const faltaResend = !amb.resendKey || !amb.emailRemetente;
  const avisosEmail = [
    !amb.resendDominioRespostas && 'sem o domínio de respostas',
    !amb.resendWebhookSegredo && 'sem o segredo do webhook',
  ].filter(Boolean);
  lista.push({
    id: 'email',
    nome: 'E-mail · Resend',
    papel:
      'Envia as sequências de e-mail e o "Esqueci minha senha"; os clientes cadastram o domínio deles aqui.',
    estado: faltaResend ? 'falta' : avisosEmail.length ? 'aviso' : 'ok',
    detalhe: faltaResend
      ? 'Sem a chave ou o remetente: e-mail desligado para todos.'
      : `Remetente ${amb.emailRemetente} · ${n(u.dominios)} ${u.dominios === 1 ? 'domínio de cliente' : 'domínios de clientes'} (${n(u.dominios_ok)} verificados)${avisosEmail.length ? ` · ${avisosEmail.join(', ')}` : ''}`,
    comoFazer: faltaResend
      ? 'Crie a conta no Resend, verifique o domínio de envio e coloque RESEND_API_KEY e EMAIL_REMETENTE na api.'
      : avisosEmail.length
        ? 'Coloque RESEND_DOMINIO_RESPOSTAS (onde chegam as respostas) e RESEND_WEBHOOK_SEGREDO (whsec_…) na api. Confira também o limite de domínios do seu plano no Resend.'
        : 'Confira de tempos em tempos o limite de domínios e de envios do seu plano no Resend.',
    testavel: !faltaResend,
  });

  // IA
  lista.push({
    id: 'ia',
    nome: `IA da plataforma${amb.iaProvedor ? ` · ${amb.iaProvedor}` : ''}`,
    papel: 'Nota dos leads, Agente de IA, resumo das reuniões, Argos e e-mails personalizados.',
    estado: amb.iaKey ? 'ok' : 'falta',
    detalhe: amb.iaKey
      ? `${amb.iaModelo ?? 'modelo padrão'} · ${n(u.ia)} chamadas no mês`
      : 'Sem a chave: as funções de IA ficam desligadas (a não ser para quem tem chave própria).',
    comoFazer: amb.iaKey ? null : 'Coloque IA_PROVEDOR e IA_API_KEY na api e no worker-enriquecimento.',
    testavel: !!amb.iaKey,
  });

  // Reuniões
  lista.push({
    id: 'livekit',
    nome: 'Reuniões por vídeo · LiveKit',
    papel: 'A sala de vídeo das reuniões com os leads.',
    estado: reun?.video ? (u.minutos > 4500 ? 'aviso' : 'ok') : 'falta',
    detalhe: reun?.video
      ? `${n(Math.round(u.minutos))} minutos de participante no mês${u.minutos > 4500 ? ' · perto dos 5.000 do plano gratuito' : ' (o plano gratuito tem 5.000)'}`
      : 'Sem LiveKit: a tela Reuniões avisa que a sala não está configurada.',
    comoFazer: reun?.video
      ? u.minutos > 4500
        ? 'Acompanhe em cloud.livekit.io › Settings › Usage e, se precisar, passe para o plano Ship.'
        : null
      : 'Crie o projeto em cloud.livekit.io e coloque LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET na api.',
    testavel: !!reun?.video,
  });
  lista.push({
    id: 'gravacoes',
    nome: 'Gravações · bucket S3 (R2)',
    papel: 'Guarda as gravações das reuniões e as fotos das visitas.',
    estado: reun?.armazenamento ? 'ok' : 'falta',
    detalhe: reun?.armazenamento
      ? `${reun.armazenamento.destino.bucket} · ${u.gb.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB de gravações guardadas`
      : 'Sem bucket: as reuniões acontecem, mas sem gravação, transcrição e resumo.',
    comoFazer: reun?.armazenamento
      ? null
      : 'Crie o bucket no Cloudflare R2 e coloque GRAVACOES_S3_ENDPOINT, GRAVACOES_S3_BUCKET, GRAVACOES_S3_CHAVE e GRAVACOES_S3_SEGREDO na api.',
    testavel: !!reun?.armazenamento,
  });
  const temGroq = !!reun?.transcricao || !!ass?.voz;
  lista.push({
    id: 'groq',
    nome: 'Transcrição · Groq',
    papel: 'Transcreve as reuniões, a voz do Argos e a anotação falada das visitas.',
    estado: temGroq ? 'ok' : 'falta',
    detalhe: temGroq
      ? `${u.transcritas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} horas de reunião transcritas no mês`
      : 'Sem GROQ_CHAVE: reuniões sem transcrição e o Argos não ouve (só texto).',
    comoFazer: temGroq ? null : 'Crie a chave em console.groq.com e coloque em GROQ_CHAVE na api.',
    testavel: false,
  });
  lista.push({
    id: 'voz',
    nome: 'Voz do Argos · OpenAI',
    papel: 'A voz com que o Argos responde.',
    estado: ass?.fala ? 'ok' : 'falta',
    detalhe: ass?.fala ? 'O Argos responde falando.' : 'Sem OPENAI_CHAVE: o Argos responde só em texto.',
    comoFazer: ass?.fala ? null : 'Crie a chave em platform.openai.com e coloque em OPENAI_CHAVE na api.',
    testavel: false,
  });
  lista.push({
    id: 'argos',
    nome: 'Argos · acesso aos dados',
    papel: 'O acesso só de leitura que o Argos usa para responder com os números do comercial.',
    estado: ass?.leitura ? 'ok' : 'aviso',
    detalhe: ass?.leitura
      ? 'Acesso de leitura ligado.'
      : (ass?.erro ?? 'O Argos responde sem consultar os dados.'),
    comoFazer: ass?.leitura
      ? null
      : 'Veja o log da api ao subir ("Argos"): ele diz por que o acesso não foi criado.',
    testavel: false,
  });

  // Rotas, Maps e buscas
  lista.push({
    id: 'ors',
    nome: 'Rotas · OpenRouteService',
    papel: 'Roteiro de visitas pelas ruas e endereço de partida.',
    estado: amb.orsKey ? 'ok' : 'aviso',
    detalhe: amb.orsKey
      ? 'Roteiros calculados pelas ruas.'
      : 'Sem chave: os tempos de visita são estimados pela distância.',
    comoFazer: amb.orsKey
      ? null
      : 'Crie o token grátis em openrouteservice.org e coloque em ORS_API_KEY na api e no worker-descoberta.',
    testavel: !!amb.orsKey,
  });
  lista.push({
    id: 'places',
    nome: 'Google Maps · Places',
    papel: 'Busca as empresas no Google Maps nas campanhas.',
    estado: amb.placesKey ? 'ok' : 'aviso',
    detalhe: amb.placesKey
      ? `US$ ${u.places_usd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} usados no mês`
      : 'Sem chave na api (o botão Testar não funciona; o worker pode ter a dele).',
    comoFazer: amb.placesKey
      ? null
      : 'Coloque GOOGLE_PLACES_KEY na api (para testar) e nos workers de descoberta e enriquecimento.',
    testavel: !!amb.placesKey,
  });
  lista.push({
    id: 'buscas',
    nome: 'Busca no Google e Instagram · Serper e Apify',
    papel: 'Acha site, Instagram e contatos dos leads (worker-enriquecimento).',
    estado: u.buscas_7d > 0 ? 'ok' : 'aviso',
    detalhe:
      u.buscas_7d > 0 ? `${n(u.buscas)} buscas no mês` : 'Nenhuma busca registrada nos últimos 7 dias.',
    comoFazer:
      u.buscas_7d > 0
        ? null
        : 'Se há campanhas rodando, confira SERPER_API_KEY e APIFY_TOKEN no worker-enriquecimento.',
    testavel: false,
  });

  // Domínio próprio dos clientes (marca própria, plano Escala)
  const temVercel = !!(amb.vercelToken && amb.vercelProjeto);
  lista.push({
    id: 'dominios',
    nome: 'Domínio próprio dos clientes · Vercel',
    papel:
      'Cadastra no projeto do painel o domínio que o cliente configura (crm.empresa.com.br) e gera o HTTPS.',
    estado: temVercel ? 'ok' : 'falta',
    detalhe: temVercel
      ? `${n(u.dominios_ativos)} ${u.dominios_ativos === 1 ? 'domínio ativo' : 'domínios ativos'}${u.dominios_pendentes ? ` · ${n(u.dominios_pendentes)} esperando o DNS` : ''}`
      : 'Sem o token do Vercel: o cliente não consegue usar o domínio próprio.',
    comoFazer: temVercel
      ? null
      : 'No Vercel: Account Settings › Tokens › Create (escopo do time do projeto). Coloque em VERCEL_TOKEN, o nome do projeto do painel em VERCEL_PROJETO e, se o projeto é de um time, o ID do time em VERCEL_TIME, na api do Railway.',
    testavel: false,
  });
  return lista;
}

/** Teste rápido de LiveKit e do bucket (os outros usam o teste das credenciais da conta principal). */
export async function testarServico(deps: DepsApi, id: string): Promise<{ ok: boolean; resultado: string }> {
  try {
    if (id === 'livekit') {
      const v = deps.reunioes?.video;
      if (!v) return { ok: false, resultado: 'LiveKit não configurado.' };
      await v.abrirSala({ sala: 'teste-plataforma', maxPessoas: 1 });
      await v.acesso({ sala: 'teste-plataforma', identidade: 'teste', nome: 'Teste', horas: 1 });
      return { ok: true, resultado: 'ok (sala de teste criada no LiveKit)' };
    }
    if (id === 'gravacoes') {
      const a = deps.reunioes?.armazenamento;
      if (!a) return { ok: false, resultado: 'Bucket não configurado.' };
      const chave = `teste/plataforma-${Date.now()}.txt`;
      await a.enviar(chave, new TextEncoder().encode('ok'), 'text/plain');
      const lido = new TextDecoder().decode(await a.ler(chave));
      await a.apagar([chave]);
      return lido === 'ok'
        ? { ok: true, resultado: 'ok (gravou, leu e apagou um arquivo de teste)' }
        : { ok: false, resultado: 'Gravou, mas leu um conteúdo diferente.' };
    }
    return { ok: false, resultado: 'Este serviço não tem teste por aqui.' };
  } catch (erro) {
    return { ok: false, resultado: (erro instanceof Error ? erro.message : String(erro)).slice(0, 400) };
  }
}
