import type { Camada, ContactRowProps, DataFieldItem, Fonte } from '@prospeccao/ui';
import {
  Button,
  ContactRow,
  DataFields,
  DecisorCard,
  EnrichmentTrail,
  LeadHeader,
  Panel,
} from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  type ContatoEnriq,
  type EmpresaDetalhe,
  type EtapaEnriq,
  type FonteEnriq,
  type PessoaEnriq,
} from '../api';
import {
  fmtCidade,
  fmtData,
  fmtHora,
  fmtNome,
  fmtNota,
  fmtNumero,
  formatarCnae,
  formatarCnpj,
  formatarTelefone,
  ROTULO_CRUZAMENTO,
} from '../formatar';
import { Drawer } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { SecaoFunil } from './SecaoFunil';

const PORTE: Record<string, string> = {
  me: 'Microempresa',
  epp: 'Empresa de pequeno porte',
  demais: 'Demais portes',
  nao_informado: 'Não informado',
};

/** Fonte do enriquecimento → selo do design system. */
const FONTE: Record<FonteEnriq, Fonte> = {
  receita: 'qsa',
  maps: 'maps',
  site: 'site',
  instagram: 'instagram',
  linkedin: 'linkedin',
  google: 'site',
  ia: 'ia',
  places: 'places',
  manual: 'manual',
};

const NOME_FONTE: Record<FonteEnriq, string> = {
  receita: 'Receita',
  maps: 'Google Maps',
  site: 'site',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  google: 'Google',
  ia: 'IA',
  places: 'Google',
  manual: 'cadastro manual',
};

const NOME_ETAPA: Record<EtapaEnriq['etapa'], string> = {
  receita: 'Quadro de sócios (Receita)',
  maps: 'Google Maps',
  site: 'Site da empresa',
  instagram: 'Instagram',
  ia: 'Nota da IA',
  linkedin: 'LinkedIn',
  places: 'Validação no Google',
  whatsapp: 'WhatsApp',
};

const PAPEL: Record<PessoaEnriq['papel'], string> = {
  socio: 'Sócio',
  compras: 'Compras',
  gestao: 'Gestão',
  outro: '',
};

/** De onde vem a certeza sobre a pessoa, quando não há trecho do site. */
function provaDaPessoa(p: PessoaEnriq): string | undefined {
  const receita = p.fontes.includes('receita');
  const linkedin = p.fontes.includes('linkedin') && p.linkedin;
  if (receita && linkedin) return 'No quadro de sócios da Receita; o LinkedIn dele cita esta empresa.';
  if (receita) return 'No quadro de sócios da Receita.';
  if (linkedin) return 'O LinkedIn cita esta empresa no emprego atual.';
  return undefined;
}

function paraContactRow(c: ContatoEnriq): ContactRowProps {
  const fone = c.canal === 'whatsapp' || c.canal === 'telefone';
  const valor = fone
    ? formatarTelefone(c.valor)
    : c.canal === 'site' || c.canal === 'facebook'
      ? c.valor.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
      : c.canal === 'instagram'
        ? (c.rotulo ?? c.valor)
        : c.canal === 'linkedin'
          ? c.valor.replace(/^https?:\/\/([a-z]{2}\.)?(www\.)?/, '')
          : c.valor;
  const vistoEm = c.fontes.length > 1 ? `Visto em: ${c.fontes.map((f) => NOME_FONTE[f]).join(', ')}` : null;
  return {
    canal: c.canal === 'facebook' ? 'site' : c.canal,
    valor,
    rotulo:
      [c.canal === 'facebook' ? 'Facebook' : c.rotulo, vistoEm].filter(Boolean).join(' · ') ||
      NOME_FONTE[c.fonte],
    status: c.status,
    fonte: FONTE[c.fonte],
    principal: c.principal,
  };
}

