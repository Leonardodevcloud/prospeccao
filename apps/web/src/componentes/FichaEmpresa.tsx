import type { Camada, ContactRowProps, DataFieldItem } from '@prospeccao/ui';
import {
  Button,
  ContactRow,
  DataFields,
  DecisorCard,
  EnrichmentTrail,
  LeadHeader,
  Panel,
} from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { api, type EmpresaDetalhe } from '../api';
import {
  fmtCidade,
  fmtData,
  fmtKm,
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

const PORTE: Record<string, string> = {
  me: 'Microempresa',
  epp: 'Empresa de pequeno porte',
  demais: 'Demais portes',
  nao_informado: 'Não informado',
};

function contatosDaEmpresa(e: EmpresaDetalhe): ContactRowProps[] {
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
  if (e.mapsSite)
    contatos.push({
      canal: 'site',
      valor: e.mapsSite.replace(/^https?:\/\//, ''),
      rotulo: 'Site',
      status: 'nao_verificado',
      fonte: 'maps',
    });
  return contatos;
}

function trilha(e: EmpresaDetalhe): Camada[] {
  const camadas: Camada[] = [];
  camadas.push(
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
  );
  camadas.push(
    e.placeId
      ? {
          nome: 'Google Maps',
          status: 'encontrado',
          fonte: 'maps',
          detalhe: e.cruzamento
            ? `Ligado à base por ${ROTULO_CRUZAMENTO[e.cruzamento.tipo] ?? e.cruzamento.tipo}${e.cruzamento.similaridade ? ` (semelhança ${Math.round(e.cruzamento.similaridade * 100)}%)` : ''}.`
            : 'Encontrado nas buscas da campanha.',
        }
      : {
          nome: 'Google Maps',
          status: 'sem_resultado',
          fonte: 'maps',
          detalhe: 'Não apareceu nas buscas do Maps desta campanha.',
        },
  );
  camadas.push(
    e.lat != null
      ? {
          nome: 'Localização',
          status: 'encontrado',
          detalhe: `Coordenadas ${e.geoFonte === 'maps' ? 'do Google Maps' : 'pelo endereço da Receita'}${e.baseNome ? `; ${fmtKm(e.distanciaBaseKm)} da ${e.baseNome}` : ''}.`,
        }
      : {
          nome: 'Localização',
          status: 'sem_resultado',
          detalhe: 'Sem coordenada. Só faz diferença em campanhas com raio.',
        },
  );
  const solicitado = e.campanhas.find((c) => c.enriquecimentoSolicitadoEm);
  const foraDoRaio = e.campanhas.every((c) => c.dentroDoRaio === false);
  camadas.push(
    solicitado
      ? {
          nome: 'Contatos do decisor',
          status: 'em_andamento',
          detalhe: 'Na fila do enriquecimento (Fase 2: site, Instagram, LinkedIn e validação de WhatsApp).',
        }
      : {
          nome: 'Contatos do decisor',
          status: 'pulada',
          detalhe: foraDoRaio
            ? 'Fora do raio da campanha: não será enriquecido.'
            : 'Ainda não enviado: a campanha precisa estar ativa (com raio, o lead também precisa estar localizado).',
        },
  );
  return camadas;
}

function dados(e: EmpresaDetalhe): DataFieldItem[] {
  const endereco =
    e.mapsEndereco ??
    [e.logradouro, e.numero, e.bairro, fmtCidade(e.cidade), e.uf, e.cep].filter(Boolean).join(', ');
  return [
    { rotulo: 'CNPJ', valor: e.cnpj ? formatarCnpj(e.cnpj) : null, mono: true, fonte: 'cnpj' },
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
    {
      rotulo: 'Distância da base',
      valor:
        e.distanciaBaseKm != null
          ? `${fmtKm(e.distanciaBaseKm)}${e.baseNome ? ` · ${e.baseNome}` : ''}`
          : null,
    },
    { rotulo: 'Endereço', valor: endereco || null, largo: true, fonte: e.mapsEndereco ? 'maps' : 'cnpj' },
  ];
}

export function FichaEmpresa({ id, aoFechar }: { id: number; aoFechar: () => void }) {
  const q = useQuery({ queryKey: ['empresa', id], queryFn: () => api<EmpresaDetalhe>(`/empresas/${id}`) });
  const e = q.data;

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
            nicho={e.mapsCategoria ?? undefined}
            cidade={`${fmtCidade(e.cidade)}, ${e.uf}`}
            sinalEntrega={e.sinalEntrega ? 'Faz entregas' : undefined}
            distancia={e.distanciaBaseKm != null ? `${fmtKm(e.distanciaBaseKm)} da base` : undefined}
            acoes={
              <>
                {e.mapsUrl && (
                  <Button icon="map-pin" href={e.mapsUrl} target="_blank" rel="noreferrer">
                    Abrir no Google Maps
                  </Button>
                )}
                {e.mapsSite && (
                  <Button icon="globe" href={e.mapsSite} target="_blank" rel="noreferrer">
                    Ver site
                  </Button>
                )}
              </>
            }
          />
          <div className="drawer__corpo">
            {e.mapsFechada && <Mensagem tipo="aviso">O Google Maps marca este lugar como fechado.</Mensagem>}

            <section className="secao">
              <h2>
                Quem decide <small>{e.socios.length ? `${e.socios.length} no quadro de sócios` : ''}</small>
              </h2>
              {e.cnpj ? (
                e.socios.length ? (
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
                ) : (
                  <Mensagem tipo="aviso">A Receita não lista sócios para este CNPJ.</Mensagem>
                )
              ) : (
                <Mensagem tipo="aviso">
                  Empresa achada só no Google Maps, sem CNPJ: não há quadro de sócios. O enriquecimento vai
                  procurar o responsável no site e no LinkedIn.
                </Mensagem>
              )}
            </section>

            <Panel titulo="Contatos da empresa" contagem={contatosDaEmpresa(e).length} semPadding>
              {contatosDaEmpresa(e).length ? (
                <ul className="pp-contacts">
                  {contatosDaEmpresa(e).map((c) => (
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
            </Panel>

            <section className="secao">
              <h2>Campanhas</h2>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: '22px' }}>
                {e.campanhas.map((c) => (
                  <li key={c.id}>
                    {c.nome}{' '}
                    <span className="quieto">
                      ·{' '}
                      {c.dentroDoRaio === false
                        ? 'fora do raio'
                        : c.dentroDoRaio
                          ? 'dentro do raio'
                          : 'sem localização'}
                    </span>
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
