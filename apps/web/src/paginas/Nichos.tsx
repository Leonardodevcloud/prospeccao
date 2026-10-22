import { nichoEntrada, PORTES, ROTULO_PORTE } from '@prospeccao/shared/dominio';
import {
  GRUPOS_NICHOS,
  NICHOS_PRONTOS,
  type NichoPronto,
  SUGESTOES_PESSOAS,
} from '@prospeccao/shared/nichos-prontos';
import { Badge, Button, EmptyState, Icon, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type Nicho } from '../api';
import { Modal } from '../componentes/Drawer';
import { CampoEtiquetas, ErroDaApi, limparLista, Mensagem } from '../componentes/Formulario';
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
  palavrasPositivas: [],
  palavrasNegativas: [],
  cargosAlvo: [],
  portes: [...PORTES],
  idadeMinimaAnos: '0',
  excluirMei: true,
};

const daLista = (p: NichoPronto): Rascunho => ({
  ...VAZIO,
  nome: p.nome,
  cnaes: p.cnaes,
  termosMaps: p.termosMaps,
  palavrasPositivas: p.palavrasPositivas,
  palavrasNegativas: p.palavrasNegativas,
});

const doNicho = (n: Nicho): Rascunho => ({
  ...n,
  cnaes: n.cnaes.map(formatarCnae),
  idadeMinimaAnos: String(n.idadeMinimaAnos),
});

const prontoPeloNome = (nome: string) =>
  NICHOS_PRONTOS.find((p) => p.nome.toLowerCase() === nome.trim().toLowerCase()) ?? null;

/**
 * Personalizar um nicho (pronto, próprio ou já cadastrado). O que manda é o nome e os sinais; a
 * busca (Maps, CNAEs, o que descartar) vem sugerida e o cliente ajusta como achar melhor.
 */
