import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type EtapaPipeline, type PapelEtapa, type Pipeline, ROTULO_PAPEL } from '../api';
import { Drawer } from './Drawer';
import { ForaDoPlano } from './ForaDoPlano';
import { ErroDaApi, Mensagem } from './Formulario';
import { useRecurso } from './Sessao';

export const PAPEIS: PapelEtapa[] = [
  'a_abordar',
  'abordado',
  'respondeu',
  'reuniao',
  'proposta',
  'ganho',
  'perdido',
];

/** Cores sugeridas para as etapas (o usuário pode escolher qualquer outra). */
const CORES = [
  '#94a3b8',
  '#3b82f6',
  '#14b8a6',
  '#f59e0b',
  '#f97316',
  '#e11d48',
  '#8b5cf6',
  '#16a34a',
  '#ef4444',
];

export function usePipelines() {
  return useQuery({ queryKey: ['pipelines'], queryFn: () => api<Pipeline[]>('/funil/pipelines') });
}

function useAtualizarTudo() {
  const cliente = useQueryClient();
  return () => {
    cliente.invalidateQueries({ queryKey: ['pipelines'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
    cliente.invalidateQueries({ queryKey: ['funil'] });
  };
}

function LinhaEtapa(props: {
  e: EtapaPipeline;
  primeira: boolean;
  ultima: boolean;
  aoErro: (e: unknown) => void;
}) {
  const { e } = props;
  const atualizar = useAtualizarTudo();
  const [nome, setNome] = useState(e.nome);
  useEffect(() => setNome(e.nome), [e.nome]);

  const salvar = useMutation({
    mutationFn: (corpo: Partial<Pick<EtapaPipeline, 'nome' | 'cor' | 'papel' | 'ordem'>>) =>
      api(`/funil/etapas/${e.id}`, { metodo: 'PATCH', corpo }),
    onSuccess: atualizar,
    onError: props.aoErro,
  });
  const apagar = useMutation({
    mutationFn: () => api(`/funil/etapas/${e.id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
    onError: props.aoErro,
  });
  const [confirmando, setConfirmando] = useState(false);

  return (
    <li className="etapa-edit" style={{ borderLeftColor: e.cor }}>
      <div className="etapa-edit__linha">
        <label className="etapa-edit__cor" title="Cor da etapa">
          <span className="pp-sr">Cor de {e.nome}</span>
          <input type="color" value={e.cor} onChange={(x) => salvar.mutate({ cor: x.target.value })} />
        </label>
        <label className="pp-sr" htmlFor={`etapa-nome-${e.id}`}>
          Nome da etapa
        </label>
        <input
          id={`etapa-nome-${e.id}`}
          className="filtro etapa-edit__nome"
          value={nome}
          maxLength={40}
          onChange={(x) => setNome(x.target.value)}
          onBlur={() => nome.trim() && nome.trim() !== e.nome && salvar.mutate({ nome: nome.trim() })}
          onKeyDown={(x) => x.key === 'Enter' && (x.target as HTMLInputElement).blur()}
        />
        <div className="etapa-edit__botoes">
          <button
            type="button"
            className="botao-icone"
            aria-label={`Subir ${e.nome}`}
            title="Subir"
            disabled={props.primeira || salvar.isPending}
            onClick={() => salvar.mutate({ ordem: e.ordem - 1 })}
          >
            <Icon name="chevron-down" size={16} className="girar-180" />
          </button>
          <button
            type="button"
            className="botao-icone"
            aria-label={`Descer ${e.nome}`}
            title="Descer"
            disabled={props.ultima || salvar.isPending}
            onClick={() => salvar.mutate({ ordem: e.ordem + 1 })}
          >
            <Icon name="chevron-down" size={16} />
          </button>
          <button
            type="button"
            className="botao-icone"
            aria-label={`Apagar ${e.nome}`}
            title="Apagar etapa"
            onClick={() => setConfirmando(true)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
      <div className="etapa-edit__linha">
        <label htmlFor={`etapa-papel-${e.id}`} className="quieto" style={{ fontSize: 12 }}>
          Funciona como
        </label>
        <select
          id={`etapa-papel-${e.id}`}
          className="filtro"
          value={e.papel}
          onChange={(x) => salvar.mutate({ papel: x.target.value as PapelEtapa })}
        >
          {PAPEIS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PAPEL[p]}
            </option>
          ))}
        </select>
      </div>
      {confirmando && (
        <div className="confirmar">
          <span>Apagar a etapa “{e.nome}”? Só dá para apagar se não tiver leads nela.</span>
          <div className="acoes">
            <Button size="sm" variant="danger" disabled={apagar.isPending} onClick={() => apagar.mutate()}>
              Apagar etapa
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
              Manter
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Editor dos pipelines: renomear, criar e apagar pipelines; criar, ordenar, colorir e apagar etapas. */
export function EditarPipelines(props: {
  pipelineId: number | null;
  aoFechar: () => void;
  aoTrocar: (id: number) => void;
}) {
  const q = usePipelines();
  const atualizar = useAtualizarTudo();
  const [erro, setErro] = useState<unknown>(null);
  const pipeline = q.data?.find((p) => p.id === props.pipelineId) ?? q.data?.[0];
  const [nomePipe, setNomePipe] = useState('');
  useEffect(() => setNomePipe(pipeline?.nome ?? ''), [pipeline?.nome]);
  const [nova, setNova] = useState<{ nome: string; papel: PapelEtapa; cor: string }>({
    nome: '',
    papel: 'proposta',
    cor: CORES[3] as string,
  });
  const [novoPipe, setNovoPipe] = useState('');
  const variosFunis = useRecurso('funis');
  const [apagandoPipe, setApagandoPipe] = useState(false);

  const renomear = useMutation({
    mutationFn: (nome: string) =>
      api(`/funil/pipelines/${pipeline?.id}`, { metodo: 'PATCH', corpo: { nome } }),
    onSuccess: atualizar,
    onError: setErro,
  });
  const criarEtapa = useMutation({
    mutationFn: () => api(`/funil/pipelines/${pipeline?.id}/etapas`, { metodo: 'POST', corpo: nova }),
    onSuccess: () => {
      atualizar();
      setNova((n) => ({ ...n, nome: '' }));
    },
    onError: setErro,
  });
  const criarPipe = useMutation({
    mutationFn: () => api<{ id: number }>('/funil/pipelines', { metodo: 'POST', corpo: { nome: novoPipe } }),
    onSuccess: (p) => {
      atualizar();
      setNovoPipe('');
      props.aoTrocar(p.id);
    },
    onError: setErro,
  });
  const apagarPipe = useMutation({
    mutationFn: () => api(`/funil/pipelines/${pipeline?.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      atualizar();
      setApagandoPipe(false);
      const outro = q.data?.find((p) => p.id !== pipeline?.id);
      if (outro) props.aoTrocar(outro.id);
    },
    onError: setErro,
  });

  const enviarEtapa = (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova.nome.trim()) criarEtapa.mutate();
  };

  return (
    <Drawer titulo="Pipelines e etapas" barra="Funil" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {q.error && <ErroDaApi erro={q.error} />}
        {!pipeline ? (
          <div className="esqueleto" />
        ) : (
          <div className="pilha" style={{ gap: 20 }}>
            <div className="segmentos" role="tablist" aria-label="Pipeline">
              {q.data?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === pipeline.id}
                  className="segmento"
                  data-ativo={p.id === pipeline.id || undefined}
                  onClick={() => props.aoTrocar(p.id)}
                >
                  {p.nome}
                </button>
              ))}
            </div>

            <div className="campo">
              <label htmlFor="pipe-nome">Nome do pipeline</label>
              <input
                id="pipe-nome"
                className="filtro"
                value={nomePipe}
                maxLength={40}
                onChange={(e) => setNomePipe(e.target.value)}
                onBlur={() =>
                  nomePipe.trim() && nomePipe.trim() !== pipeline.nome && renomear.mutate(nomePipe.trim())
                }
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>

            <Mensagem tipo="ok">
              <b>“Funciona como”</b> diz ao sistema o que a etapa significa: a cadência de follow-up, a IA e
              os relatórios usam isso. Quando o lead marca reunião, ele vai sozinho para a primeira etapa de
              “Reunião”, mesmo que ela esteja em outro pipeline (é assim que passa do SDR para o Closer).
            </Mensagem>

            <ErroDaApi erro={erro} />

            <ol className="etapas-edit">
              {pipeline.etapas.map((e, i) => (
                <LinhaEtapa
                  key={e.id}
                  e={e}
                  primeira={i === 0}
                  ultima={i === pipeline.etapas.length - 1}
                  aoErro={setErro}
                />
              ))}
            </ol>

            <form className="form" onSubmit={enviarEtapa}>
              <h3 className="subtitulo">Nova etapa</h3>
              <div className="barra">
                <label className="pp-sr" htmlFor="nova-etapa">
                  Nome
                </label>
                <input
                  id="nova-etapa"
                  className="filtro"
                  style={{ flex: '1 1 160px' }}
                  placeholder="Ex.: Visita técnica"
                  maxLength={40}
                  value={nova.nome}
                  onChange={(e) => setNova({ ...nova, nome: e.target.value })}
                />
                <label className="pp-sr" htmlFor="nova-papel">
                  Funciona como
                </label>
                <select
                  id="nova-papel"
                  className="filtro"
                  value={nova.papel}
                  onChange={(e) => setNova({ ...nova, papel: e.target.value as PapelEtapa })}
                >
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="cores">
                <legend className="pp-sr">Cor</legend>
                {CORES.map((c) => (
                  <label key={c} className="cores__item" style={{ background: c }}>
                    <input
                      type="radio"
                      name="nova-cor"
                      className="pp-sr"
                      checked={nova.cor === c}
                      onChange={() => setNova({ ...nova, cor: c })}
                    />
                    <span className="pp-sr">{c}</span>
                  </label>
                ))}
              </fieldset>
              <div className="acoes">
                <Button type="submit" icon="plus" disabled={!nova.nome.trim() || criarEtapa.isPending}>
                  Adicionar etapa
                </Button>
              </div>
            </form>

            {!variosFunis && <ForaDoPlano recurso="funis" compacto />}
            <form
              className="form"
              hidden={!variosFunis}
              onSubmit={(e) => {
                e.preventDefault();
                setErro(null);
                if (novoPipe.trim()) criarPipe.mutate();
              }}
            >
              <h3 className="subtitulo">Outro pipeline</h3>
              <div className="barra">
                <label className="pp-sr" htmlFor="novo-pipe">
                  Nome do novo pipeline
                </label>
                <input
                  id="novo-pipe"
                  className="filtro"
                  style={{ flex: '1 1 160px' }}
                  placeholder="Ex.: Pós-venda"
                  maxLength={40}
                  value={novoPipe}
                  onChange={(e) => setNovoPipe(e.target.value)}
                />
                <Button type="submit" icon="plus" disabled={!novoPipe.trim() || criarPipe.isPending}>
                  Criar pipeline
                </Button>
              </div>
              <span className="campo__dica">
                Começa com as etapas Em andamento, Ganho e Perdido; ajuste como quiser.
              </span>
            </form>

            {(q.data?.length ?? 0) > 1 &&
              (apagandoPipe ? (
                <div className="confirmar">
                  <span>
                    Apagar o pipeline “{pipeline.nome}” e as etapas dele? Só dá se não tiver leads nele.
                  </span>
                  <div className="acoes">
                    <Button size="sm" variant="danger" onClick={() => apagarPipe.mutate()}>
                      Apagar pipeline
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setApagandoPipe(false)}>
                      Manter
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setApagandoPipe(true)}>
                    Apagar o pipeline {pipeline.nome}
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