/** Antes do enriquecimento: contatos que a descoberta já trouxe (Google e Receita). */
function contatosDaDescoberta(e: EmpresaDetalhe): ContactRowProps[] {
  const contatos: ContactRowProps[] = [];
  if (e.mapsTelefone) {
    contatos.push({
      canal: 'telefone',
      valor: formatarTelefone(e.mapsTelefone),
      rotulo: 'Perfil no Google',
      status: 'nao_verificado',
      fonte: 'maps',
    });
  }
  for (const t of e.telefonesReceita) {
    if (t === e.mapsTelefone) continue;
    contatos.push({
      canal: 'telefone',
      valor: formatarTelefone(t),
      rotulo: 'Cadastro da Receita',
      status: 'atencao',
      fonte: 'receita',
    });
  }
  if (e.emailReceita) {
    contatos.push({
      canal: 'email',
      valor: e.emailReceita,
      rotulo: 'Cadastro da Receita',
      status: 'atencao',
      fonte: 'receita',
    });
  }
  if (e.mapsSite) {
    contatos.push({
      canal: 'site',
      valor: e.mapsSite.replace(/^https?:\/\//, ''),
      rotulo: 'Site',
      status: 'nao_verificado',
      fonte: 'maps',
    });
  }
  return contatos;
}

const ROTULO_LINK: Partial<Record<EtapaEnriq['etapa'], string>> = {
  maps: 'Abrir no Google Maps',
  instagram: 'Instagram',
  linkedin: 'Ver a busca do LinkedIn no Google',
  places: 'Abrir no Google Maps',
  site: 'Site',
};

/** Links para conferir na mão o que cada etapa viu (a busca do LinkedIn, o lugar no Maps…). */
function LinksDaTrilha({ etapas }: { etapas: EtapaEnriq[] }) {
  const vistos = new Set<string>();
  const links = etapas.filter((et) => {
    if (!et.url || !ROTULO_LINK[et.etapa] || vistos.has(et.url)) return false;
    vistos.add(et.url);
    return true;
  });
  if (!links.length) return null;
  return (
    <div className="acoes" style={{ marginTop: 12 }}>
      {links.map((et) => (
        <Button
          key={et.etapa + et.url}
          size="sm"
          variant="ghost"
          iconRight="external-link"
          href={et.url ?? undefined}
          target="_blank"
          rel="noreferrer"
        >
          {et.etapa === 'instagram' && /google\.com\/search/.test(et.url ?? '')
            ? 'Ver a busca do Instagram no Google'
            : ROTULO_LINK[et.etapa]}
        </Button>
      ))}
    </div>
  );
}

function trilha(e: EmpresaDetalhe): Camada[] {
  // Sem place_id da campanha, vale o que o enriquecimento achou (busca por nome e endereço).
  const mapsEnriq = e.etapas.find((et) => et.etapa === 'maps');
  const camadas: Camada[] = [
    e.cnpj
      ? {
          nome: 'Base de CNPJ',
          status: 'encontrado',
          fonte: 'cnpj',
          detalhe: `CNAE ${e.cnaePrincipal ? formatarCnae(e.cnaePrincipal) : '—'}, aberta em ${fmtData(e.dataAbertura)}.`,
        }
      : {
          nome: 'Base de CNPJ',
          status: 'sem_resultado',
          fonte: 'cnpj',
          detalhe: 'Não está na base filtrada pelo nicho e pelas cidades da campanha.',
        },
    e.placeId
      ? {
          nome: 'Google Maps',
          status: 'encontrado',
          fonte: 'maps',
          detalhe:
            e.cruzamento?.tipo === 'novo'
              ? 'Encontrado no Maps; ainda não ligado a um CNPJ da base.'
              : e.cruzamento
                ? `Ligado à base por ${ROTULO_CRUZAMENTO[e.cruzamento.tipo] ?? e.cruzamento.tipo}${e.cruzamento.similaridade ? ` (semelhança ${Math.round(e.cruzamento.similaridade * 100)}%)` : ''}.`
                : 'Encontrado nas buscas da campanha.',
        }
      : mapsEnriq && mapsEnriq.status !== 'pulada'
        ? {
            nome: 'Google Maps',
            status: mapsEnriq.status,
            fonte: 'maps',
            detalhe: mapsEnriq.detalhe ?? undefined,
          }
        : {
            nome: 'Google Maps',
            status: 'sem_resultado',
            fonte: 'maps',
            detalhe: mapsEnriq?.detalhe ?? 'Não apareceu nas buscas do Maps.',
          },
  ];
  for (const et of e.etapas) {
    if (et.etapa === 'maps') continue;
    camadas.push({
      nome: NOME_ETAPA[et.etapa],
      status: et.status,
      fonte:
        et.etapa === 'whatsapp'
          ? undefined
          : FONTE[et.etapa === 'receita' ? 'receita' : (et.etapa as FonteEnriq)],
      detalhe: et.detalhe ?? undefined,
    });
  }
  const st = e.enriquecimento?.status;
  if (!e.etapas.length || st === 'rodando' || st === 'na_fila') {
    camadas.push({
      nome: 'Contatos do decisor',
      status: st === 'rodando' ? 'em_andamento' : 'pulada',
      detalhe:
        st === 'rodando'
          ? 'Buscando agora: site, Instagram, LinkedIn e WhatsApp.'
          : e.campanhas.some((c) => c.enriquecimentoSolicitadoEm)
            ? 'Na fila do enriquecimento.'
            : 'Ainda não enviado: a campanha precisa estar ativa.',
    });
  }
  return camadas;
}

function dados(e: EmpresaDetalhe): DataFieldItem[] {
  const endereco =
    e.mapsEndereco ??
    [e.logradouro, e.numero, e.bairro, fmtCidade(e.cidade), e.uf, e.cep].filter(Boolean).join(', ');
  const en = e.enriquecimento;
  return [
    { rotulo: 'CNPJ', valor: e.cnpj ? formatarCnpj(e.cnpj) : null, mono: true, fonte: 'cnpj' },
    ...(en?.cnpjAchado && !e.cnpj
      ? [{ rotulo: 'CNPJ achado', valor: formatarCnpj(en.cnpjAchado), mono: true, fonte: 'site' as Fonte }]
      : []),
    { rotulo: 'Razão social', valor: e.razaoSocial, fonte: 'cnpj' },
    {
      rotulo: 'CNAE principal',
      valor: e.cnaePrincipal ? formatarCnae(e.cnaePrincipal) : null,
      mono: true,
      fonte: 'cnpj',
    },
    { rotulo: 'Porte', valor: e.porte ? PORTE[e.porte] : null, fonte: 'cnpj' },
    { rotulo: 'Abertura', valor: e.dataAbertura ? fmtData(e.dataAbertura) : null, mono: true, fonte: 'cnpj' },
    {
      rotulo: 'Nota no Google',
      valor:
        e.mapsAvaliacoes != null
          ? `${fmtNota(e.mapsNota) ?? '—'} · ${fmtNumero(e.mapsAvaliacoes)} avaliações`
          : null,
      fonte: 'maps',
    },
    { rotulo: 'Categoria no Maps', valor: e.mapsCategoria, fonte: 'maps' },
    ...(en?.resumo ? [{ rotulo: 'O que faz', valor: en.resumo, largo: true, fonte: 'ia' as Fonte }] : []),
    { rotulo: 'Endereço', valor: endereco || null, largo: true, fonte: e.mapsEndereco ? 'maps' : 'cnpj' },
  ];
}

function QuemDecide({ e }: { e: EmpresaDetalhe }) {
  const [todos, setTodos] = useState(false);
  const daEmpresa = e.contatos.filter((c) => c.pessoaId == null);
  // Contatos que valem para falar com o decisor: o principal e os WhatsApp confirmados da empresa.
  const melhores = daEmpresa
    .filter((c) => c.principal || (c.canal === 'whatsapp' && c.status === 'verificado'))
    .slice(0, 2)
    .map(paraContactRow);

  if (e.pessoas.length) {
    const visiveis = todos ? e.pessoas : e.pessoas.slice(0, 3);
    return (
      <div className="pilha">
        {visiveis.map((p) => {
          const proprios = e.contatos
            .filter((c) => c.pessoaId === p.id && c.canal !== 'linkedin')
            .map(paraContactRow);
          return (
            <DecisorCard
              key={p.id}
              nome={fmtNome(p.nome)}
              cargo={
                [p.cargo, p.papel === 'compras' && !/compr/i.test(p.cargo ?? '') ? PAPEL.compras : null]
                  .filter(Boolean)
                  .join(' · ') ||
                PAPEL[p.papel] ||
                undefined
              }
              desde={p.desde?.slice(0, 4)}
              principal={p.decisor}
              fontes={[...new Set(p.fontes.map((f) => FONTE[f]))]}
              linkedin={p.linkedin}
              evidencia={p.evidencia ?? provaDaPessoa(p)}
              contatos={p.decisor ? [...proprios, ...melhores] : proprios}
            />
          );
        })}
        {e.pessoas.length > 3 && (
          <Button variant="ghost" size="sm" onClick={() => setTodos(!todos)}>
            {todos ? 'Mostrar menos' : `Ver mais ${e.pessoas.length - 3} pessoa(s)`}
          </Button>
        )}
      </div>
    );
  }

  if (e.socios.length) {
    return (
      <div className="pilha">
        {e.socios.map((s, i) => (
          <DecisorCard
            key={`${s.nome}-${s.dataEntrada ?? ''}`}
            nome={fmtNome(s.nome)}
            cargo={s.qualificacao}
            desde={s.dataEntrada?.slice(0, 4)}
            principal={i === 0 && s.prioridade === 1}
            fontes={['qsa']}
            contatos={[]}
          />
        ))}
      </div>
    );
  }

  return (
    <Mensagem tipo="aviso">
      {e.cnpj
        ? 'A Receita não lista sócios para este CNPJ e o enriquecimento ainda não achou um responsável.'
        : 'Empresa achada só no Google Maps, sem CNPJ: o responsável vem do site, do Instagram e do LinkedIn.'}
    </Mensagem>
  );
}

export function FichaEmpresa({
  id,
  aoFechar,
  aoAbrir,
}: {
  id: number;
  aoFechar: () => void;
  /** Abre outra empresa na ficha (aviso de telefone repetido). */
  aoAbrir?: (id: number) => void;
}) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['empresa', id],
    queryFn: () => api<EmpresaDetalhe>(`/empresas/${id}`),
    // Enquanto o enriquecimento roda, a ficha se atualiza sozinha.
    refetchInterval: (r) => {
      const st = r.state.data?.enriquecimento?.status;
      return st === 'rodando' || st === 'na_fila' ? 4_000 : false;
    },
  });
  const [pedido, setPedido] = useState<string | null>(null);
  const enriquecer = useMutation({
    mutationFn: () => api<{ mensagem: string }>(`/empresas/${id}/enriquecer`, { metodo: 'POST' }),
    onSuccess: (r) => {
      setPedido(r.mensagem);
      // A fila leva alguns segundos para começar: consulta de novo logo em seguida.
      setTimeout(() => cliente.invalidateQueries({ queryKey: ['empresa', id] }), 3_000);
    },
  });
  const e = q.data;
  const en = e?.enriquecimento;
  const contatos = e
    ? e.contatos.length
      ? e.contatos.filter((c) => c.pessoaId == null).map(paraContactRow)
      : contatosDaDescoberta(e)
    : [];

  return (
    <Drawer
      titulo={e ? fmtNome(e.nome) : 'Ficha do lead'}
      barra={e ? `Lead ${e.id}` : 'Carregando…'}
      aoFechar={aoFechar}
    >
      {q.isPending && (
        <div className="drawer__corpo" aria-busy="true">
          <div className="esqueleto" />
          <div className="esqueleto" />
        </div>
      )}
      {q.error && (
        <div className="drawer__corpo">
          <ErroDaApi erro={q.error} />
        </div>
      )}
      {e && (
        <>
          <LeadHeader
            nome={fmtNome(e.nome)}
            razaoSocial={e.razaoSocial ?? undefined}
            cnpj={e.cnpj ? formatarCnpj(e.cnpj) : undefined}
            faixa={en?.faixa ?? undefined}
            score={en?.score ?? undefined}
            motivo={en?.motivo ?? undefined}
            nicho={e.mapsCategoria ?? undefined}
            cidade={`${fmtCidade(e.cidade)}, ${e.uf}`}
            sinalEntrega={e.sinalEntrega || en?.entrega ? 'Faz entregas' : undefined}
            acoes={
              <>
                {e.mapsUrl && (
                  <Button icon="map-pin" href={e.mapsUrl} target="_blank" rel="noreferrer">
                    Google Maps
                  </Button>
                )}
                {(en?.site ?? e.mapsSite) && (
                  <Button
                    icon="globe"
                    href={en?.site ?? e.mapsSite ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Site
                  </Button>
                )}
                {en?.instagram && (
                  <Button
                    icon="camera"
                    href={`https://www.instagram.com/${en.instagram}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Instagram
                  </Button>
                )}
                <Button
                  variant="ghost"
                  icon="loader"
                  disabled={enriquecer.isPending || en?.status === 'rodando'}
                  onClick={() => enriquecer.mutate()}
                >
                  {en?.status === 'rodando'
                    ? 'Enriquecendo…'
                    : en
                      ? 'Enriquecer de novo'
                      : 'Enriquecer agora'}
                </Button>
              </>
            }
          />
          <div className="drawer__corpo">
            {e.mei && (
              <Mensagem tipo="aviso">
                MEI (microempreendedor individual): não costuma ter volume para contratar entregas. Fica fora
                da lista de leads por padrão.
              </Mensagem>
            )}
            {(e.mapsFechada || en?.mapsAberto === false) && (
              <Mensagem tipo="aviso">O Google marca este lugar como fechado.</Mensagem>
            )}
            {en?.status === 'erro' && <Mensagem tipo="erro">O enriquecimento falhou: {en.erro}</Mensagem>}
            {en?.status === 'rodando' && (
              <Mensagem tipo="aviso">
                Enriquecendo agora (começou {fmtHora(en.iniciadoEm)}). A ficha se atualiza sozinha.
              </Mensagem>
            )}
            {pedido && en?.status !== 'rodando' && <Mensagem tipo="ok">{pedido}</Mensagem>}
            <ErroDaApi erro={enriquecer.error} />

            <SecaoFunil
              key={e.id}
              empresaId={e.id}
              aoAbrirEmpresa={aoAbrir}
              contatoPrincipal={
                e.contatos.find((c) => c.principal) ??
                (e.mapsTelefone ? { canal: 'telefone', valor: e.mapsTelefone } : null)
              }
            />

            <section className="secao">
              <h2>
                Quem decide{' '}
                <small>
                  {e.pessoas.length
                    ? `${e.pessoas.length} ${e.pessoas.length === 1 ? 'pessoa' : 'pessoas'}`
                    : e.socios.length
                      ? `${e.socios.length} no quadro de sócios`
                      : ''}
                </small>
              </h2>
              <QuemDecide e={e} />
            </section>

            <Panel titulo="Contatos da empresa" contagem={contatos.length} semPadding>
              {contatos.length ? (
                <ul className="pp-contacts">
                  {contatos.map((c) => (
                    <ContactRow key={`${c.canal}-${c.valor}`} {...c} />
                  ))}
                </ul>
              ) : (
                <p className="quieto" style={{ margin: 0, padding: 16, fontSize: 13 }}>
                  Nenhum contato encontrado ainda.
                </p>
              )}
            </Panel>

            <Panel titulo="Dados da empresa">
              <DataFields colunas={2} itens={dados(e)} />
            </Panel>

            <Panel titulo="Como encontramos">
              <EnrichmentTrail camadas={trilha(e)} />
              <LinksDaTrilha etapas={e.etapas} />
              {en?.concluidoEm && (
                <p className="quieto" style={{ margin: '12px 0 0', fontSize: 12 }}>
                  Enriquecido {fmtHora(en.concluidoEm)}.
                </p>
              )}
            </Panel>

            <section className="secao">
              <h2>Campanhas</h2>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: '22px' }}>
                {e.campanhas.map((c) => (
                  <li key={c.id}>
                    {c.nome} <span className="quieto">· encontrada {fmtHora(c.adicionadaEm)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}