function EditorNicho(props: {
  nicho: Nicho | null;
  pronto: NichoPronto | null;
  aoVoltar?: () => void;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const { nicho } = props;
  const base = props.pronto ?? (nicho ? prontoPeloNome(nicho.nome) : null);
  const [f, setF] = useState<Rascunho>(nicho ? doNicho(nicho) : props.pronto ? daLista(props.pronto) : VAZIO);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const lista = (campo: keyof Rascunho) => (v: string[]) => setF({ ...f, [campo]: v });

  const salvar = useMutation({
    mutationFn: (dados: unknown) =>
      nicho
        ? api<Nicho>(`/nichos/${nicho.id}`, { metodo: 'PATCH', corpo: dados })
        : api<Nicho>('/nichos', { metodo: 'POST', corpo: dados }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['nichos'] });
      props.aoFechar();
    },
  });

  const enviar = (e?: FormEvent) => {
    e?.preventDefault();
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

  // Nicho próprio: o próprio nome já serve de busca no Maps.
  const nomeComoBusca = f.nome.trim().length > 2 ? [f.nome.trim().toLowerCase()] : [];
  const proprio = !nicho && !props.pronto;

  return (
    <Modal
      titulo={nicho ? `Editar ${nicho.nome}` : proprio ? 'Nicho personalizado' : props.pronto!.nome}
      subtitulo={
        proprio
          ? 'Dê um nome e diga os sinais do cliente que você procura. A busca você monta como preferir.'
          : 'Tudo aqui é sugestão: tire, troque ou acrescente o que fizer sentido para a sua busca.'
      }
      antes={
        props.aoVoltar && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Voltar para a lista de nichos"
            onClick={props.aoVoltar}
          >
            <Icon name="arrow-right" size={16} className="icone-voltar" />
          </Button>
        )
      }
      aoFechar={props.aoFechar}
      rodape={
        <>
          {(erroLocal || salvar.error) && (
            <div className="modal__erro">
              {erroLocal ? <Mensagem tipo="erro">{erroLocal}</Mensagem> : <ErroDaApi erro={salvar.error} />}
            </div>
          )}
          <Button variant="primary" icon="check" type="submit" form="form-nicho" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : nicho ? 'Salvar nicho' : 'Criar nicho'}
          </Button>
          <Button variant="ghost" onClick={props.aoVoltar ?? props.aoFechar}>
            {props.aoVoltar ? 'Voltar' : 'Cancelar'}
          </Button>
        </>
      }
    >
      <form id="form-nicho" className="form editor-nicho" onSubmit={enviar} noValidate>
        <TextField
          rotulo="Nome do nicho"
          value={f.nome}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, nome: e.target.value })}
          placeholder="Ex.: Lojas de tintas"
        />
        <div className="editor-nicho__destaque">
          <CampoEtiquetas
            id="sinais"
            rotulo="Sinais de bom lead"
            valor={f.palavrasPositivas}
            aoMudar={lista('palavrasPositivas')}
            sugestoes={base?.outrosSinais}
            placeholder="Digite e tecle Enter. Ex.: atacado e varejo"
            dica="Palavras que, no site, no Instagram ou no Google, mostram que a empresa tem o perfil que você procura. Quanto mais aparecem, maior a nota do lead."
          />
        </div>

        <section className="editor-nicho__secao">
          <h3 className="subtitulo">Como achar as empresas</h3>
          <CampoEtiquetas
            id="termos"
            rotulo="Busca no Google Maps"
            valor={f.termosMaps}
            aoMudar={lista('termosMaps')}
            sugestoes={base?.termosMaps ?? nomeComoBusca}
            placeholder="Ex.: loja de tintas"
            dica="Cada termo é pesquisado em cada cidade da campanha."
          />
          <CampoEtiquetas
            id="cnaes"
            rotulo="CNAEs"
            mono
            valor={f.cnaes}
            aoMudar={lista('cnaes')}
            sugestoes={base?.cnaes}
            normalizar={formatarCnae}
            placeholder="Ex.: 4741-5/00"
            dica={
              <>
                Atividade da empresa na Receita (principal ou secundária). Não sabe o código? Procure o ramo
                em{' '}
                <a href="https://concla.ibge.gov.br/busca-online-cnae.html" target="_blank" rel="noreferrer">
                  concla.ibge.gov.br
                </a>
                .
              </>
            }
          />
          <CampoEtiquetas
            id="negativas"
            rotulo="Palavras que descartam"
            valor={f.palavrasNegativas}
            aoMudar={lista('palavrasNegativas')}
            sugestoes={base?.palavrasNegativas}
            placeholder="Ex.: oficina"
            dica="Lugar do Maps com uma delas no nome ou na categoria fica de fora."
          />
        </section>

        <section className="editor-nicho__secao">
          <h3 className="subtitulo">Pessoas a priorizar (opcional)</h3>
          <CampoEtiquetas
            id="pessoas"
            rotulo="Funções"
            valor={f.cargosAlvo}
            aoMudar={lista('cargosAlvo')}
            sugestoes={SUGESTOES_PESSOAS}
            placeholder="Deixe vazio para qualquer pessoa da empresa"
            dica="Vazio: vale qualquer pessoa da empresa (dono, sócio, gerente, vendedor, atendente). Preencha só se quiser que essas funções venham primeiro."
          />
        </section>

        <div>
          <button
            type="button"
            className="link-botao"
            aria-expanded={maisFiltros}
            onClick={() => setMaisFiltros(!maisFiltros)}
          >
            {maisFiltros ? 'Esconder filtros de porte e idade' : 'Filtros de porte e idade'}
          </button>
        </div>
        {maisFiltros && (
          <section className="editor-nicho__secao">
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
                  Microempreendedor individual costuma ser pequeno demais: não aparece nos leads nem gasta
                  enriquecimento.
                </span>
              </span>
            </label>
          </section>
        )}
      </form>
    </Modal>
  );
}

