import {
  type DivulgarEntrada,
  type DivulgarItem,
  type DossieMarca,
  type PedidoDoTime,
  ROTULO_DIVULGAR,
  TIPOS_DIVULGAR,
} from '@prospeccao/shared/carrosseis-time';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Drawer } from '../componentes/Drawer';
import { CampoEtiquetas, ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtData, fmtNumero, fmtQuando } from '../formatar';
import { type CerebroDaConta, useCerebro, useDivulgar } from './dados';

/**
 * O cérebro da marca: o dossiê que o time de IA lê antes de cada carrossel (a IA monta o rascunho
 * com o que o CRM sabe, o administrador corrige e confere) e o que divulgar no mês.
 */

export function AbaCerebro() {
  const q = useCerebro();
  if (q.isPending) return <div className="esqueleto" style={{ height: 480 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  return (
    <div className="cerebro">
      {/* O rascunho novo da IA chegou com a tela aberta: a chave muda e o formulário troca. */}
      <FormDossie key={q.data.geradoEm ?? 'sem-rascunho'} c={q.data} />
      <Divulgar />
    </div>
  );
}

const andando = (p: PedidoDoTime | null) => p?.situacao === 'fila' || p?.situacao === 'trabalhando';

function ListaTextos(props: {
  id: string;
  rotulo: string;
  dica?: string;
  valor: string[];
  max: number;
  limite: number;
  aoMudar: (v: string[]) => void;
  placeholder?: string;
}) {
  const [novo, setNovo] = useState('');
  const incluir = () => {
    const t = novo.trim().slice(0, props.limite);
    if (t && props.valor.length < props.max) props.aoMudar([...props.valor, t]);
    setNovo('');
  };
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      {props.dica && <span className="campo__dica">{props.dica}</span>}
      {props.valor.length > 0 && (
        <ul className="cerebro__lista">
          {props.valor.map((v, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a lista é editada pela posição
            <li key={i} className="cerebro__linha">
              <input
                className="filtro"
                aria-label={`${props.rotulo} ${i + 1}`}
                value={v}
                maxLength={props.limite}
                onChange={(e) => props.aoMudar(props.valor.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                aria-label="Tirar"
                onClick={() => props.aoMudar(props.valor.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}
      {props.valor.length < props.max && (
        <div className="cerebro__linha">
          <input
            id={props.id}
            className="filtro"
            value={novo}
            maxLength={props.limite}
            placeholder={props.placeholder ?? 'Escreva e tecle Enter'}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                incluir();
              }
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            aria-label="Incluir"
            onClick={incluir}
            disabled={!novo.trim()}
          />
        </div>
      )}
    </div>
  );
}

function FormDossie(props: { c: CerebroDaConta }) {
  const { c } = props;
  const cliente = useQueryClient();
  const [d, setD] = useState<DossieMarca>(c.dossie);
  const [mudou, setMudou] = useState(false);
  const mudar = (patch: Partial<DossieMarca>) => {
    setD((x) => ({ ...x, ...patch }));
    setMudou(true);
  };
  const salvar = useMutation({
    mutationFn: (conferir: boolean) =>
      api<CerebroDaConta>('/carrosseis/cerebro', { metodo: 'PUT', corpo: { dossie: d, conferir } }),
    onSuccess: (r) => {
      cliente.setQueryData(['carrosseis', 'cerebro'], { ...c, ...r });
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'situacao'] });
      setMudou(false);
    },
  });
  const gerar = useMutation({
    mutationFn: () => api<PedidoDoTime>('/carrosseis/cerebro/gerar', { metodo: 'POST' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'cerebro'] }),
  });
  const trabalhando = andando(c.pedido);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate(true);
  };
  const vazio = !c.geradoEm && !c.dossie.oQueVende && !c.dossie.publico;

  return (
    <form className="form cerebro__form" onSubmit={enviar}>
      <section className="pp-panel cerebro__cabeca" aria-labelledby="cb-titulo">
        <div className="cerebro__cabeca-texto">
          <h2 id="cb-titulo" className="cerebro__h">
            Cérebro da marca
          </h2>
          <p className="quieto">
            O que o time de IA lê antes de cada carrossel. Ele não inventa nada além do que estiver aqui:
            produto, número, prazo e garantia só entram se estiverem escritos.
          </p>
          <div className="cerebro__estado">
            {trabalhando ? (
              <Badge tone="brand">
                <Icon name="loader" size={12} /> A IA está lendo o que o CRM sabe da empresa…
              </Badge>
            ) : c.conferidoEm && !mudou ? (
              <Badge tone="brand">
                <Icon name="check" size={12} /> Conferido{c.conferidoPor ? ` por ${c.conferidoPor}` : ''}{' '}
                {fmtQuando(c.conferidoEm)}
              </Badge>
            ) : (
              <Badge tone="warning">Ainda não conferido: o time de IA só usa depois de conferir</Badge>
            )}
            {c.geradoEm && <span className="quieto">Rascunho da IA: {fmtQuando(c.geradoEm)}</span>}
          </div>
        </div>
        <div className="cerebro__cabeca-acoes">
          <Button
            variant={vazio ? 'primary' : 'secondary'}
            icon="sparkles"
            onClick={() => {
              if (
                vazio ||
                window.confirm(
                  'Montar de novo com a IA? O rascunho novo completa o que está aqui e precisa ser conferido outra vez.',
                )
              )
                gerar.mutate();
            }}
            disabled={!c.iaLigada || trabalhando || gerar.isPending}
          >
            {vazio ? 'Montar com a IA' : 'Montar de novo com a IA'}
          </Button>
        </div>
      </section>
      {!c.iaLigada && (
        <Mensagem tipo="aviso">
          O time de IA ainda não foi ligado na plataforma: dá para preencher à mão.
        </Mensagem>
      )}
      {c.pedido?.situacao === 'falhou' && (
        <Mensagem tipo="erro">{c.pedido.erro ?? 'A IA não conseguiu montar o rascunho.'}</Mensagem>
      )}
      {gerar.error && <ErroDaApi erro={gerar.error} />}
      {!!c.fontes.length && (
        <p className="quieto cerebro__fontes">
          De onde veio o rascunho:{' '}
          {c.fontes
            .filter((f) => f.quantos > 0)
            .map((f) => `${f.rotulo}${f.quantos > 1 ? ` (${fmtNumero(f.quantos)})` : ''}`)
            .join(' · ') || 'quase nada ainda (preencha à mão o que faltar)'}
        </p>
      )}

      <fieldset className="cerebro__corpo" disabled={trabalhando}>
        <section className="pp-panel cerebro__bloco" aria-labelledby="cb-negocio">
          <h3 id="cb-negocio" className="cerebro__h">
            O negócio
          </h3>
          <div className="campo">
            <label htmlFor="cb-nicho">Nicho</label>
            <input
              id="cb-nicho"
              className="filtro"
              value={d.nicho}
              maxLength={160}
              placeholder="Ex.: autopeças para oficinas e donos de carro em Salvador"
              onChange={(e) => mudar({ nicho: e.target.value })}
            />
          </div>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="cb-publico">Para quem vende</label>
              <textarea
                id="cb-publico"
                rows={4}
                maxLength={600}
                value={d.publico}
                onChange={(e) => mudar({ publico: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="cb-vende">O que vende</label>
              <textarea
                id="cb-vende"
                rows={4}
                maxLength={900}
                value={d.oQueVende}
                placeholder="As linhas principais. O time não fala de produto que não está aqui."
                onChange={(e) => mudar({ oQueVende: e.target.value })}
              />
            </div>
          </div>
          <ListaTextos
            id="cb-diferenciais"
            rotulo="Diferenciais"
            valor={d.diferenciais}
            max={8}
            limite={220}
            aoMudar={(v) => mudar({ diferenciais: v })}
          />
        </section>

        <section className="pp-panel cerebro__bloco" aria-labelledby="cb-provas">
          <h3 id="cb-provas" className="cerebro__h">
            Provas
          </h3>
          <p className="quieto">
            Números, prazos e garantias que podem aparecer num post. O revisor confere cada afirmação contra
            esta lista.
          </p>
          <ul className="cerebro__lista">
            {d.provas.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a lista é editada pela posição
              <li key={i} className="cerebro__par">
                <input
                  className="filtro"
                  aria-label={`Prova ${i + 1}`}
                  value={p.texto}
                  maxLength={260}
                  onChange={(e) =>
                    mudar({ provas: d.provas.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })
                  }
                />
                <input
                  className="filtro cerebro__fonte"
                  aria-label={`De onde veio a prova ${i + 1}`}
                  value={p.fonte}
                  maxLength={80}
                  onChange={(e) =>
                    mudar({ provas: d.provas.map((x, j) => (j === i ? { ...x, fonte: e.target.value } : x)) })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="x"
                  aria-label="Tirar"
                  onClick={() => mudar({ provas: d.provas.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
          {d.provas.length < 12 && (
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              onClick={() => mudar({ provas: [...d.provas, { texto: '', fonte: 'Informado pela empresa' }] })}
            >
              Incluir prova
            </Button>
          )}
        </section>

        <section className="pp-panel cerebro__bloco" aria-labelledby="cb-cliente">
          <h3 id="cb-cliente" className="cerebro__h">
            O cliente
          </h3>
          <div className="form__duas">
            <ListaTextos
              id="cb-dores"
              rotulo="O que tira o sono dele"
              valor={d.dores}
              max={8}
              limite={220}
              aoMudar={(v) => mudar({ dores: v })}
            />
            <ListaTextos
              id="cb-desejos"
              rotulo="O que ele quer conseguir"
              valor={d.desejos}
              max={8}
              limite={220}
              aoMudar={(v) => mudar({ desejos: v })}
            />
          </div>
          <h4 className="cerebro__h cerebro__sub">O que os clientes perguntam</h4>
          {d.perguntas.length ? (
            <ul className="cerebro__perguntas">
              {d.perguntas.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a lista é editada pela posição
                <li key={i} className="cerebro__pergunta">
                  <span>{p.texto}</span>
                  <span className="quieto">
                    {p.vezes ? `${fmtNumero(p.vezes)}× · ` : ''}
                    {p.fonte}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="Tirar"
                    onClick={() => mudar({ perguntas: d.perguntas.filter((_, j) => j !== i) })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="quieto">
              Aparecem aqui quando a IA lê as conversas, os comentários, as ligações e os quadros.
            </p>
          )}
          <h4 className="cerebro__h cerebro__sub">Objeções e a resposta da empresa</h4>
          <ul className="cerebro__lista">
            {d.objecoes.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a lista é editada pela posição
              <li key={i} className="cerebro__par">
                <input
                  className="filtro"
                  aria-label={`O cliente diz (objeção ${i + 1})`}
                  value={o.diz}
                  maxLength={180}
                  onChange={(e) =>
                    mudar({
                      objecoes: d.objecoes.map((x, j) => (j === i ? { ...x, diz: e.target.value } : x)),
                    })
                  }
                />
                <input
                  className="filtro"
                  aria-label={`A resposta (objeção ${i + 1})`}
                  value={o.resposta}
                  maxLength={320}
                  onChange={(e) =>
                    mudar({
                      objecoes: d.objecoes.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)),
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="x"
                  aria-label="Tirar"
                  onClick={() => mudar({ objecoes: d.objecoes.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
          {d.objecoes.length < 8 && (
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              onClick={() => mudar({ objecoes: [...d.objecoes, { diz: '', resposta: '' }] })}
            >
              Incluir objeção
            </Button>
          )}
        </section>

        <section className="pp-panel cerebro__bloco" aria-labelledby="cb-fala">
          <h3 id="cb-fala" className="cerebro__h">
            Como a empresa fala
          </h3>
          <div className="campo">
            <label htmlFor="cb-tom">Tom de voz</label>
            <textarea
              id="cb-tom"
              rows={2}
              maxLength={500}
              value={d.tom}
              placeholder="Ex.: direto e prático, como um mecânico de confiança explicando"
              onChange={(e) => mudar({ tom: e.target.value })}
            />
          </div>
          <div className="form__duas">
            <CampoEtiquetas
              id="cb-palavras"
              rotulo="Palavras da marca"
              valor={d.palavras}
              aoMudar={(v) => mudar({ palavras: v.slice(0, 15).map((x) => x.slice(0, 50)) })}
              dica="Até 15. Ex.: peça certa, sem enrolação"
            />
            <ListaTextos
              id="cb-nunca"
              rotulo="Nunca dizer"
              valor={d.nuncaDizer}
              max={15}
              limite={180}
              aoMudar={(v) => mudar({ nuncaDizer: v })}
              placeholder="Ex.: o mais barato da cidade"
            />
          </div>
          <CampoEtiquetas
            id="cb-pilares"
            rotulo="Assuntos dos posts"
            valor={d.pilares}
            aoMudar={(v) => mudar({ pilares: v.slice(0, 6).map((x) => x.slice(0, 50)) })}
            dica="De 3 a 6. Ex.: manutenção preventiva, bastidores, promoções"
          />
        </section>
      </fieldset>

      {salvar.error && <ErroDaApi erro={salvar.error} />}
      {!!c.faltando.length && (
        <p className="quieto">Para conferir, falta preencher: {c.faltando.join(', ')}.</p>
      )}
      <div className="acoes cerebro__rodape">
        <Button type="submit" variant="primary" icon="check" disabled={salvar.isPending || trabalhando}>
          {salvar.isPending ? 'Salvando…' : 'Está certo: conferi'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => salvar.mutate(false)}
          disabled={!mudou || salvar.isPending || trabalhando}
        >
          Salvar sem conferir
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────── O que divulgar ───────────────────────────── */

function Divulgar() {
  const [antigos, setAntigos] = useState(false);
  const q = useDivulgar(antigos);
  const [editando, setEditando] = useState<DivulgarItem | 'novo' | null>(null);
  const cliente = useQueryClient();
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/carrosseis/divulgar/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'divulgar'] }),
  });
  return (
    <section className="pp-panel cerebro__bloco divulgar" aria-labelledby="dv-titulo">
      <div className="divulgar__topo">
        <div>
          <h2 id="dv-titulo" className="cerebro__h">
            O que divulgar
          </h2>
          <p className="quieto">
            Promoções, lançamentos e datas do mês. No pedido do carrossel, escolha um: preço, validade e
            condições saem exatamente como estão aqui.
          </p>
        </div>
        <Button variant="secondary" icon="plus" onClick={() => setEditando('novo')}>
          Incluir
        </Button>
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 120 }} />
      ) : q.error ? (
        <ErroDaApi erro={q.error} />
      ) : !q.data.itens.length ? (
        <EmptyState
          icone="package"
          titulo="Nada para divulgar agora"
          texto="Inclua a promoção do mês, um produto novo ou uma data especial."
        />
      ) : (
        <ul className="divulgar__lista">
          {q.data.itens.map((i) => (
            <li key={i.id} className="divulgar__item">
              <Badge tone={i.tipo === 'promocao' ? 'warning' : 'neutral'}>{ROTULO_DIVULGAR[i.tipo]}</Badge>
              <span className="divulgar__nome">
                <b>{i.titulo}</b>
                <span className="quieto">
                  {[
                    i.precoPor && `por ${i.precoPor}`,
                    i.validade,
                    i.ate && `sai da lista em ${fmtData(i.ate)}`,
                    i.usado ? `${i.usado} carrossel${i.usado > 1 ? 'éis' : ''}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditando(i)}>
                Editar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="trash-2"
                aria-label={`Apagar ${i.titulo}`}
                onClick={() => {
                  if (window.confirm(`Tirar "${i.titulo}" da lista?`)) apagar.mutate(i.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <label className="opcao">
        <input type="checkbox" checked={antigos} onChange={(e) => setAntigos(e.target.checked)} />
        <span>Mostrar também os que já passaram da data</span>
      </label>
      {editando && (
        <EditarDivulgar item={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} />
      )}
    </section>
  );
}

const VAZIO: DivulgarEntrada = {
  tipo: 'promocao',
  titulo: '',
  detalhes: '',
  produto: '',
  precoDe: '',
  precoPor: '',
  validade: '',
  condicoes: '',
  ate: null,
};

function EditarDivulgar(props: { item: DivulgarItem | null; aoFechar: () => void }) {
  const [f, setF] = useState<DivulgarEntrada>(props.item ? { ...props.item } : VAZIO);
  const cliente = useQueryClient();
  const salvar = useMutation({
    mutationFn: () =>
      props.item
        ? api(`/carrosseis/divulgar/${props.item.id}`, { metodo: 'PUT', corpo: f })
        : api('/carrosseis/divulgar', { metodo: 'POST', corpo: f }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'divulgar'] });
      props.aoFechar();
    },
  });
  const promo = f.tipo === 'promocao';
  return (
    <Drawer
      titulo={props.item ? 'Editar o que divulgar' : 'O que divulgar'}
      barra="O que divulgar"
      aoFechar={props.aoFechar}
    >
      <div className="drawer__corpo">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <fieldset className="campo">
            <legend>Tipo</legend>
            <div className="segmentos">
              {TIPOS_DIVULGAR.map((t) => (
                <label key={t} className="segmento">
                  <input
                    type="radio"
                    name="dv-tipo"
                    className="pp-sr"
                    checked={f.tipo === t}
                    onChange={() => setF({ ...f, tipo: t })}
                  />
                  {ROTULO_DIVULGAR[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="campo">
            <label htmlFor="dv-titulo-campo">Nome</label>
            <input
              id="dv-titulo-campo"
              className="filtro"
              value={f.titulo}
              maxLength={100}
              required
              placeholder={
                promo ? 'Ex.: Pastilha de freio com instalação grátis' : 'Ex.: Chegou a linha de baterias X'
              }
              onChange={(e) => setF({ ...f, titulo: e.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor="dv-produto">Produto ou serviço</label>
            <input
              id="dv-produto"
              className="filtro"
              value={f.produto}
              maxLength={100}
              onChange={(e) => setF({ ...f, produto: e.target.value })}
            />
          </div>
          {promo && (
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="dv-de">Preço de</label>
                <input
                  id="dv-de"
                  className="filtro mono"
                  value={f.precoDe}
                  maxLength={24}
                  placeholder="R$ 189,90"
                  onChange={(e) => setF({ ...f, precoDe: e.target.value })}
                />
              </div>
              <div className="campo">
                <label htmlFor="dv-por">Preço por</label>
                <input
                  id="dv-por"
                  className="filtro mono"
                  value={f.precoPor}
                  maxLength={24}
                  placeholder="R$ 139,90"
                  onChange={(e) => setF({ ...f, precoPor: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="dv-validade">Validade (como aparece no post)</label>
              <input
                id="dv-validade"
                className="filtro"
                value={f.validade}
                maxLength={60}
                placeholder="Ex.: até 30/11 ou enquanto durar o estoque"
                onChange={(e) => setF({ ...f, validade: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="dv-ate">Some da lista depois de</label>
              <input
                id="dv-ate"
                type="date"
                className="filtro"
                value={f.ate ?? ''}
                onChange={(e) => setF({ ...f, ate: e.target.value || null })}
              />
            </div>
          </div>
          {promo && (
            <div className="campo">
              <label htmlFor="dv-condicoes">Condições</label>
              <input
                id="dv-condicoes"
                className="filtro"
                value={f.condicoes}
                maxLength={240}
                placeholder="Ex.: na compra do par, só na loja do Centro"
                onChange={(e) => setF({ ...f, condicoes: e.target.value })}
              />
            </div>
          )}
          <div className="campo">
            <label htmlFor="dv-detalhes">Detalhes para o time</label>
            <textarea
              id="dv-detalhes"
              rows={4}
              maxLength={700}
              value={f.detalhes}
              placeholder="O que o cliente precisa saber, para quem é, por que agora."
              onChange={(e) => setF({ ...f, detalhes: e.target.value })}
            />
          </div>
          {promo && (
            <p className="quieto">
              Preço, validade e condições saem nos slides exatamente como você escreveu. O revisor confere.
            </p>
          )}
          {salvar.error && <ErroDaApi erro={salvar.error} />}
          <div className="acoes">
            <Button type="submit" variant="primary" disabled={!f.titulo.trim() || salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button type="button" variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
