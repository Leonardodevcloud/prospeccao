import {
  type AvaliacaoIa,
  consultaPrincipal,
  contatosDosDiretorios,
  instagramNosResultados,
  interpretarLinkedin,
  nomeDeBusca,
  normalizarSite,
  type PerfilInstagram,
  palavrasDaEmpresa,
  perfilDoSocio,
  pessoasDaEmpresa,
  provarPessoa,
  type ResultadoGoogle,
  type ResultadoSite,
  siteProprioNosResultados,
} from '@prospeccao/integrations/enriquecimento';
import { ErroDefinitivo } from '@prospeccao/queue';
import { formatarTelefone, normalizarTelefone } from '@prospeccao/shared';
import { Coletor, notaPorRegras, papelPeloCargo } from './coletor.js';
import type { Deps } from './dependencias.js';
import * as repo from './repositorio.js';

/** E-mail de escritório de contabilidade cadastrado na Receita: não é da empresa. */
const EMAIL_CONTADOR = /contab|contador|escritorio|assessoria|consultoria/i;

function anosDesde(data: string | null): number | null {
  if (!data) return null;
  const anos = (Date.now() - new Date(data).getTime()) / (365.25 * 86_400_000);
  return Number.isFinite(anos) ? Math.floor(anos) : null;
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** A busca no Google pelo Apify às vezes estoura o tempo do ator: uma segunda tentativa resolve quase sempre. */
async function buscarComRetentativa(
  google: { buscar(consultas: string[]): Promise<Map<string, ResultadoGoogle[]>> },
  consultas: string[],
): Promise<Map<string, ResultadoGoogle[]>> {
  try {
    return await google.buscar(consultas);
  } catch (erro) {
    if (!/TIMED-OUT|timeout|tempo esgotado/i.test(mensagemDe(erro))) throw erro;
    return google.buscar(consultas);
  }
}

/** Erro da busca no Google (Serper ou Apify) em português curto, sem o JSON bruto. */
function explicarFalhaBusca(erro: unknown, provedor = 'Apify'): string {
  const msg = mensagemDe(erro);
  if (/TIMED-OUT|timeout|tempo esgotado/i.test(msg))
    return `A busca no Google (${provedor}) demorou demais duas vezes. Use "Enriquecer de novo" mais tarde.`;
  if (/HTTP 402|usage|credit|limit/i.test(msg)) return `Sem crédito no ${provedor} para a busca no Google.`;
  if (/HTTP 401|HTTP 403|token|api key|unauthorized/i.test(msg))
    return `Chave recusada pelo ${provedor} (${provedor === 'Serper' ? 'SERPER_API_KEY' : 'APIFY_TOKEN'}).`;
  return `Busca no Google falhou: ${msg.slice(0, 160)}`;
}

/** Erro do Google Places em português curto. */
function explicarFalhaPlaces(erro: unknown): string {
  const msg = mensagemDe(erro);
  if (/HTTP 403|PERMISSION_DENIED|API key/i.test(msg))
    return 'Google recusou a GOOGLE_PLACES_KEY (ative a "Places API (New)" e o faturamento no projeto).';
  if (/HTTP 429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'Cota do Google Places esgotada por agora.';
  return `Google Places falhou: ${msg.slice(0, 160)}`;
}

/** Link de uma busca no Google, para conferir na mão o que o robô viu. */
const linkGoogle = (consulta: string) => `https://www.google.com/search?q=${encodeURIComponent(consulta)}`;

/**
 * Cascata de enriquecimento de uma empresa, das fontes grátis para as que custam:
 * Receita → Maps → site → Instagram → IA (nota) → LinkedIn e Places (só A/B) → WhatsApp.
 * Cada etapa registra o que achou ou por que foi pulada; falha numa fonte não derruba a rodada.
 */
export async function enriquecerEmpresa(
  deps: Deps,
  job: { empresaId: number; campanhaId: number; forcar?: boolean },
): Promise<'feito' | 'pulado'> {
  const { pool, fontes, ajustes } = deps;
  const { empresaId, campanhaId } = job;
  const log = deps.log.child({ empresaId, campanhaId });

  const empresa = await repo.obterEmpresa(pool, empresaId, campanhaId);
  if (!empresa) throw new ErroDefinitivo(`Empresa ${empresaId} não está na campanha ${campanhaId}`);
  const campanha = await repo.obterCampanha(pool, campanhaId);
  if (!campanha) throw new ErroDefinitivo(`Campanha ${campanhaId} não existe`);
  if (!job.forcar && (await repo.enriquecidaRecentemente(pool, empresaId, ajustes.refazerDias))) {
    log.info('enriquecida há pouco; pulando');
    return 'pulado';
  }
  // Limite de leads do plano da conta: o lead espera (volta para a fila quando der) e nada é gasto.
  if (deps.contaId != null && (await repo.semVagaDeLeads(pool, deps.contaId, empresaId))) {
    await repo.aguardarLimite(pool, empresaId, campanhaId);
    log.info('conta no limite de leads do plano; o lead espera');
    return 'pulado';
  }

  await repo.iniciar(pool, empresaId, campanhaId);
  const c = new Coletor();
  let ordem = 0;
  const etapa = (
    nome: repo.NomeEtapa,
    status: repo.StatusEtapa,
    detalhe: string,
    url: string | null = null,
  ) => repo.registrarEtapa(pool, empresaId, ++ordem, nome, status, detalhe, url);

  try {
    // 1. Receita: sócios (quem administra) e contatos cadastrados.
    let socios: repo.Socio[] = [];
    if (empresa.cnpj_basico) {
      socios = await repo.obterSocios(pool, empresa.cnpj_basico);
      for (const s of socios) {
        c.pessoa({
          nome: s.nome,
          fonte: 'receita',
          cargo: s.qualificacao,
          papel: 'socio',
          prioridadeReceita: s.prioridade,
          desde: s.data_entrada,
        });
      }
      // Telefone da Receita é o da abertura do CNPJ: quanto mais velha a empresa, menos vale.
      const anosCnpj = anosDesde(empresa.data_abertura);
      const antigo = anosCnpj != null && anosCnpj >= 5;
      for (const t of empresa.telefones_receita) {
        c.contato({
          canal: 'telefone',
          valor: t,
          fonte: 'receita',
          confianca: antigo ? 20 : 35,
          rotulo: antigo
            ? `Cadastro na Receita (CNPJ de ${anosCnpj} anos, pode estar desatualizado)`
            : 'Cadastro na Receita',
        });
      }
      const email = empresa.email_receita?.toLowerCase();
      if (email) {
        const doContador = EMAIL_CONTADOR.test(email);
        c.contato({
          canal: 'email',
          valor: email,
          fonte: 'receita',
          confianca: doContador ? 15 : 40,
          rotulo: doContador ? 'Pode ser do contador' : 'Cadastro na Receita',
          status: doContador ? 'atencao' : 'nao_verificado',
        });
      }
      await etapa(
        'receita',
        socios.length ? 'encontrado' : 'sem_resultado',
        socios.length
          ? `${socios.length} ${socios.length === 1 ? 'sócio' : 'sócios'} no quadro da Receita; ${empresa.telefones_receita.length} telefone(s) cadastrado(s).`
          : 'Quadro de sócios vazio na base importada.',
      );
    } else {
      await etapa('receita', 'pulada', 'Lead veio só do Google Maps, sem CNPJ: sem quadro de sócios.');
    }

    // 2. Google Maps: já coletado na descoberta. Quem veio da base de CNPJ e não apareceu nas
    // buscas da campanha é procurado no Google pelo nome e endereço (1 pedido ao Places).
    let achadaPorNome = false;
    let achadaVia: 'serper' | 'places' = 'places';
    let semMaps = 'Não apareceu nas buscas do Maps.';
    let falhaMaps = false;
    if (!empresa.place_id && fontes.lugar && ajustes.acharNoGoogle) {
      try {
        const r = await fontes.lugar.achar({
          nome: empresa.nome,
          razaoSocial: empresa.razao_social,
          logradouro: empresa.logradouro,
          numero: empresa.numero,
          bairro: empresa.bairro,
          cep: empresa.cep,
          cidade: empresa.cidade,
          uf: empresa.uf,
          telefones: empresa.telefones_receita,
        });
        if (r.lugar) {
          achadaPorNome = true;
          achadaVia = r.fonte ?? 'places';
          empresa.place_id = r.lugar.placeId;
          empresa.maps_url = r.lugar.url;
          empresa.maps_telefone = r.lugar.telefone;
          empresa.maps_site = r.lugar.site;
          empresa.maps_nota = r.lugar.nota;
          empresa.maps_avaliacoes = r.lugar.avaliacoes;
          empresa.maps_categoria = r.lugar.categoria;
          empresa.maps_fechada = r.lugar.fechada;
        } else {
          semMaps = r.candidatos
            ? `O Google trouxe ${r.candidatos} lugar(es) para "${r.texto}", mas nenhum com o nome e o endereço desta empresa.`
            : `Nada no Google para "${r.texto}".`;
        }
      } catch (erro) {
        falhaMaps = true;
        semMaps = explicarFalhaPlaces(erro);
      }
    } else if (!empresa.place_id && fontes.lugar && !ajustes.acharNoGoogle) {
      semMaps +=
        ' A busca pelo nome e endereço está desligada (ENRIQ_ACHAR_NO_GOOGLE=false no worker-enriquecimento).';
    } else if (!empresa.place_id && !fontes.lugar) {
      semMaps +=
        ' Com SERPER_API_KEY ou GOOGLE_PLACES_KEY no worker-enriquecimento, o sistema procura pelo nome e endereço.';
    }
    const telMaps = normalizarTelefone(empresa.maps_telefone);
    c.contato({
      canal: 'telefone',
      valor: telMaps,
      fonte: achadaPorNome ? 'places' : 'maps',
      confianca: 70,
      rotulo: 'Telefone no Google',
    });
    const siteMaps = normalizarSite(empresa.maps_site);
    const achadosMaps =
      [
        telMaps ? 'telefone' : null,
        siteMaps ? 'site' : null,
        empresa.maps_nota ? `nota ${empresa.maps_nota}` : null,
        empresa.maps_avaliacoes ? `${empresa.maps_avaliacoes} avaliações` : null,
      ]
        .filter(Boolean)
        .join(', ') || 'sem telefone nem site no Google';
    await etapa(
      'maps',
      empresa.place_id ? 'encontrado' : falhaMaps ? 'erro' : 'sem_resultado',
      empresa.place_id
        ? achadaPorNome
          ? `Achada no Google Maps pelo nome e endereço${achadaVia === 'serper' ? ' (via Serper)' : ''}: ${achadosMaps}.`
          : `Encontrada nas buscas da campanha: ${achadosMaps}.`
        : semMaps,
      empresa.maps_url,
    );

    // 3. Razão social no Google, lida como uma pessoa leria: diretórios de empresas (AutoGuiaBR,
    // Lavrale, Econodata…) citam telefone e e-mail no próprio trecho; o painel traz o telefone da
    // loja; e a IA lê a página inteira atrás do Instagram, do site e de quem é dono ou comprador.
    // A mesma busca poupa a busca separada do Instagram e dá o site quando o Maps não tem.
    // Busca principal como uma pessoa digitaria: a marca entre aspas, o ramo e a cidade
    // ("GEFPEL" autopeças salvador). Ela costuma trazer de uma vez o site, o Instagram, o LinkedIn
    // de quem trabalha lá e os diretórios. A razão social só é buscada se a principal não achar nada
    // desta empresa.
    const nome = nomeDeBusca(empresa.nome, empresa.razao_social);
    const palavrasEmpresa = palavrasDaEmpresa(empresa.nome, empresa.razao_social);
    let consultaDiretorios: string | null = null;
    let instagramBusca: string | null = null;
    let siteBusca: string | null = null;
    /** Resultados do LinkedIn que já vieram nas buscas do Google (sem custo extra). */
    const linkedinDaBusca: ResultadoGoogle[] = [];
    if (fontes.diretorios) {
      try {
        let d = await fontes.diretorios.buscar({
          nome: empresa.nome,
          razaoSocial: empresa.razao_social,
          cidade: empresa.cidade,
          consulta: consultaPrincipal(empresa.nome, empresa.razao_social, empresa.cidade),
        });
        const falaDaEmpresa = (r: ResultadoGoogle) => {
          const t = `${r.titulo} ${r.descricao} ${r.url}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          return palavrasEmpresa.some((p) => t.includes(p));
        };
        if (!d.resultados.some(falaDaEmpresa) && empresa.razao_social) {
          // Nada desta empresa pela marca: tenta a razão social (diretórios de CNPJ).
          const r2 = await fontes.diretorios.buscar({
            nome: empresa.nome,
            razaoSocial: empresa.razao_social,
            cidade: empresa.cidade,
          });
          d = { ...r2, painel: r2.painel ?? d.painel };
        }
        consultaDiretorios = d.consulta;
        linkedinDaBusca.push(...d.resultados.filter((r) => /linkedin\.com\//i.test(r.url)));
        const achados = contatosDosDiretorios(d.resultados, palavrasEmpresa);
        for (const a of achados) {
          c.contato({
            canal: a.canal,
            valor: a.valor,
            fonte: 'google',
            confianca: a.canal === 'email' ? 55 : 50,
            rotulo: `Em ${a.dominio}`,
            urlOrigem: a.url,
          });
        }
        if (d.painel?.telefone)
          c.contato({
            canal: 'telefone',
            valor: d.painel.telefone,
            fonte: 'google',
            confianca: 70,
            rotulo: 'Painel do Google',
          });
        instagramBusca = instagramNosResultados(d.resultados, empresa.nome);
        // O próprio site aparece entre os resultados (alcoolmaq.com.br): não depende da IA apontar.
        siteBusca = siteProprioNosResultados(d.resultados, palavrasEmpresa);

        // A IA lê os resultados; o que ela devolve só vale se estiver escrito na busca.
        const daIa: string[] = [];
        if (fontes.ia?.lerBusca && d.resultados.length) {
          try {
            const l = await fontes.ia.lerBusca({
              empresa: {
                nome: empresa.nome,
                razaoSocial: empresa.razao_social,
                cidade: empresa.cidade,
                uf: empresa.uf,
                endereco:
                  [empresa.logradouro, empresa.numero, empresa.bairro].filter(Boolean).join(', ') || null,
              },
              resultados: d.resultados,
            });
            if (!l.mesmaEmpresa) {
              daIa.push('a IA viu que os resultados são de outra empresa');
            } else {
              if (!instagramBusca && l.instagram) {
                instagramBusca = l.instagram;
                daIa.push(`Instagram @${l.instagram}`);
              }
              if (l.site && !siteBusca) {
                siteBusca = l.site;
                daIa.push(`site ${l.site}`);
              }
              for (const t of l.telefones) {
                c.contato({
                  canal: 'telefone',
                  valor: t,
                  fonte: 'google',
                  confianca: 55,
                  rotulo: 'Na busca do Google',
                  urlOrigem: linkGoogle(d.consulta),
                });
              }
              for (const em of l.emails) {
                c.contato({
                  canal: 'email',
                  valor: em,
                  fonte: 'google',
                  confianca: 55,
                  rotulo: 'Na busca do Google',
                  urlOrigem: linkGoogle(d.consulta),
                });
              }
              for (const p of l.pessoas) {
                c.pessoa({
                  nome: p.nome,
                  cargo: p.cargo,
                  papel: papelPeloCargo(p.cargo),
                  fonte: 'google',
                  urlOrigem: linkGoogle(d.consulta),
                  evidencia: p.evidencia,
                });
                daIa.push(`${p.nome} (${p.cargo})`);
              }
            }
          } catch (erro) {
            log.warn({ err: erro }, 'a IA não conseguiu ler a busca do Google');
          }
        }
        const partes = [
          instagramBusca && !daIa.includes(`Instagram @${instagramBusca}`)
            ? `Instagram @${instagramBusca}`
            : null,
          siteBusca && !daIa.includes(`site ${siteBusca}`) ? `site ${siteBusca}` : null,
          d.painel?.telefone ? `telefone ${formatarTelefone(d.painel.telefone)} no painel do Google` : null,
          ...achados
            .slice(0, 4)
            .map((a) =>
              a.canal === 'telefone'
                ? `telefone ${formatarTelefone(a.valor)} em ${a.dominio}`
                : `e-mail ${a.valor} em ${a.dominio}`,
            ),
        ].filter(Boolean);
        const leuIa = daIa.length ? ` A IA leu a busca: ${daIa.join(', ')}.` : '';
        await etapa(
          'google',
          partes.length || daIa.some((x) => !x.startsWith('a IA viu')) ? 'encontrado' : 'sem_resultado',
          (partes.length
            ? `${partes.join('; ')}${achados.length > 4 ? ` e mais ${achados.length - 4}` : ''}.`
            : `${d.resultados.length} resultado(s) para a razão social, sem telefone ou e-mail desta empresa nos trechos.`) +
            leuIa,
          linkGoogle(d.consulta),
        );
      } catch (erro) {
        await etapa('google', 'erro', explicarFalhaBusca(erro, 'Serper'));
      }
    }

    // 3b. Site da empresa (do Maps; se não tiver, o que a busca da razão social mostrou).
    const siteParaLer = siteMaps ?? siteBusca;
    let site: ResultadoSite | null = null;
    let instagram: string | null = null;
    let facebook: string | null = null;
    let linkedinEmpresa: string | null = null;
    let cnpjAchado: string | null = null;
    if (siteParaLer) {
      try {
        site = await fontes.site.ler(siteParaLer);
      } catch (erro) {
        log.warn({ err: erro }, 'falha ao ler o site');
      }
    }
    if (site) {
      const url = site.urlFinal;
      c.contato({
        canal: 'site',
        valor: normalizarSite(url) ?? url,
        fonte: 'site',
        confianca: 90,
        urlOrigem: url,
        // O site abriu e foi lido: existe e está no ar.
        status: 'verificado',
      });
      for (const w of site.whatsapps) {
        c.contato({
          canal: 'whatsapp',
          valor: w,
          fonte: 'site',
          confianca: 80,
          rotulo: 'Botão de WhatsApp do site',
          urlOrigem: url,
        });
      }
      for (const t of site.telefones) {
        c.contato({
          canal: 'telefone',
          valor: t,
          fonte: 'site',
          confianca: 60,
          rotulo: 'No site',
          urlOrigem: url,
        });
      }
      const dominioSite = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      for (const e of site.emails.slice(0, 5)) {
        const setor = e.split('@')[0] ?? '';
        const doDominio = !!dominioSite && (e.split('@')[1] ?? '') === dominioSite;
        c.contato({
          canal: 'email',
          valor: e,
          fonte: 'site',
          confianca: /compr/.test(setor) ? 80 : doDominio ? 75 : 65,
          rotulo: /compr/.test(setor) ? 'Compras' : doDominio ? 'E-mail do domínio da empresa' : null,
          urlOrigem: url,
          // Publicado no próprio site, com o domínio da empresa: é dela.
          status: doDominio ? 'verificado' : undefined,
        });
      }
      instagram = site.instagram;
      facebook = site.facebook;
      linkedinEmpresa = site.linkedinEmpresa;
      if (!empresa.cnpj) cnpjAchado = site.cnpjs[0] ?? null;
      for (const l of site.linkedinPessoas.slice(0, 5)) {
        c.contato({ canal: 'linkedin', valor: l, fonte: 'site', confianca: 60, urlOrigem: url });
      }
      const achados = [
        site.whatsapps.length ? `${site.whatsapps.length} WhatsApp` : null,
        site.telefones.length ? `${site.telefones.length} telefone(s)` : null,
        site.emails.length ? `${site.emails.length} e-mail(s)` : null,
        instagram ? `Instagram @${instagram}` : null,
        cnpjAchado ? 'CNPJ no rodapé' : null,
      ].filter(Boolean);
      await etapa(
        'site',
        achados.length ? 'encontrado' : 'sem_resultado',
        achados.length
          ? `${site.paginas.length} página(s) lida(s): ${achados.join(', ')}.`
          : `${site.paginas.length} página(s) lida(s), sem contatos no texto.`,
        url,
      );
    } else if (siteParaLer) {
      // O site existe (está no Google), só não deixou o robô ler: comum em sites com proteção
      // contra robôs. Ele entra nos contatos e a trilha não diz que "falhou".
      c.contato({
        canal: 'site',
        valor: normalizarSite(siteParaLer) ?? siteParaLer,
        fonte: siteMaps ? 'maps' : 'google',
        confianca: 80,
        urlOrigem: siteParaLer,
      });
      await etapa(
        'site',
        'encontrado',
        `${(normalizarSite(siteParaLer) ?? siteParaLer).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}: o site existe, mas bloqueia a leitura automática. Os contatos dele não entraram; abra o link para ver.`,
        siteParaLer,
      );
    } else {
      await etapa('site', 'pulada', 'Sem site no Google.', null);
    }
    if (!instagram) instagram = instagramBusca;

    // 4. Instagram: pelo site, pela busca da razão social; se não, procura no Google.
    let perfil: PerfilInstagram | null = null;
    let falhaBuscaInstagram: string | null = null;
    const consultaInstagram = `"${nome.nucleo}" ${empresa.cidade.toLowerCase()} instagram`;
    if (!instagram && fontes.google && ajustes.buscarInstagram) {
      try {
        const r = await fontes.google.buscar([consultaInstagram]);
        const res = r.get(consultaInstagram) ?? [];
        instagram = instagramNosResultados(res, empresa.nome);
        linkedinDaBusca.push(...res.filter((x) => /linkedin\.com\//i.test(x.url)));
      } catch (erro) {
        log.warn({ err: erro }, 'falha ao procurar o Instagram no Google');
        falhaBuscaInstagram = explicarFalhaBusca(erro, fontes.google.nome);
      }
    }
    if (instagram && fontes.instagram) {
      let falhou = false;
      try {
        perfil = await fontes.instagram.ler(instagram);
      } catch (erro) {
        falhou = true;
        await etapa('instagram', 'erro', `@${instagram}: ${mensagemDe(erro)}`);
      }
      if (!perfil && !falhou) {
        await etapa('instagram', 'sem_resultado', `@${instagram} não abriu (perfil privado ou removido).`);
      }
      if (perfil) {
        const url = `https://www.instagram.com/${perfil.usuario}/`;
        c.contato({
          canal: 'instagram',
          valor: url,
          fonte: 'instagram',
          confianca: 85,
          rotulo: `@${perfil.usuario}`,
          urlOrigem: url,
          // O perfil abriu e foi lido.
          status: 'verificado',
        });
        for (const w of perfil.whatsapps) {
          c.contato({
            canal: 'whatsapp',
            valor: w,
            fonte: 'instagram',
            confianca: 80,
            rotulo: 'Link da bio',
            urlOrigem: url,
          });
        }
        c.contato({
          canal: 'telefone',
          valor: perfil.telefone,
          fonte: 'instagram',
          confianca: 70,
          rotulo: 'Contato do perfil comercial',
          urlOrigem: url,
        });
        for (const t of perfil.telefonesNaBio) {
          c.contato({
            canal: 'telefone',
            valor: t,
            fonte: 'instagram',
            confianca: 65,
            rotulo: 'Na bio',
            urlOrigem: url,
          });
        }
        for (const e of [perfil.email, ...perfil.emailsNaBio]) {
          c.contato({ canal: 'email', valor: e, fonte: 'instagram', confianca: 70, urlOrigem: url });
        }
        if (!empresa.cnpj) cnpjAchado ??= perfil.cnpjs[0] ?? null;

        // Link da bio: abre a página (Linktree, Beacons, site…) e pega os botões de WhatsApp,
        // telefones e e-mails, seja qual for o modelo da página. Pula se for o site já lido.
        const daBio: string[] = [];
        const hostDe = (u: string | null | undefined) => {
          try {
            return u ? new URL(u).hostname.replace(/^www\./, '') : null;
          } catch {
            return null;
          }
        };
        const linkBio = perfil.link;
        if (linkBio && fontes.site.lerLinks && hostDe(linkBio) !== hostDe(site?.urlFinal)) {
          try {
            const pagina = await fontes.site.lerLinks(linkBio);
            if (pagina) {
              const origem = pagina.urlFinal || linkBio;
              for (const w of pagina.whatsapps) {
                c.contato({
                  canal: 'whatsapp',
                  valor: w,
                  fonte: 'instagram',
                  confianca: 80,
                  rotulo: 'Botão no link da bio',
                  urlOrigem: origem,
                });
              }
              for (const t of pagina.telefones.slice(0, 5)) {
                c.contato({
                  canal: 'telefone',
                  valor: t,
                  fonte: 'instagram',
                  confianca: 60,
                  rotulo: 'No link da bio',
                  urlOrigem: origem,
                });
              }
              for (const e of pagina.emails.slice(0, 5)) {
                c.contato({
                  canal: 'email',
                  valor: e,
                  fonte: 'instagram',
                  confianca: 60,
                  rotulo: 'No link da bio',
                  urlOrigem: origem,
                });
              }
              if (pagina.whatsapps.length) daBio.push(`${pagina.whatsapps.length} WhatsApp`);
              if (pagina.telefones.length) daBio.push(`${pagina.telefones.length} telefone(s)`);
              if (pagina.emails.length) daBio.push(`${pagina.emails.length} e-mail(s)`);
            }
          } catch (erro) {
            log.warn({ err: erro, link: linkBio }, 'não consegui abrir o link da bio');
          }
        }
        const bioTexto = linkBio
          ? daBio.length
            ? ` Link da bio (${hostDe(linkBio) ?? linkBio}): ${daBio.join(', ')}.`
            : ` Link da bio (${hostDe(linkBio) ?? linkBio}) sem contatos legíveis.`
          : '';
        await etapa(
          'instagram',
          'encontrado',
          `@${perfil.usuario}${perfil.seguidores != null ? `, ${perfil.seguidores} seguidores` : ''}${perfil.whatsapps.length ? ', WhatsApp na bio' : ''}.${bioTexto}`,
          url,
        );
      }
    } else if (instagram) {
      await etapa(
        'instagram',
        'pulada',
        `@${instagram} encontrado, mas sem APIFY_TOKEN para ler o perfil.`,
        `https://www.instagram.com/${instagram}/`,
      );
    } else if (falhaBuscaInstagram) {
      // Não é "não tem Instagram": a busca nem rodou.
      await etapa('instagram', 'erro', falhaBuscaInstagram, linkGoogle(consultaInstagram));
    } else if (consultaDiretorios) {
      await etapa(
        'instagram',
        'sem_resultado',
        'Nem o site, nem a busca da razão social, nem a busca pelo nome com "instagram" trouxeram um perfil desta empresa.',
        linkGoogle(consultaInstagram),
      );
    } else {
      const buscou = !!fontes.google && ajustes.buscarInstagram;
      await etapa(
        'instagram',
        buscou ? 'sem_resultado' : 'pulada',
        buscou
          ? 'O site não indica e o Google não trouxe um perfil com o nome desta empresa.'
          : 'Sem busca no Google configurada (SERPER_API_KEY ou APIFY_TOKEN).',
        buscou ? linkGoogle(consultaInstagram) : null,
      );
    }

    // 5. Nota: IA (Gemini) ou regras.
    let avaliacao: AvaliacaoIa | null = null;
    if (fontes.ia) {
      try {
        avaliacao = await fontes.ia.avaliar({
          nicho: campanha.nicho_nome,
          vendedor: campanha.conta_nome
            ? { nome: campanha.conta_nome, oferta: campanha.oferta || null }
            : undefined,
          empresa: {
            nome: empresa.nome,
            razaoSocial: empresa.razao_social,
            cidade: empresa.cidade,
            uf: empresa.uf,
            porte: empresa.porte,
            abertaHaAnos: anosDesde(empresa.data_abertura),
            categoriaMaps: empresa.maps_categoria,
            notaMaps: empresa.maps_nota,
            avaliacoesMaps: empresa.maps_avaliacoes,
            sinalEntregaMaps: empresa.sinal_entrega,
            temSite: !!site,
            temInstagram: !!perfil,
            seguidoresInstagram: perfil?.seguidores ?? null,
          },
          socios: socios.map((s) => ({ nome: s.nome, qualificacao: s.qualificacao })),
          cargosAlvo: campanha.cargos_alvo,
          contatos: (() => {
            const todos = [...c.contatos.values()];
            const n = (canal: string) => todos.filter((x) => x.canal === canal).length;
            return {
              whatsapp: n('whatsapp'),
              telefones: n('telefone'),
              emails: n('email'),
              instagram: !!perfil,
              site: !!site,
            };
          })(),
          textoSite: site?.texto ?? null,
          bioInstagram: perfil?.bio ?? null,
        });
      } catch (erro) {
        await etapa('ia', 'erro', `Gemini falhou (${mensagemDe(erro)}); nota por regras.`);
      }
    }
    const temWhatsapp = [...c.contatos.values()].some((x) => x.canal === 'whatsapp');
    const regras = notaPorRegras({
      avaliacoes: empresa.maps_avaliacoes,
      nota: empresa.maps_nota,
      entrega: empresa.sinal_entrega,
      temWhatsapp,
      temInstagram: !!perfil,
      temSite: !!site,
      anos: anosDesde(empresa.data_abertura),
      porte: empresa.porte,
    });
    let faixa = avaliacao?.faixa ?? regras.faixa;
    let score = avaliacao?.score ?? regras.score;
    let motivo = avaliacao?.motivo ?? regras.motivo;
    if (avaliacao) {
      // Nome citado no site só entra com prova: cargo ao lado do nome e fora de depoimentos.
      const recusadas: string[] = [];
      for (const p of avaliacao.pessoas) {
        const prova = provarPessoa(p, [site?.texto, perfil?.bio]);
        if (!prova.aceita) {
          recusadas.push(p.nome);
          log.debug({ nome: p.nome, motivo: prova.motivo }, 'pessoa citada descartada');
          continue;
        }
        c.pessoa({
          nome: p.nome,
          cargo: p.cargo,
          papel: p.papel,
          fonte: 'site',
          urlOrigem: site?.urlFinal ?? null,
          evidencia: prova.evidencia,
        });
      }
      const descarte = recusadas.length
        ? ` Ignorei ${recusadas.length} nome(s) do site sem cargo comprovado (ex.: depoimentos de clientes).`
        : '';
      await etapa('ia', 'encontrado', `Nota ${faixa} (${score}): ${motivo.replace(/\.$/, '')}.${descarte}`);
    } else if (!fontes.ia) {
      await etapa('ia', 'pulada', `IA não configurada nesta conta. ${motivo}`);
    }

    // 6. LinkedIn: aproveita os perfis que já vieram nas buscas do Google (sem custo). Só leads
    // que valem a busca ganham UMA busca a mais ("site:linkedin.com" + marca), e só se nada veio.
    // Sócio não ganha busca própria: o nome dele é procurado nos perfis achados. Perfil só entra se
    // o próprio LinkedIn disser que a pessoa trabalha NESTA empresa (homônimos são comuns).
    const consultaLinkedin = `site:linkedin.com "${nome.nucleo}"`;
    const palavras = palavrasEmpresa;
    const temLinkedin = (lista: ResultadoGoogle[]) =>
      pessoasDaEmpresa(lista, palavras).length > 0 ||
      lista.some((x) => /linkedin\.com\/company\//i.test(x.url));
    const podeBuscar = ajustes.faixasLinkedin.has(faixa) && !!fontes.google;
    if (!palavras.length) {
      // "Js Peças", "Auto Peças Salvador": nada no nome que diferencie de outras lojas.
      await etapa(
        'linkedin',
        'pulada',
        'Nome da empresa genérico demais para confirmar no LinkedIn quem trabalha nela.',
      );
    } else if (!podeBuscar && !temLinkedin(linkedinDaBusca)) {
      await etapa(
        'linkedin',
        'pulada',
        !fontes.google
          ? 'Sem busca no Google configurada (SERPER_API_KEY ou APIFY_TOKEN).'
          : `Nada do LinkedIn na busca principal; a busca própria é só para leads ${[...ajustes.faixasLinkedin].join(' e ')}.`,
      );
    } else {
      try {
        const resultadosEmpresa = [...linkedinDaBusca];
        let buscou = false;
        if (!temLinkedin(resultadosEmpresa) && podeBuscar && fontes.google) {
          const r0 = await buscarComRetentativa(fontes.google, [consultaLinkedin]);
          resultadosEmpresa.push(...(r0.get(consultaLinkedin) ?? []));
          buscou = true;
        }
        const admins = socios.filter((s) => s.prioridade === 1);
        let achadas = 0;
        const aceitos: string[] = [];
        const urlsAceitas = new Set<string>();
        for (const p of pessoasDaEmpresa(resultadosEmpresa, palavras)) {
          if (urlsAceitas.has(p.url)) continue;
          urlsAceitas.add(p.url);
          aceitos.push(p.cargo ? `${p.nome} (${p.cargo})` : p.nome);
          const papel = papelPeloCargo(p.cargo);
          c.pessoa({
            nome: p.nome,
            cargo: p.cargo,
            papel,
            linkedin: p.url,
            fonte: 'linkedin',
            urlOrigem: p.url,
          });
          c.contato({
            canal: 'linkedin',
            valor: p.url,
            fonte: 'linkedin',
            confianca: 70,
            pessoa: p.nome,
            urlOrigem: p.url,
          });
          achadas++;
        }
        // Sócio: o nome dele entre os perfis já achados (sem busca por sócio).
        for (const s of admins) {
          const perfil = perfilDoSocio(s.nome, resultadosEmpresa, palavras);
          if (!perfil) continue;
          if (!urlsAceitas.has(perfil.url)) aceitos.push(`${s.nome} (sócio)`);
          c.pessoa({
            nome: s.nome,
            cargo: perfil.cargo,
            fonte: 'linkedin',
            linkedin: perfil.url,
            papel: 'socio',
            urlOrigem: perfil.url,
          });
          c.contato({
            canal: 'linkedin',
            valor: perfil.url,
            fonte: 'linkedin',
            confianca: 75,
            pessoa: s.nome,
            urlOrigem: perfil.url,
          });
          urlsAceitas.add(perfil.url);
        }
        const r = new Map([['_', resultadosEmpresa]]);
        achadas = urlsAceitas.size;
        // Página da empresa no LinkedIn (linkedin.com/company/…) com o nome da loja.
        const paginaEmpresa = resultadosEmpresa.find((x) => {
          if (!/linkedin\.com\/company\//i.test(x.url)) return false;
          const t = `${x.titulo} ${x.url}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          return palavras.some((w) => t.includes(w));
        });
        if (paginaEmpresa)
          c.contato({
            canal: 'linkedin',
            valor: paginaEmpresa.url.split('?')[0] ?? paginaEmpresa.url,
            fonte: 'linkedin',
            confianca: 70,
            rotulo: 'Página da empresa no LinkedIn',
            urlOrigem: paginaEmpresa.url,
          });
        const pagina = paginaEmpresa ? ' Página da empresa no LinkedIn encontrada.' : '';
        // Quantos perfis o Google trouxe no total: o que não entrou foi descartado de propósito.
        const vistos = new Set<string>();
        for (const lista of r.values())
          for (const x of lista) {
            const p = interpretarLinkedin(x);
            if (p) vistos.add(p.url);
          }
        const ignorados = Math.max(0, vistos.size - achadas);
        const motivoIgnorados = `não citam "${palavras.join(' ')}" no emprego atual (outra empresa ou homônimo)`;
        await etapa(
          'linkedin',
          achadas ? 'encontrado' : 'sem_resultado',
          achadas
            ? `${achadas} de ${vistos.size} perfil(is) trabalham nesta empresa: ${aceitos.join(', ')}.${ignorados ? ` ${ignorados} ignorado(s): ${motivoIgnorados}.` : ''}${pagina}`
            : vistos.size
              ? `O Google trouxe ${vistos.size} perfil(is), nenhum desta empresa: ${motivoIgnorados}.${pagina}`
              : `Nenhum perfil do LinkedIn no Google com o nome desta empresa.${pagina}`,
          // Achou a página da empresa: o link leva direto para ela, não para a busca.
          paginaEmpresa
            ? (paginaEmpresa.url.split('?')[0] ?? paginaEmpresa.url)
            : linkGoogle(buscou ? consultaLinkedin : (consultaDiretorios ?? consultaLinkedin)),
        );
      } catch (erro) {
        await etapa(
          'linkedin',
          'erro',
          explicarFalhaBusca(erro, fontes.google?.nome),
          linkGoogle(consultaLinkedin),
        );
      }
    }

    // 7. Google Places: a loja segue aberta? Telefone atualizado?
    let mapsAberto: boolean | null = empresa.maps_fechada == null ? null : !empresa.maps_fechada;
    if (achadaPorNome && achadaVia === 'serper' && !empresa.place_id?.startsWith('ChIJ')) {
      // O Serper não diz se a loja fechou; o resto (telefone, nota) já veio na busca.
      await etapa(
        'places',
        'encontrado',
        'Achada no Google Maps (via Serper); o Serper não informa se a loja está fechada.',
        empresa.maps_url,
      );
    } else if (achadaPorNome && achadaVia === 'places') {
      // A busca por nome e endereço já trouxe os dados atuais: não precisa de outra consulta.
      mapsAberto = !empresa.maps_fechada;
      if (empresa.maps_fechada) {
        faixa = 'C';
        score = Math.min(score, 20);
        motivo = `Fechada no Google. ${motivo}`;
      }
      await etapa(
        'places',
        'encontrado',
        empresa.maps_fechada
          ? 'Marcada como fechada no Google.'
          : 'Aberta no Google (conferido na busca por nome e endereço).',
        empresa.maps_url,
      );
    } else if (ajustes.faixasPlaces.has(faixa) && fontes.places && empresa.place_id) {
      try {
        const d = await fontes.places.detalhes(empresa.place_id);
        mapsAberto = d.aberto;
        c.contato({
          canal: 'telefone',
          valor: normalizarTelefone(d.telefone),
          fonte: 'places',
          confianca: 80,
          rotulo: 'Telefone no Google',
        });
        if (d.aberto === false) {
          faixa = 'C';
          score = Math.min(score, 20);
          motivo = `Fechada no Google. ${motivo}`;
        }
        await etapa(
          'places',
          'encontrado',
          d.aberto === false ? 'Marcada como fechada no Google.' : 'Aberta no Google, dados conferidos.',
        );
      } catch (erro) {
        await etapa('places', 'erro', explicarFalhaPlaces(erro));
      }
    } else {
      await etapa(
        'places',
        'pulada',
        !fontes.places
          ? 'Sem GOOGLE_PLACES_KEY.'
          : !empresa.place_id
            ? 'Empresa não achada no Google.'
            : `Só para leads ${[...ajustes.faixasPlaces].join(' e ')}.`,
      );
    }

    // 8. WhatsApp: quais números têm conta (consulta no chip, sem enviar mensagem).
    const numeros = c.telefonesParaConferir();
    if (fontes.whatsapp && numeros.length) {
      try {
        const r = await fontes.whatsapp.verificar(numeros);
        c.aplicarWhatsapp(r);
        const comConta = [...r.entries()].filter(([, tem]) => tem).map(([n]) => n);
        // Perfil comercial (WhatsApp Business): e-mail e site que a própria loja cadastrou, e a
        // confirmação de que o número é da loja (a descrição cita o nome da empresa).
        const notas: string[] = [];
        if (fontes.whatsapp.perfil) {
          const palavrasLoja = palavrasDaEmpresa(empresa.nome, empresa.razao_social);
          for (const numero of comConta.slice(0, 2)) {
            try {
              const p = await fontes.whatsapp.perfil(numero);
              if (!p) continue;
              const texto = `${p.descricao ?? ''} ${p.site ?? ''} ${p.email ?? ''}`
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
              const daLoja = palavrasLoja.some((w) => texto.includes(w));
              const url = `https://wa.me/55${numero}`;
              if (daLoja)
                c.contato({
                  canal: 'whatsapp',
                  valor: numero,
                  fonte: 'whatsapp',
                  confianca: 95,
                  rotulo: 'WhatsApp Business da loja',
                  urlOrigem: url,
                });
              c.contato({
                canal: 'email',
                valor: p.email,
                fonte: 'whatsapp',
                confianca: daLoja ? 80 : 60,
                rotulo: 'No WhatsApp Business',
                urlOrigem: url,
              });
              c.contato({
                canal: 'site',
                valor: normalizarSite(p.site),
                fonte: 'whatsapp',
                confianca: daLoja ? 80 : 55,
                urlOrigem: url,
              });
              const extra = [p.email ? `e-mail ${p.email}` : null, p.site ? `site ${p.site}` : null]
                .filter(Boolean)
                .join(', ');
              notas.push(
                `${formatarTelefone(numero)} é WhatsApp Business${daLoja ? ' desta empresa' : ''}${p.descricao ? ` ("${p.descricao.slice(0, 60)}${p.descricao.length > 60 ? '…' : ''}")` : ''}${extra ? `, com ${extra}` : ''}`,
              );
            } catch (erro) {
              log.debug({ err: erro, numero }, 'perfil comercial do WhatsApp indisponível');
            }
          }
        }
        await etapa(
          'whatsapp',
          comConta.length ? 'encontrado' : 'sem_resultado',
          `${comConta.length} de ${numeros.length} número(s) com WhatsApp.${notas.length ? ` ${notas.join('. ')}.` : ''}`,
        );
      } catch (erro) {
        await etapa('whatsapp', 'erro', mensagemDe(erro));
      }
    } else {
      await etapa(
        'whatsapp',
        'pulada',
        numeros.length ? 'Evolution API não configurada.' : 'Nenhum telefone para conferir.',
      );
    }

    // 9. Base paga (Direct Data): telefones atualizados, com tipo, operadora e WhatsApp. Só para as
    // faixas escolhidas e só quando nenhuma fonte trouxe um WhatsApp atual: não paga à toa.
    const whatsappAtual = [...c.contatos.values()].some(
      (x) =>
        x.canal === 'whatsapp' &&
        x.status === 'verificado' &&
        !(x.fontes.size === 1 && x.fontes.has('receita')),
    );
    if (fontes.basePaga && empresa.cnpj) {
      const faixasPagas = ajustes.faixasBasePaga ?? new Set<string>();
      if (!faixasPagas.has(faixa)) {
        await etapa(
          'base_paga',
          'pulada',
          `Só para leads ${[...faixasPagas].join(' e ') || '(nenhuma faixa)'}.`,
        );
      } else if (whatsappAtual) {
        await etapa(
          'base_paga',
          'pulada',
          'Já tem WhatsApp atual confirmado: não precisou consultar (economia).',
        );
      } else {
        try {
          const r = await fontes.basePaga.consultar(empresa.cnpj);
          for (const t of r.telefones) {
            c.contato({
              canal: t.whatsapp ? 'whatsapp' : 'telefone',
              valor: t.numero,
              fonte: 'base_paga',
              confianca: t.whatsapp ? 85 : 75,
              rotulo:
                [t.tipo, t.operadora, t.bloqueado ? 'no "Não Perturbe"' : null].filter(Boolean).join(' · ') ||
                'Base paga',
              status: t.bloqueado ? 'atencao' : undefined,
            });
          }
          for (const em of r.emails) {
            c.contato({ canal: 'email', valor: em, fonte: 'base_paga', confianca: 65, rotulo: 'Base paga' });
          }
          // Os números novos também passam pelo chip.
          const novos = r.telefones
            .map((t) => t.numero)
            .filter((n) => !numeros.includes(n))
            .slice(0, 6);
          if (fontes.whatsapp && novos.length) {
            try {
              c.aplicarWhatsapp(await fontes.whatsapp.verificar(novos));
            } catch (erro) {
              log.warn({ err: erro }, 'falha ao conferir no WhatsApp os números da base paga');
            }
          }
          await repo.registrarUsoBasePaga(
            pool,
            empresaId,
            fontes.basePaga.nome,
            fontes.basePaga.precoBrl,
            r.telefones.length + r.emails.length,
          );
          const celulares = r.telefones.filter((t) => t.tipo === 'celular').length;
          const comWhatsapp = r.telefones.filter((t) => t.whatsapp).length;
          const custo = fontes.basePaga.precoBrl.toFixed(2).replace('.', ',');
          await etapa(
            'base_paga',
            r.telefones.length || r.emails.length ? 'encontrado' : 'sem_resultado',
            r.telefones.length || r.emails.length
              ? `${r.telefones.length} telefone(s) (${celulares} celular, ${comWhatsapp} com WhatsApp) e ${r.emails.length} e-mail(s) na ${fontes.basePaga.nome}. Consulta: R$ ${custo}.`
              : `Nada na ${fontes.basePaga.nome} para este CNPJ. Consulta: R$ ${custo}.`,
          );
        } catch (erro) {
          const msg = mensagemDe(erro);
          await etapa(
            'base_paga',
            'erro',
            /HTTP 401|HTTP 403|token/i.test(msg)
              ? `${fontes.basePaga.nome} recusou o token (DIRECTD_TOKEN).`
              : /HTTP 402|saldo|cr[eé]dito/i.test(msg)
                ? `Sem saldo na ${fontes.basePaga.nome}.`
                : `${fontes.basePaga.nome} falhou: ${msg.slice(0, 160)}`,
          );
        }
      }
    }

    c.marcarReceitaAntiga(anosDesde(empresa.data_abertura));
    // Número de contador: o mesmo telefone em muitos CNPJs da base.
    try {
      const repetidos = await repo.empresasPorTelefone(pool, c.telefonesDeCadastro());
      for (const [numero, n] of repetidos) if (n >= ajustes.limiteContador) c.marcarContador(numero, n);
    } catch (erro) {
      log.warn({ err: erro }, 'não consegui conferir telefones repetidos na base');
    }
    // Seu retorno (número errado, não é quem decide) vale mais que qualquer fonte.
    const fb = await repo.feedbackDaEmpresa(pool, empresaId);
    c.aplicarFeedback(fb.invalidos, fb.naoDecisores);
    c.escolherDecisor();
    c.escolherPrincipal();
    await repo.concluir(pool, empresaId, c, {
      faixa,
      score,
      motivo,
      resumo: avaliacao?.resumo ?? null,
      entrega: avaliacao?.entrega ?? empresa.sinal_entrega,
      cnpjAchado,
      site: site?.urlFinal ?? siteParaLer,
      instagram,
      facebook,
      linkedinEmpresa,
      mapsAberto,
      maps: achadaPorNome
        ? {
            nota: empresa.maps_nota,
            avaliacoes: empresa.maps_avaliacoes,
            categoria: empresa.maps_categoria,
            url: empresa.maps_url,
          }
        : null,
    });
    log.info({ faixa, score, contatos: c.contatos.size, pessoas: c.pessoas.size }, 'empresa enriquecida');
    return 'feito';
  } catch (erro) {
    await repo.marcarErro(pool, empresaId, mensagemDe(erro));
    throw erro;
  }
}
