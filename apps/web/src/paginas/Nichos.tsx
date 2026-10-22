import { nichoEntrada, PORTES, ROTULO_PORTE } from '@prospeccao/shared/dominio';
import { GRUPOS_NICHOS, type NichoPronto } from '@prospeccao/shared/nichos-prontos';
import { Badge, Button, EmptyState, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type Nicho } from '../api';
import { Drawer } from '../componentes/Drawer';
import { CampoLista, ErroDaApi, limparLista, Mensagem } from '../componentes/Formulario';
import { formatarCnae } from '../formatar';

type Rascunho = {
  nome: string;
  cnaes: string[];
  termosMaps: string[];
  palavrasPositivas: string[];
  palavrasNegativas: string[];
  cargosAlvo: string[];
  portes: string[];
  idadeMinimaAnos: string;
  excluirMei: boolean;
};

const VAZIO: Rascunho = {
  nome: '',
  cnaes: [],
  termosMaps: [],
  palavrasPositivas: ['entrega', 'delivery', 'motoboy'],
  palavrasNegativas: [],
  cargosAlvo: ['sócio-administrador'],
  portes: [...PORTES],
  idadeMinimaAnos: '0',
  excluirMei: true,
};

function FormNicho({ nicho, aoFechar }: { nicho: Nicho | null; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Rascunho>(
    nicho
      ? { ...nicho, cnaes: nicho.cnaes.map(formatarCnae), idadeMinimaAnos: String(nicho.idadeMinimaAnos) }
      : VAZIO,
  );
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const lista = (campo: keyof Rascunho) => (v: string[]) => setF({ ...f, [campo]: v });

  const salvar = useMutation({
    mutationFn: (dados: unknown) =>
      nicho
        ? api<Nicho>(`/nichos/${nicho.id}`, { metodo: 'PATCH', corpo: dados })
        : api<Nicho>('/nichos', { metodo: 'POST', corpo: dados }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['nichos'] });
      aoFechar();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const r = nichoEntrada.safeParse({
      ...f,
      cnaes: limparLista(f.cnaes),
      termosMaps: limparLista(f.termosMaps),
      palavrasPositivas: limparLista(f.palavrasPositivas),
      palavrasNegativas: limparLista(f.palavrasNegativas),
      cargosAlvo: limparLista(f.cargosAlvo),
    });
    if (!r.success) return setErroLocal(r.error.issues[0]?.message ?? 'Confira os campos.');
    setErroLocal(null);
    salvar.mutate(r.data);
  };

  const alternarPorte = (p: string) =>
    setF({ ...f, portes: f.portes.includes(p) ? f.portes.filter((x) => x !== p) : [...f.portes, p] });

  return (
    <Drawer
      titulo={nicho ? `Editar ${nicho.nome}` : 'Novo nicho'}
      barra={nicho ? 'Editar nicho' : 'Novo nicho'}
      aoFechar={aoFechar}
    >
      <form className="drawer__corpo form" onSubmit={enviar} noValidate>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>
            {nicho ? nicho.nome : 'Novo nicho'}
          </h2>
          <p className="quieto" style={{ margin: '2px 0 0', fontSize: 13 }}>
            O perfil diz ao motor quem procurar na base de CNPJ e no Google Maps.
          </p>
        </div>
        <TextField
          rotulo="Nome"
          value={f.nome}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, nome: e.target.value })}
          placeholder="Ex.: Pet shop"
        />
        <CampoLista
          id="cnaes"
          rotulo="CNAEs"
          valor={f.cnaes}
          aoMudar={lista('cnaes')}
          exemplo={'4789-0/04'}
          dica="Um por linha. Confira os códigos na Concla (IBGE). Vale CNAE principal ou secundário."
        />
        <CampoLista
          id="termos"
          rotulo="Busca no Google Maps"
          valor={f.termosMaps}
          aoMudar={lista('termosMaps')}
          exemplo={'pet shop\nagropecuária'}
          dica="Um termo por linha; cada termo roda em cada cidade da campanha."
        />
        <CampoLista
          id="positivas"
          rotulo="Palavras que indicam entrega"
          valor={f.palavrasPositivas}
          aoMudar={lista('palavrasPositivas')}
          dica="Usadas no score (Fase 2), ao ler site e Instagram."
        />
        <CampoLista
          id="negativas"
          rotulo="Palavras que descartam"
          valor={f.palavrasNegativas}
          aoMudar={lista('palavrasNegativas')}
          exemplo={'oficina\nfunilaria'}
          dica="Lugar do Maps com uma delas no nome ou na categoria não entra na campanha."
        />
        <CampoLista
          id="cargos"
          rotulo="Cargos do decisor"
          valor={f.cargosAlvo}
          aoMudar={lista('cargosAlvo')}
          exemplo={'sócio-administrador\ngerente de logística'}
          dica="Em ordem de prioridade; usados na busca do LinkedIn (Fase 2)."
        />
        <fieldset className="campo">
          <legend>Porte</legend>
          <div className="opcoes">
            {PORTES.map((p) => (
              <label key={p} className="opcao">
                <input type="checkbox" checked={f.portes.includes(p)} onChange={() => alternarPorte(p)} />
                {ROTULO_PORTE[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          rotulo="Idade mínima da empresa (anos)"
          inputMode="numeric"
          value={f.idadeMinimaAnos}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setF({ ...f, idadeMinimaAnos: e.target.value })
          }
          dica="0 aceita empresas abertas este ano."
        />
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.excluirMei}
            onChange={(e) => setF({ ...f, excluirMei: e.target.checked })}
          />
          <span>
            Deixar MEI de fora
            <span className="campo__dica" style={{ display: 'block' }}>
              Microempreendedor individual não tem volume para contratar entregas: não aparece nos leads nem
              gasta enriquecimento.
            </span>
          </span>
        </label>
        {erroLocal && <Mensagem tipo="erro">{erroLocal}</Mensagem>}
        <ErroDaApi erro={salvar.error} />
        <div className="acoes">
          <Button variant="primary" type="submit" icon="check" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : nicho ? 'Salvar nicho' : 'Criar nicho'}
          </Button>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/** Escolher entre os nichos prontos: cada um mostra os CNAEs, a busca no Maps e os sinais. */
function NichosProntos(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['nichos', 'prontos'],
    queryFn: () => api<(NichoPronto & { jaTem: boolean })[]>('/nichos/prontos'),
  });
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const aplicar = useMutation({
    mutationFn: () =>
      api<{ criados: number }>('/nichos/prontos', { metodo: 'POST', corpo: { ids: escolhidos } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['nichos'] }),
  });
  const alternar = (id: string) =>
    setEscolhidos((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <Drawer titulo="Nichos prontos" barra="Nichos" aoFechar={props.aoFechar} largo>
      <div className="drawer__corpo pilha" style={{ gap: 16 }}>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Escolha os nichos que você quer prospectar. Cada um já vem com os CNAEs da Receita, os termos de
          busca no Google Maps, os sinais de que a empresa é um bom lead e o que descartar. Depois de aplicar,
          dá para editar tudo.
        </p>
        <ErroDaApi erro={q.error} />
        {aplicar.data ? (
          <div className="pilha" style={{ gap: 12 }}>
            <Mensagem tipo="ok">
              {aplicar.data.criados
                ? `${aplicar.data.criados} ${aplicar.data.criados === 1 ? 'nicho criado' : 'nichos criados'}. Agora é só criar uma campanha com eles.`
                : 'Esses nichos já estavam na sua lista.'}
            </Mensagem>
            <div className="acoes">
              <Button variant="primary" onClick={props.aoFechar}>
                Ver meus nichos
              </Button>
            </div>
          </div>
        ) : (
          <>
            {GRUPOS_NICHOS.map((g) => {
              const doGrupo = q.data?.filter((n) => n.grupo === g) ?? [];
              if (!doGrupo.length) return null;
              return (
                <section key={g} className="pilha" style={{ gap: 8 }}>
                  <h3 className="subtitulo">{g}</h3>
                  <ul className="nichos-prontos">
                    {doGrupo.map((n) => {
                      const marcado = escolhidos.includes(n.id);
                      return (
                        <li key={n.id} className="nicho-pronto" data-marcado={marcado || undefined}>
                          <label className="nicho-pronto__topo">
                            <input
                              type="checkbox"
                              checked={marcado}
                              disabled={n.jaTem}
                              onChange={() => alternar(n.id)}
                            />
                            <span className="nicho-pronto__nome">
                              <b>{n.nome}</b>
                              <span className="quieto">{n.descricao}</span>
                            </span>
                            {n.jaTem && <Badge tone="outline">Já está na sua lista</Badge>}
                          </label>
                          <button
                            type="button"
                            className="link-botao nicho-pronto__ver"
                            aria-expanded={aberto === n.id}
                            onClick={() => setAberto(aberto === n.id ? null : n.id)}
                          >
                            {aberto === n.id ? 'Esconder detalhes' : 'Ver CNAEs, busca e sinais'}
                          </button>
                          {aberto === n.id && (
                            <dl className="nicho-pronto__detalhe">
                              <div>
                                <dt>CNAEs</dt>
                                <dd className="mono">{n.cnaes.join(' · ')}</dd>
                              </div>
                              <div>
                                <dt>Busca no Maps</dt>
                                <dd>{n.termosMaps.join(', ')}</dd>
                              </div>
                              <div>
                                <dt>Sinais de bom lead</dt>
                                <dd>{n.palavrasPositivas.join(', ')}</dd>
                              </div>
                              {n.palavrasNegativas.length > 0 && (
                                <div>
                                  <dt>Descarta</dt>
                                  <dd>{n.palavrasNegativas.join(', ')}</dd>
                                </div>
                              )}
                              <div>
                                <dt>Cargos-alvo</dt>
                                <dd>{n.cargosAlvo.join(', ')}</dd>
                              </div>
                            </dl>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            <ErroDaApi erro={aplicar.error} />
            <div className="acoes barra-fixa">
              <Button
                variant="primary"
                icon="check"
                disabled={!escolhidos.length || aplicar.isPending}
                onClick={() => aplicar.mutate()}
              >
                {escolhidos.length
                  ? `Aplicar ${escolhidos.length} ${escolhidos.length === 1 ? 'nicho' : 'nichos'}`
                  : 'Escolha os nichos'}
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function Nichos() {
  const cliente = useQueryClient();
  const [editando, setEditando] = useState<Nicho | 'novo' | null>(null);
  const [prontos, setProntos] = useState(false);
  const nichos = useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos') });
  const desativar = useMutation({
    mutationFn: (id: number) => api(`/nichos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['nichos'] }),
  });

  return (
    <>
      <div className="topo">
        <div>
          <h1>Nichos</h1>
          <p>Perfis de quem prospectar: CNAEs, termos de busca no Maps e os cargos que você quer alcançar.</p>
        </div>
        <div className="acoes">
          <Button variant="ghost" icon="plus" onClick={() => setEditando('novo')}>
            Montar do zero
          </Button>
          <Button variant="primary" icon="store" onClick={() => setProntos(true)}>
            Nichos prontos
          </Button>
        </div>
      </div>

      <ErroDaApi erro={nichos.error ?? desativar.error} />

      {nichos.data?.length === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone="store"
            titulo="Nenhum nicho cadastrado"
            texto="Escolha entre os nichos prontos (autopeças, farmácias, pet shops…) ou monte o seu. Depois crie uma campanha com ele."
            acao={
              <Button size="sm" variant="primary" icon="store" onClick={() => setProntos(true)}>
                Escolher nichos prontos
              </Button>
            }
          />
        </div>
      ) : (
        <div className="pp-tablewrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Nicho</th>
                <th>CNAEs</th>
                <th>Busca no Maps</th>
                <th>Cargos-alvo</th>
                <th>Campanhas</th>
                <th>
                  <span className="pp-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {nichos.data?.map((n) => (
                <tr key={n.id}>
                  <td>
                    <b style={{ fontWeight: 500 }}>{n.nome}</b>
                  </td>
                  <td>
                    <span className="mono">{n.cnaes.map(formatarCnae).join(' · ')}</span>
                  </td>
                  <td>{n.termosMaps.join(', ')}</td>
                  <td className="quieto">{n.cargosAlvo[0] ?? '—'}</td>
                  <td>
                    {n.campanhasEmAndamento ? (
                      <Badge tone="brand">{n.campanhasEmAndamento} em andamento</Badge>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => setEditando(n)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={n.campanhasEmAndamento > 0 || desativar.isPending}
                      title={
                        n.campanhasEmAndamento > 0 ? 'Encerre as campanhas deste nicho antes' : undefined
                      }
                      onClick={() => {
                        if (confirm(`Desativar o nicho "${n.nome}"?`)) desativar.mutate(n.id);
                      }}
                    >
                      Desativar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {prontos && <NichosProntos aoFechar={() => setProntos(false)} />}
      {editando && (
        <FormNicho nicho={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} />
      )}
    </>
  );
}