/** Escolher o ponto de partida: um nicho pronto ou um personalizado. */
function EscolherNicho(props: { aoEscolher: (p: NichoPronto | null) => void; aoFechar: () => void }) {
  const q = useQuery({
    queryKey: ['nichos', 'prontos'],
    queryFn: () => api<(NichoPronto & { jaTem: boolean })[]>('/nichos/prontos'),
  });

  return (
    <Modal
      titulo="Novo nicho"
      subtitulo="Escolha um ponto de partida. Na próxima tela você personaliza os sinais e a busca."
      largura="larga"
      aoFechar={props.aoFechar}
    >
      <ErroDaApi erro={q.error} />
      <div className="pilha" style={{ gap: 20 }}>
        <button
          type="button"
          className="cartao-nicho cartao-nicho--proprio"
          onClick={() => props.aoEscolher(null)}
        >
          <span className="cartao-nicho__icone">
            <Icon name="plus" size={18} />
          </span>
          <span className="cartao-nicho__texto">
            <b className="cartao-nicho__nome">Nicho personalizado</b>
            <span className="quieto">Digite o nome e os sinais do cliente que você procura.</span>
          </span>
        </button>
        {GRUPOS_NICHOS.map((g) => {
          const doGrupo = q.data?.filter((n) => n.grupo === g) ?? [];
          if (!doGrupo.length) return null;
          return (
            <section key={g} className="pilha" style={{ gap: 8 }}>
              <h3 className="subtitulo">{g}</h3>
              <div className="cartoes-nicho">
                {doGrupo.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="cartao-nicho"
                    disabled={n.jaTem}
                    onClick={() => props.aoEscolher(n)}
                  >
                    <span className="cartao-nicho__texto">
                      <b className="cartao-nicho__nome">{n.nome}</b>
                      <span className="quieto">{n.descricao}</span>
                      <span className="cartao-nicho__sinais">
                        {n.palavrasPositivas.slice(0, 3).map((s) => (
                          <span key={s} className="cartao-nicho__sinal">
                            {s}
                          </span>
                        ))}
                      </span>
                    </span>
                    {n.jaTem && <Badge tone="outline">Já cadastrado</Badge>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

type Tela =
  | null
  | { tipo: 'escolher' }
  | { tipo: 'editar'; nicho: Nicho | null; pronto: NichoPronto | null; deEscolha: boolean };

export function Nichos() {
  const cliente = useQueryClient();
  const [tela, setTela] = useState<Tela>(null);
  const nichos = useQuery({ queryKey: ['nichos'], queryFn: () => api<Nicho[]>('/nichos') });
  const desativar = useMutation({
    mutationFn: (id: number) => api(`/nichos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['nichos'] }),
  });
  const novo = () => setTela({ tipo: 'escolher' });

  return (
    <>
      <div className="topo">
        <div>
          <h1>Nichos</h1>
          <p>
            Quem prospectar: o tipo de empresa, os sinais de um bom cliente e como achar no Google e na
            Receita.
          </p>
        </div>
        <div className="acoes">
          <Button variant="primary" icon="plus" onClick={novo}>
            Novo nicho
          </Button>
        </div>
      </div>

      <ErroDaApi erro={nichos.error ?? desativar.error} />

      {nichos.data?.length === 0 ? (
        <div className="pp-panel">
          <EmptyState
            icone="store"
            titulo="Nenhum nicho cadastrado"
            texto="Escolha um dos nichos prontos (autopeças, farmácias, pet shops…) ou monte o seu. Depois crie uma campanha com ele."
            acao={
              <Button size="sm" variant="primary" icon="plus" onClick={novo}>
                Novo nicho
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
                <th>Sinais</th>
                <th>Busca no Maps</th>
                <th>CNAEs</th>
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
                    {n.palavrasPositivas.length ? (
                      n.palavrasPositivas.slice(0, 4).join(', ') +
                      (n.palavrasPositivas.length > 4 ? ` +${n.palavrasPositivas.length - 4}` : '')
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td>{n.termosMaps.join(', ')}</td>
                  <td>
                    <span className="mono">{n.cnaes.map(formatarCnae).join(' · ')}</span>
                  </td>
                  <td>
                    {n.campanhasEmAndamento ? (
                      <Badge tone="brand">{n.campanhasEmAndamento} em andamento</Badge>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTela({ tipo: 'editar', nicho: n, pronto: null, deEscolha: false })}
                    >
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

      {tela?.tipo === 'escolher' && (
        <EscolherNicho
          aoEscolher={(pronto) => setTela({ tipo: 'editar', nicho: null, pronto, deEscolha: true })}
          aoFechar={() => setTela(null)}
        />
      )}
      {tela?.tipo === 'editar' && (
        <EditorNicho
          key={tela.nicho?.id ?? tela.pronto?.id ?? 'proprio'}
          nicho={tela.nicho}
          pronto={tela.pronto}
          aoVoltar={tela.deEscolha ? novo : undefined}
          aoFechar={() => setTela(null)}
        />
      )}
    </>
  );
}
