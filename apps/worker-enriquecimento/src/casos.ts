import {
  type AvaliacaoIa,
  instagramNosResultados,
  normalizarSite,
  type PerfilInstagram,
  palavrasDaEmpresa,
  perfilDoSocio,
  pessoasDaEmpresa,
  provarPessoa,
  type ResultadoGoogle,
  type ResultadoSite,
} from '@prospeccao/integrations/enriquecimento';
import { ErroDefinitivo } from '@prospeccao/queue';
import { normalizarTelefone } from '@prospeccao/shared';
import { Coletor, notaPorRegras, papelPeloCargo } from './coletor.js';
import type { Deps } from './dependencias.js';
import * as repo from './repositorio.js';

const CARGOS_PADRAO = ['comprador', 'compras', 'gerente', 'proprietário', 'sócio'];
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

/** Erro do Apify em português curto, sem o JSON bruto. */
function explicarFalhaApify(erro: unknown): string {
  const msg = mensagemDe(erro);
  if (/TIMED-OUT|timeout|tempo esgotado/i.test(msg))
    return 'A busca no Google (Apify) demorou demais duas vezes. Use "Enriquecer de novo" mais tarde.';
  if (/HTTP 402|usage|credit|limit/i.test(msg)) return 'Sem crédito no Apify para a busca no Google.';
  if (/HTTP 401|HTTP 403|token/i.test(msg)) return 'APIFY_TOKEN recusado pelo Apify.';
  return `Busca no Google falhou: ${msg.slice(0, 160)}`;
}

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
      for (const t of empresa.telefones_receita) {
        c.contato({
          canal: 'telefone',
          valor: t,
          fonte: 'receita',
          confianca: 35,
          rotulo: 'Cadastro na Receita',
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

    // 2. Google Maps (já coletado na descoberta).
    const telMaps = normalizarTelefone(empresa.maps_telefone);
    c.contato({
      canal: 'telefone',
      valor: telMaps,
      fonte: 'maps',
      confianca: 70,
      rotulo: 'Telefone no Google',
    });
    const siteMaps = normalizarSite(empresa.maps_site);
    await etapa(
      'maps',
      empresa.place_id ? 'encontrado' : 'pulada',
      empresa.place_id
        ? [
            telMaps ? 'telefone' : null,
            siteMaps ? 'site' : null,
            empresa.maps_avaliacoes ? `${empresa.maps_avaliacoes} avaliações` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'Sem telefone nem site no Google.'
        : 'Não apareceu nas buscas do Maps.',
    );

    // 3. Site da empresa.
    let site: ResultadoSite | null = null;
    let instagram: string | null = null;
    let facebook: string | null = null;
    let linkedinEmpresa: string | null = null;
    let cnpjAchado: string | null = null;
    if (siteMaps) {
      try {
        site = await fontes.site.ler(siteMaps);
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
      for (const e of site.emails.slice(0, 5)) {
        const setor = e.split('@')[0] ?? '';
        c.contato({
          canal: 'email',
          valor: e,
          fonte: 'site',
          confianca: /compr/.test(setor) ? 80 : 65,
          rotulo: /compr/.test(setor) ? 'Compras' : null,
          urlOrigem: url,
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
    } else {
      await etapa(
        'site',
        siteMaps ? 'erro' : 'pulada',
        siteMaps
          ? 'O site não respondeu (fora do ar ou bloqueia leitura automática).'
          : 'Sem site no Google.',
        siteMaps,
      );
    }

    // 4. Instagram: pelo site; se não, procura no Google.
    let perfil: PerfilInstagram | null = null;
    if (!instagram && fontes.google && ajustes.buscarInstagram) {
      const consulta = `"${empresa.nome}" ${empresa.cidade.toLowerCase()} instagram`;
      try {
        const r = await fontes.google.buscar([consulta]);
        instagram = instagramNosResultados(r.get(consulta) ?? [], empresa.nome);
      } catch (erro) {
        log.warn({ err: erro }, 'falha ao procurar o Instagram no Google');
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
        await etapa(
          'instagram',
          'encontrado',
          `@${perfil.usuario}${perfil.seguidores != null ? `, ${perfil.seguidores} seguidores` : ''}${perfil.whatsapps.length ? ', WhatsApp na bio' : ''}.`,
          url,
        );
      }
    } else {
      await etapa(
        'instagram',
        instagram ? 'pulada' : 'sem_resultado',
        instagram
          ? `@${instagram} encontrado, mas sem APIFY_TOKEN para ler o perfil.`
          : 'Instagram não encontrado.',
        instagram ? `https://www.instagram.com/${instagram}/` : null,
      );
    }

    // 5. Nota: IA (Gemini) ou regras.
    let avaliacao: AvaliacaoIa | null = null;
    if (fontes.ia) {
      try {
        avaliacao = await fontes.ia.avaliar({
          nicho: campanha.nicho_nome,
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
      await etapa('ia', 'pulada', `Sem GEMINI_API_KEY. ${motivo}`);
    }

    // 6. LinkedIn: pessoas de compras/gestão e os sócios-administradores, só para leads que valem a
    // busca. Perfil só entra se o próprio LinkedIn disser que a pessoa trabalha NESTA empresa:
    // nome igual não basta (homônimos são comuns).
    if (ajustes.faixasLinkedin.has(faixa) && fontes.google) {
      const cargos = campanha.cargos_alvo.length ? campanha.cargos_alvo : CARGOS_PADRAO;
      const nomeBusca = empresa.nome.replace(/["]/g, '');
      const consultaEmpresa = `site:linkedin.com/in "${nomeBusca}" (${cargos.map((x) => `"${x}"`).join(' OR ')})`;
      const admins = socios.filter((s) => s.prioridade === 1).slice(0, 2);
      const consultasSocios = admins.map((s) => `site:linkedin.com/in "${s.nome}" ${nomeBusca}`);
      const palavras = palavrasDaEmpresa(empresa.nome, empresa.razao_social);
      try {
        if (!palavras.length) {
          // "Js Peças", "Auto Peças Salvador": nada no nome que diferencie de outras lojas.
          await etapa(
            'linkedin',
            'pulada',
            'Nome da empresa genérico demais para confirmar no LinkedIn quem trabalha nela.',
          );
        } else {
          const r = await buscarComRetentativa(fontes.google, [consultaEmpresa, ...consultasSocios]);
          let achadas = 0;
          for (const p of pessoasDaEmpresa(r.get(consultaEmpresa) ?? [], palavras)) {
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
          const homonimos: string[] = [];
          admins.forEach((s, i) => {
            const resultados = r.get(consultasSocios[i] ?? '') ?? [];
            const perfil = perfilDoSocio(s.nome, resultados, palavras);
            if (!perfil) {
              if (resultados.some((x) => /linkedin\.com\/in\//.test(x.url))) homonimos.push(s.nome);
              return;
            }
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
            achadas++;
          });
          const aviso = homonimos.length
            ? ` Perfis com o nome de ${homonimos.map((n) => n.split(' ')[0]).join(' e ')} não citam esta empresa: ignorados (podem ser homônimos).`
            : '';
          await etapa(
            'linkedin',
            achadas ? 'encontrado' : 'sem_resultado',
            (achadas
              ? `${achadas} perfil(is) de quem trabalha nesta empresa.`
              : 'Nenhum perfil que cite esta empresa no emprego atual.') + aviso,
          );
        }
      } catch (erro) {
        await etapa('linkedin', 'erro', explicarFalhaApify(erro));
      }
    } else {
      await etapa(
        'linkedin',
        'pulada',
        !fontes.google
          ? 'Sem APIFY_TOKEN para buscar no Google.'
          : `Só para leads ${[...ajustes.faixasLinkedin].join(' e ')}.`,
      );
    }

    // 7. Google Places: a loja segue aberta? Telefone atualizado?
    let mapsAberto: boolean | null = empresa.maps_fechada == null ? null : !empresa.maps_fechada;
    if (ajustes.faixasPlaces.has(faixa) && fontes.places && empresa.place_id) {
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
        await etapa('places', 'erro', mensagemDe(erro));
      }
    } else {
      await etapa(
        'places',
        'pulada',
        !fontes.places
          ? 'Sem GOOGLE_PLACES_KEY.'
          : !empresa.place_id
            ? 'Lead fora do Maps.'
            : `Só para leads ${[...ajustes.faixasPlaces].join(' e ')}.`,
      );
    }

    // 8. WhatsApp: quais números têm conta (consulta no chip, sem enviar mensagem).
    const numeros = c.telefonesParaConferir();
    if (fontes.whatsapp && numeros.length) {
      try {
        const r = await fontes.whatsapp.verificar(numeros);
        c.aplicarWhatsapp(r);
        const com = [...r.values()].filter(Boolean).length;
        await etapa(
          'whatsapp',
          com ? 'encontrado' : 'sem_resultado',
          `${com} de ${numeros.length} número(s) com WhatsApp.`,
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

    c.escolherDecisor();
    c.escolherPrincipal();
    await repo.concluir(pool, empresaId, c, {
      faixa,
      score,
      motivo,
      resumo: avaliacao?.resumo ?? null,
      entrega: avaliacao?.entrega ?? empresa.sinal_entrega,
      cnpjAchado,
      site: site?.urlFinal ?? siteMaps,
      instagram,
      facebook,
      linkedinEmpresa,
      mapsAberto,
    });
    log.info({ faixa, score, contatos: c.contatos.size, pessoas: c.pessoas.size }, 'empresa enriquecida');
    return 'feito';
  } catch (erro) {
    await repo.marcarErro(pool, empresaId, mensagemDe(erro));
    throw erro;
  }
}
