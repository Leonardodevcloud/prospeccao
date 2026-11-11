import {
  type ChamadaFinal,
  OBJETIVO,
  type ObjetivoCarrossel,
  ROTULO_DIVULGAR,
} from '@prospeccao/shared/carrosseis-time';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtQuando } from '../formatar';
import { type SituacaoCarrosseis, useDivulgar } from './dados';

/**
 * Ideias e o que o time aprendeu (v134): o estrategista propõe 10 ideias para as próximas 2 semanas,
 * cada uma com de onde veio (a campanha, o que os clientes perguntam, os números do Instagram). Ao
 * lado, o que o time aprendeu com os posts da conta e as contas de referência.
 */

export interface IdeiaInicial {
  ideiaId: number;
  assunto: string;
  objetivo: ObjetivoCarrossel;
  slides: number | null;
  chamada: ChamadaFinal;
}

interface Ideia {
  id: number;
  titulo: string;
  gancho: string;
  formato: string;
  objetivo: ObjetivoCarrossel;
  slides: number | null;
  chamada: ChamadaFinal;
  teste: boolean;
  fontes: { rotulo: string; texto: string }[];
  criadoEm: string;
  usadaEm: string | null;
  carrosselId: number | null;
}

interface Aprendido {
  aprendizados: {
    id: string;
    rotulo: string;
    metrica: string;
    vezes: number;
    posts: number;
    confianca: 'testando' | 'media' | 'alta';
    evita: boolean;
  }[];
  melhorHorario: { texto: string; posts: number } | null;
  preferencias: { texto: string; de: number; em: number }[];
  posts: number;
  doCrm: number;
}

interface ContaReferencia {
  id: number;
  usuario: string;
  nome: string | null;
  seguidores: number | null;
  posts: unknown[];
  lidoEm: string | null;
  erro: string | null;
}

