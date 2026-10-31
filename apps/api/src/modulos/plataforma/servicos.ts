import type { DepsApi } from '../../dependencias.js';
import { enderecoDeRetorno } from '../instagram/rotas.js';
import { lerPlanos } from './repositorio.js';
import { usoDoMes } from './saude.js';

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
  const [{ rows }, mes, planos] = await Promise.all([
    pool.query<{
      numeros: number;
      contas_numeros: number;
      dominios: number;
      dominios_ok: number;
      buscas_7d: number;
      dominios_ativos: number;
      dominios_pendentes: number;
    }>(
      `SELECT (SELECT count(*) FROM comercial.chips WHERE ativo AND token_cifrado IS NOT NULL AND estado LIKE 'ok%')::int AS numeros,
            (SELECT count(DISTINCT conta_id) FROM comercial.chips WHERE ativo AND token_cifrado IS NOT NULL AND estado LIKE 'ok%')::int AS contas_numeros,
            (SELECT count(*) FROM cadastro.dominios_email)::int AS dominios,
            (SELECT count(*) FROM cadastro.dominios_email WHERE situacao = 'verificado')::int AS dominios_ok,
            coalesce((SELECT sum(buscas) FROM cadastro.consumo_buscas WHERE dia >= current_date - 7), 0)::int AS buscas_7d,
            (SELECT count(*) FROM cadastro.organizacoes WHERE dominio_situacao = 'ativo')::int AS dominios_ativos,
            (SELECT count(*) FROM cadastro.organizacoes WHERE dominio_situacao = 'pendente')::int AS dominios_pendentes`,
    ),
    usoDoMes(pool),
    lerPlanos(pool),
  ]);
  const u = rows[0]!;
  const lk = planos.livekit;
  const minutosSala = mes.reuniaoMin + mes.ligacaoSalaMin;
  const minutosLigacao = mes.sipFeitasMin + mes.sipRecebidasMin;
  const pertoDoLimite = minutosSala >= lk.participanteMin * 0.9 || minutosLigacao >= lk.ligacaoMin * 0.9;
  const temLivekit = !!(deps.reunioes?.video || deps.telefonia?.servico);
  const gb = (mes.bytesReunioes + mes.bytesLigacoes) / 1e9;
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
      ? `${amb.iaModelo ?? 'modelo padrão'} · ${n(mes.iaChamadas)} chamadas no mês`
      : 'Sem a chave: as funções de IA ficam desligadas (a não ser para quem tem chave própria).',
    comoFazer: amb.iaKey ? null : 'Coloque IA_PROVEDOR e IA_API_KEY na api e no worker-enriquecimento.',
    testavel: !!amb.iaKey,
  });

  // Reuniões e ligações (as duas passam pelo LiveKit; a gravação é feita pelo navegador).
  lista.push({
    id: 'livekit',
    nome: 'Reuniões e ligações · LiveKit',
    papel: `As salas de vídeo das reuniões e a ponte das ligações com a operadora. ${
      reun?.gravacaoNaNuvem
        ? 'Grava as reuniões na nuvem (pago por minuto).'
        : 'Não grava: quem grava é o navegador.'
    }`,
    estado: temLivekit ? (pertoDoLimite ? 'aviso' : 'ok') : 'falta',
    detalhe: temLivekit
      ? `Plano ${lk.plano}: ${n(Math.round(minutosSala))} de ${n(lk.participanteMin)} minutos de sala e ${n(Math.round(minutosLigacao))} de ${n(lk.ligacaoMin)} de ligação no mês`
      : 'Sem LiveKit: a tela Reuniões avisa que a sala não está configurada.',
    comoFazer: temLivekit
      ? pertoDoLimite
        ? 'Veja a previsão em Saúde e consumo. Se for passar, mude o plano em cloud.livekit.io e atualize em Planos dos serviços.'
        : null
      : 'Crie o projeto em cloud.livekit.io e coloque LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET na api.',
    testavel: !!reun?.video,
  });
  lista.push({
    id: 'gravacoes',
    nome: 'Gravações · bucket S3 (R2)',
    papel: 'Guarda as gravações das reuniões e das ligações e as fotos das visitas.',
    estado: reun?.armazenamento ? 'ok' : 'falta',
    detalhe: reun?.armazenamento
      ? `${reun.armazenamento.destino.bucket} · ${gb.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB de gravações guardadas (reuniões e ligações)`
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
    papel: 'Transcreve as reuniões, as ligações, a voz do Argos e a anotação falada das visitas.',
    estado: temGroq ? 'ok' : 'falta',
    detalhe: temGroq
      ? `${(mes.transcricaoReuniaoH + mes.transcricaoLigacaoH).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} horas de áudio transcritas no mês (reuniões e ligações)`
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
      ? `US$ ${mes.placesUsd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} usados no mês`
      : 'Sem chave na api (o botão Testar não funciona; o worker pode ter a dele).',
    comoFazer: amb.placesKey
      ? null
      : 'Coloque GOOGLE_PLACES_KEY na api (para testar) e nos workers de descoberta e enriquecimento.',
    testavel: !!amb.placesKey,
  });
  lista.push({
    id: 'buscas',
    nome: 'Busca no Google · Serper',
    papel: 'Acha site, Instagram, LinkedIn e contatos dos leads (worker-enriquecimento).',
    estado: u.buscas_7d > 0 ? (mes.serper >= planos.serper.creditos ? 'aviso' : 'ok') : 'aviso',
    detalhe:
      u.buscas_7d > 0
        ? `${n(mes.serper)} de ${n(planos.serper.creditos)} créditos no mês`
        : 'Nenhuma busca registrada nos últimos 7 dias.',
    comoFazer:
      u.buscas_7d > 0
        ? mes.serper >= planos.serper.creditos
          ? 'Os créditos do mês acabaram: compre mais no painel do Serper e atualize em Planos dos serviços.'
          : null
        : 'Se há campanhas rodando, confira SERPER_API_KEY no worker-enriquecimento.',
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

  // Instagram e cadastros dos anúncios (app da Meta)
  const temMeta = !!(amb.metaAppId && amb.metaAppSecret);
  const { rows: ig } = await pool.query<{ contas: number; cadastros: number; directs: number }>(
    `SELECT (SELECT count(*)::int FROM comercial.instagram_contas WHERE ig_id IS NOT NULL) AS contas,
            (SELECT count(*)::int FROM comercial.instagram_cadastros WHERE criado_em > now() - interval '30 days') AS cadastros,
            (SELECT count(*)::int FROM comercial.instagram_interacoes
              WHERE direct = 'enviado' AND comentado_em > now() - interval '30 days') AS directs`,
  );
  const retorno = enderecoDeRetorno(deps.origens);
  const webhook = `${deps.origens[0]}/api/meta/webhook`;
  lista.push({
    id: 'meta',
    nome: 'Instagram e anúncios · Meta',
    papel:
      'Conecta o Instagram dos clientes: "comente e receba", direct na conversa e os cadastros dos formulários dos anúncios.',
    estado: !temMeta ? 'falta' : amb.metaTokenVerificacao ? 'ok' : 'aviso',
    detalhe: temMeta
      ? `${n(ig[0]?.contas ?? 0)} ${ig[0]?.contas === 1 ? 'conta conectada' : 'contas conectadas'} · ${n(ig[0]?.directs ?? 0)} directs e ${n(ig[0]?.cadastros ?? 0)} cadastros em 30 dias`
      : 'Sem o app da Meta: a tela do Instagram explica que a integração ainda não foi liberada.',
    comoFazer: !temMeta
      ? `No developers.facebook.com: crie um app do tipo Empresa, adicione "Login do Facebook para Empresas", "Instagram" e "Webhooks". Coloque META_APP_ID e META_APP_SECRET na api do Railway e META_TOKEN_WEBHOOK (uma senha que você inventa). Em Login › URIs de redirecionamento: ${retorno}. Em Webhooks (objetos Instagram: comments e messages; Page: leadgen): ${webhook} com a mesma senha. Para os clientes usarem, o app precisa passar pela Análise do app da Meta.`
      : amb.metaTokenVerificacao
        ? null
        : `Falta META_TOKEN_WEBHOOK: sem ela não dá para cadastrar o webhook (${webhook}) na Meta.`,
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