const MOSTRAR = 3;
const vezes = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`;
const CONFIANCA = { testando: 'ainda testando', media: 'confiança média', alta: 'confiança alta' } as const;

export function AbaIdeias(props: {
  situacao: SituacaoCarrosseis;
  aoCriar: (i: IdeiaInicial) => void;
  aoCerebro: () => void;
}) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['carrosseis', 'ideias'],
    queryFn: () => api<{ ideias: Ideia[]; buscando: boolean; iaLigada: boolean }>('/carrosseis/ideias'),
    refetchInterval: (x) => (x.state.data?.buscando ? 3000 : false),
  });
  const [todas, setTodas] = useState(false);
  const buscar = useMutation({
    mutationFn: () => api('/carrosseis/ideias/buscar', { metodo: 'POST' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'ideias'] }),
  });
  const descartar = useMutation({
    mutationFn: (id: number) => api(`/carrosseis/ideias/${id}/descartar`, { metodo: 'POST' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'ideias'] }),
  });
  const { ia } = props.situacao;
  const buscando = !!q.data?.buscando || buscar.isPending;
  const ideias = q.data?.ideias ?? [];
  const novas = ideias.filter((i) => !i.usadaEm);
  const usadas = ideias.filter((i) => i.usadaEm);
  const vistas = todas ? novas : novas.slice(0, MOSTRAR);

  return (
    <div className="ideias">
      <div className="ideias__topo">
        <p>
          O estrategista junta o que você quer divulgar, o que os clientes perguntam e o que já deu certo no
          seu Instagram.
        </p>
        <Button
          variant={novas.length ? 'secondary' : 'primary'}
          icon="search"
          disabled={!ia.ligada || !ia.cerebroConferido || buscando}
          onClick={() => buscar.mutate()}
        >
          {buscando
            ? 'O estrategista está pensando…'
            : novas.length
              ? 'Buscar ideias de novo'
              : 'Buscar ideias'}
        </Button>
      </div>
      {!ia.ligada ? (
        <Mensagem tipo="aviso">O time de IA ainda não foi ligado na plataforma. Fale com a gente.</Mensagem>
      ) : !ia.cerebroConferido ? (
        <div className="novo-time__antes" role="note">
          <Icon name="sparkles" size={18} />
          <span>
            <b>Antes das ideias, confira o cérebro da marca.</b> É de lá que o estrategista tira o que a
            empresa vende e o que os clientes perguntam.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoCerebro}>
            Abrir o cérebro da marca
          </Button>
        </div>
      ) : null}
      {buscar.error && <ErroDaApi erro={buscar.error} />}

      <ODivulgar aoCerebro={props.aoCerebro} />

      <div className="ideias__corpo">
        <section className="ideias__lista" aria-label="Ideias">
          <h2>Ideias para as próximas 2 semanas</h2>
          {q.isPending ? (
            <div className="esqueleto" style={{ height: 180 }} />
          ) : q.error ? (
            <ErroDaApi erro={q.error} />
          ) : !novas.length ? (
            <div className="ideias__vazio">
              <Icon name="sparkles" size={20} />
              <p>
                {buscando
                  ? 'O estrategista está lendo as campanhas, as conversas e os números dos posts. Leva uns 30 segundos.'
                  : 'Ainda não há ideias. Peça ao estrategista: ele propõe 10 ideias, cada uma com de onde veio.'}
              </p>
            </div>
          ) : (
            <>
              {vistas.map((i, n) => (
                <article key={i.id} className={`ideia${i.teste ? ' ideia--teste' : ''}`}>
                  <div className="ideia__cabeca">
                    <span className="ideia__titulo">
                      <b>{i.titulo}</b>
                      <span>
                        Gancho: “{i.gancho}” · {i.formato || OBJETIVO[i.objetivo].nome}
                      </span>
                    </span>
                    <div className="ideia__acoes">
                      <Button
                        size="sm"
                        variant={n === 0 ? 'primary' : 'secondary'}
                        onClick={() =>
                          props.aoCriar({
                            ideiaId: i.id,
                            assunto: `${i.titulo}\nGancho: ${i.gancho}\nFormato: ${i.formato}`,
                            objetivo: i.objetivo,
                            slides: i.slides,
                            chamada: i.chamada,
                          })
                        }
                      >
                        Criar carrossel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        aria-label={`Descartar a ideia ${i.titulo}`}
                        title="Descartar"
                        disabled={descartar.isPending}
                        onClick={() => descartar.mutate(i.id)}
                      />
                    </div>
                  </div>
                  <ul className="ideia__fontes">
                    {i.fontes.map((f) => (
                      <li key={`${f.rotulo}-${f.texto}`}>
                        <span className={`ideia__fonte${f.rotulo === 'TESTE' ? ' ideia__fonte--teste' : ''}`}>
                          {f.rotulo}
                        </span>
                        {f.texto}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
              {novas.length > MOSTRAR && (
                <button type="button" className="ideia ideia--mais" onClick={() => setTodas((x) => !x)}>
                  <span>{todas ? 'Mostrar menos' : `Mais ${novas.length - MOSTRAR} ideias`}</span>
                  <Icon name="chevron-down" size={16} />
                </button>
              )}
            </>
          )}
          {usadas.length > 0 && (
            <p className="ideias__usadas">
              {usadas.length === 1
                ? '1 ideia já virou carrossel'
                : `${usadas.length} ideias já viraram carrossel`}{' '}
              nos últimos 30 dias.
            </p>
          )}
        </section>

        <aside className="ideias__lado">
          <OQueAprendeu />
          <ContasDeReferencia />
        </aside>
      </div>
    </div>
  );
}

function ODivulgar(props: { aoCerebro: () => void }) {
  const q = useDivulgar();
  const itens = q.data?.itens ?? [];
  return (
    <section className="ideias__divulgar" aria-label="O que divulgar">
      <div className="ideias__divulgar-topo">
        <h2>O que você quer divulgar</h2>
        <span>O estrategista põe isto na frente de tudo</span>
      </div>
      <div className="ideias__chips">
        {itens.map((d) => (
          <span key={d.id} className="ideias__chip">
            <b>{d.titulo}</b>
            <span>{d.validade || ROTULO_DIVULGAR[d.tipo]}</span>
          </span>
        ))}
        <Button variant="ghost" size="sm" icon="plus" onClick={props.aoCerebro}>
          Campanha ou assunto
        </Button>
      </div>
    </section>
  );
}

function OQueAprendeu() {
  const q = useQuery({
    queryKey: ['carrosseis', 'aprendizados'],
    queryFn: () => api<Aprendido>('/carrosseis/aprendizados'),
  });
  const d = q.data;
  return (
    <section className="ideias__caixa" aria-label="O que o time aprendeu">
      <div>
        <h2>O que o time aprendeu</h2>
        <span className="ideias__nota">
          {d && d.posts
            ? `De ${d.posts} posts seus${d.doCrm ? ` (${d.doCrm} feitos aqui)` : ''}. Medido contra a sua própria mediana, com peso maior para leads.`
            : 'Medido contra a sua própria mediana, com peso maior para leads.'}
        </span>
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 120 }} />
      ) : q.error ? (
        <ErroDaApi erro={q.error} />
      ) : !d!.aprendizados.length && !d!.melhorHorario ? (
        <p className="ideias__nota">
          Ainda é cedo: o time precisa de pelo menos 3 posts com a mesma característica (e os números do
          Instagram conectado) para dizer o que funciona. Até lá, ele segue o manual.
        </p>
      ) : (
        <ul className="aprendizados">
          {d!.aprendizados.map((a) => (
            <li key={a.id}>
              <span className="aprendizados__linha">
                <Icon name={a.evita ? 'trending-down' : 'trending-up'} size={14} />
                <b>{a.rotulo}</b>
                <span className={`aprendizados__vezes${a.evita ? ' aprendizados__vezes--ruim' : ''}`}>
                  {vezes(a.vezes)} {a.metrica}
                </span>
              </span>
              <span className="ideias__nota">
                {a.posts} posts · {a.evita ? 'o time evita' : CONFIANCA[a.confianca]}
              </span>
            </li>
          ))}
          {d!.melhorHorario && (
            <li>
              <span className="aprendizados__linha">
                <Icon name="clock" size={14} />
                <b>Melhor horário</b>
                <span className="aprendizados__hora">{d!.melhorHorario.texto}</span>
              </span>
              <span className="ideias__nota">pelos números de {d!.melhorHorario.posts} posts</span>
            </li>
          )}
        </ul>
      )}
      {d?.preferencias.map((p) => (
        <span key={p.texto} className="ideias__nota">
          Também conta o que você muda no editor: em {p.de} de {p.em} carrosséis. {p.texto}
        </span>
      ))}
    </section>
  );
}

function ContasDeReferencia() {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['carrosseis', 'referencias-contas'],
    queryFn: () => api<{ contas: ContaReferencia[]; max: number }>('/carrosseis/referencias-contas'),
  });
  const [usuario, setUsuario] = useState('');
  const [abrir, setAbrir] = useState(false);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'referencias-contas'] });
  const adicionar = useMutation({
    mutationFn: () => api('/carrosseis/referencias-contas', { metodo: 'POST', corpo: { usuario } }),
    onSuccess: () => {
      setUsuario('');
      setAbrir(false);
      atualizar();
    },
  });
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/carrosseis/referencias-contas/${id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const contas = q.data?.contas ?? [];
  const cheio = contas.length >= (q.data?.max ?? 5);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (usuario.trim()) adicionar.mutate();
  };
  return (
    <section className="ideias__caixa" aria-label="Contas de referência">
      <h2>Contas de referência</h2>
      <span className="ideias__nota">
        Perfis profissionais que você admira ou concorrentes. O time lê os números públicos dos posts para ver
        o que funciona no nicho. Nunca copia.
      </span>
      {contas.length > 0 && (
        <ul className="referencias">
          {contas.map((c) => (
            <li key={c.id}>
              <Badge tone="outline">@{c.usuario}</Badge>
              <span className="ideias__nota">
                {c.erro
                  ? c.erro
                  : c.lidoEm
                    ? `${c.posts.length} posts lidos ${fmtQuando(c.lidoEm)}${c.seguidores ? ` · ${c.seguidores.toLocaleString('pt-BR')} seguidores` : ''}`
                    : 'Lendo…'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                aria-label={`Tirar @${c.usuario}`}
                title="Tirar"
                onClick={() => apagar.mutate(c.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {abrir ? (
        <form className="referencias__form" onSubmit={enviar}>
          <label htmlFor="ref-usuario" className="referencias__rotulo">
            O @ do perfil
          </label>
          <input
            id="ref-usuario"
            className="filtro"
            placeholder="@perfil"
            value={usuario}
            maxLength={120}
            onChange={(e) => setUsuario(e.target.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!usuario.trim() || adicionar.isPending}>
            {adicionar.isPending ? 'Lendo…' : 'Adicionar'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAbrir(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        !cheio && (
          <div>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setAbrir(true)}>
              Conta
            </Button>
          </div>
        )
      )}
      {adicionar.error && <ErroDaApi erro={adicionar.error} />}
    </section>
  );
}
