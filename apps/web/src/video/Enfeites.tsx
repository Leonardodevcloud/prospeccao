import {
  CLIMAS_MUSICA,
  type ClimaMusica,
  type DetalheVideo,
  DICA_PARTE_MUSICA,
  type EfeitoVideo,
  type EncaixeImagem,
  fmtDuracao,
  IMAGENS_FRACAO_MAXIMA,
  type ImagemVideo,
  type MomentoVideo,
  momentosDe,
  type ParteMusica,
  ROTULO_EFEITO,
  ROTULO_IMAGEM_POSTA,
  ROTULO_MOMENTO,
  ROTULO_ORIGEM_IMAGEM,
  ROTULO_PARTE_MUSICA,
  tempoNoEditado,
  trechosQueFicam,
} from '@prospeccao/shared/videos';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { enviarImagem } from '../carrossel/dados';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { type SituacaoVideos, useArquivo, useFotoPropria, useFotosDaEmpresa, useRevisao } from './dados';

/**
 * As abas da revisão que a v129 trouxe: as imagens (onde a IA pôs e por quê, trocar, gerar outra,
 * usar uma foto sua, tirar), as animações que acompanham a fala e o som (música e efeitos). Os
 * tempos aparecem no vídeo editado, que é o que a pessoa vê tocando.
 */

type Trecho = { inicio: number; fim: number };

const ficamDe = (v: DetalheVideo) => trechosQueFicam(v.duracaoOriginal ?? 0, v.cortes);

/** Um instante do original no editado (caiu num corte: o começo do trecho seguinte). */
export function noEditado(t: number, ficam: Trecho[]): number | null {
  const direto = tempoNoEditado(t, ficam);
  if (direto != null) return direto;
  let acc = 0;
  for (const s of ficam) {
    if (t < s.inicio) return acc;
    acc += s.fim - s.inicio;
  }
  return null;
}

/** A fala entre aspas, sem a pontuação do fim. */
const semPonto = (t: string) => t.replace(/[.,;:!?…]+$/, '');

const quando = (a: number | null, b: number | null) =>
  a == null ? '—' : b == null ? fmtDuracao(a) : `${fmtDuracao(a)} a ${fmtDuracao(b)}`;

/** "1:05" ou "65" → segundos. */
export function lerMomento(t: string): number | null {
  const s = t.trim().replace(',', '.');
  const m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ───────────────────────────── Imagens ───────────────────────────── */

export function AbaImagens({ v, situacao }: { v: DetalheVideo; situacao: SituacaoVideos | undefined }) {
  const revisao = useRevisao(v.id);
  const ficam = ficamDe(v);
  const editado = ficam.reduce((s, x) => s + x.fim - x.inicio, 0);
  const usadas = v.imagens.filter((i) => i.usar);
  const comImagem = usadas.reduce((s, i) => {
    const a = noEditado(i.inicio, ficam);
    const b = noEditado(i.fim, ficam);
    return s + (a != null && b != null ? Math.max(0, b - a) : 0);
  }, 0);
  const geradas = usadas.filter((i) => i.origem === 'gerada').length;
  return (
    <div className="video__imagens">
      <p className="quieto">
        {usadas.length
          ? `A IA pôs ${usadas.length} ${usadas.length === 1 ? 'imagem' : 'imagens'} onde você cita produto, número ou lugar (${Math.round(comImagem)} s de ${Math.round(editado)} s). ${geradas ? `Fotos da empresa primeiro; gerou ${geradas === 1 ? 'só a que faltava' : `${geradas} que faltavam`}.` : 'Todas são fotos.'}`
          : v.opcoes.imagens === 'nenhuma'
            ? 'Este vídeo foi feito sem imagens. Dá para pôr uma num momento.'
            : 'A IA não achou momento em que uma imagem ajudasse. Dá para pôr uma num momento.'}
      </p>
      <ErroDaApi erro={revisao.error} />
      <ul className="video__lista-imagens">
        {v.imagens.map((im) => (
          <CartaoImagem key={im.id} v={v} im={im} ficam={ficam} situacao={situacao} />
        ))}
      </ul>
      {v.semImagem.length > 0 && (
        <div className="video__sem-imagem">
          <b>Onde a IA preferiu não pôr imagem</b>
          <ul>
            {v.semImagem.map((s) => (
              <li key={`${s.inicio}`} className="campo__dica">
                {quando(noEditado(s.inicio, ficam), null)}: {s.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      <NovaImagem v={v} editado={editado} comImagem={comImagem} situacao={situacao} />
    </div>
  );
}

function Miniatura({ v, im }: { v: DetalheVideo; im: ImagemVideo }) {
  const arq = useArquivo(v.id, 'imagem', !!im.chave, im.chave ?? undefined, im.id);
  if (!im.chave)
    return (
      <span className="video__mini video__mini--vazia" aria-hidden="true">
        <Icon name={im.pedido ? 'sparkles' : 'image'} size={20} />
      </span>
    );
  return arq.data ? (
    <a className="video__mini" href={arq.data.url} target="_blank" rel="noreferrer" aria-label="Ver a imagem">
      <img src={arq.data.url} alt="" />
    </a>
  ) : (
    <span className="video__mini video__mini--vazia" aria-hidden="true" />
  );
}

function CartaoImagem(props: {
  v: DetalheVideo;
  im: ImagemVideo;
  ficam: Trecho[];
  situacao: SituacaoVideos | undefined;
}) {
  const { v, im, ficam } = props;
  const revisao = useRevisao(v.id);
  const foto = useFotoPropria(v.id);
  const [trocando, setTrocando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const muda = (m: {
    usar?: boolean;
    encaixe?: EncaixeImagem;
    fotoId?: number;
    pedido?: 'gerar_outra' | null;
  }) => revisao.mutate({ imagens: [{ id: im.id, ...m }] });
  const naoEntrou = im.conferencia?.startsWith('Não entrou');
  const podeGerar = !!props.situacao?.recursos.imagensGeradas;
  return (
    <li
      className="video__imagem"
      data-fora={!im.usar || undefined}
      data-alerta={(naoEntrou && im.usar) || undefined}
    >
      <Miniatura v={v} im={im} />
      <div className="video__imagem-texto">
        <span className="video__imagem-cabeca">
          <span className="mono quieto">{quando(noEditado(im.inicio, ficam), noEditado(im.fim, ficam))}</span>
          <Badge tone={im.origem === 'gerada' ? 'warning' : 'brand'}>{ROTULO_ORIGEM_IMAGEM[im.origem]}</Badge>
          {!im.usar && <Badge tone="outline">Fora do vídeo</Badge>}
        </span>
        {im.fala && (
          <span>
            Você falou <b>"{semPonto(im.fala)}"</b>.
          </span>
        )}
        <span className="campo__dica">
          {[im.descricao, im.posta ? ROTULO_IMAGEM_POSTA[im.posta] : null].filter(Boolean).join(' · ')}
        </span>
        {im.pedido === 'gerar_outra' && (
          <span className="campo__dica video__pendente">Uma imagem nova sai quando você gerar de novo.</span>
        )}
        {im.pedido === 'escolher' && (
          <span className="campo__dica video__pendente">
            A IA escolhe a imagem quando você gerar de novo.
          </span>
        )}
        {im.conferencia && !im.pedido && (
          <span className={`campo__dica${naoEntrou ? ' video__erro' : ''}`}>{im.conferencia}</span>
        )}
        <div className="video__acoes-imagem">
          {im.usar ? (
            <>
              <button type="button" className="video__link" onClick={() => setTrocando((x) => !x)}>
                Trocar por foto da empresa
              </button>
              {im.origem === 'gerada' && podeGerar && im.pedido !== 'gerar_outra' && (
                <button type="button" className="video__link" onClick={() => muda({ pedido: 'gerar_outra' })}>
                  Gerar outra
                </button>
              )}
              <button type="button" className="video__link" onClick={() => entrada.current?.click()}>
                Usar foto minha
              </button>
              <button type="button" className="video__link" onClick={() => muda({ usar: false })}>
                Tirar
              </button>
            </>
          ) : (
            <button type="button" className="video__link" onClick={() => muda({ usar: true })}>
              Pôr de volta
            </button>
          )}
          <input
            ref={entrada}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="pp-sr"
            tabIndex={-1}
            aria-label="Escolher uma foto sua"
            onChange={(e) => {
              const a = e.target.files?.[0];
              e.target.value = '';
              if (a) foto.mutate({ arquivo: a, imagem: im.id });
            }}
          />
        </div>
        {im.usar && (
          <fieldset className="video__encaixe">
            <legend className="pp-sr">Onde a imagem entra</legend>
            {(['acima', 'cheia'] as const).map((e) => (
              <label key={e}>
                <input
                  type="radio"
                  name={`encaixe-${im.id}`}
                  checked={im.encaixe === e}
                  onChange={() => muda({ encaixe: e })}
                />
                {e === 'acima' ? 'Acima da cabeça' : 'Tela cheia'}
              </label>
            ))}
          </fieldset>
        )}
        {foto.isPending && <span className="campo__dica">Enviando a foto…</span>}
        <ErroDaApi erro={foto.error} />
        {trocando && (
          <EscolherFoto
            aoEscolher={(fotoId) => {
              setTrocando(false);
              muda({ fotoId });
            }}
          />
        )}
      </div>
    </li>
  );
}

function EscolherFoto({ aoEscolher }: { aoEscolher: (id: number) => void }) {
  const q = useFotosDaEmpresa(true);
  if (q.isPending) return <div className="esqueleto" style={{ height: 80 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  if (!q.data.fotos.length)
    return (
      <p className="campo__dica">
        A empresa ainda não tem fotos. Suba em Carrosséis › Fotos da empresa, ou use uma foto sua.
      </p>
    );
  return (
    <fieldset className="video__fotos">
      <legend className="pp-sr">Fotos da empresa</legend>
      {q.data.fotos.map((f) => (
        <button
          key={f.id}
          type="button"
          className="video__foto"
          onClick={() => aoEscolher(f.id)}
          aria-label={`Usar ${f.descricao ?? f.nome}`}
          title={f.descricao ?? f.nome}
        >
          {f.url ? <img src={f.url} alt="" /> : <Icon name="image" size={18} />}
        </button>
      ))}
    </fieldset>
  );
}

function NovaImagem(props: {
  v: DetalheVideo;
  editado: number;
  comImagem: number;
  situacao: SituacaoVideos | undefined;
}) {
  const { v } = props;
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [momento, setMomento] = useState('');
  const [comFoto, setComFoto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const revisao = useRevisao(v.id);
  const foto = useFotoPropria(v.id);
  const entrada = useRef<HTMLInputElement>(null);
  const cheio = props.comImagem >= props.editado * IMAGENS_FRACAO_MAXIMA - 1.4;
  const em = () => {
    const t = lerMomento(momento);
    if (t == null) {
      setErro('Escreva o momento como no vídeo, por exemplo 0:12.');
      return null;
    }
    setErro(null);
    return t;
  };
  if (!aberto)
    return (
      <div className="video__nova-botao">
        <Button variant="secondary" icon="plus" onClick={() => setAberto(true)} disabled={cheio}>
          Pôr uma imagem num momento
        </Button>
        {cheio && (
          <span className="campo__dica">
            O vídeo já tem imagem em quase 30% do tempo. Tire uma para pôr outra: o seu rosto precisa
            continuar aparecendo.
          </span>
        )}
      </div>
    );
  return (
    <div className="video__nova">
      <div className="campo">
        <label htmlFor={id}>Em que momento (no vídeo editado)</label>
        <input
          id={id}
          className="filtro mono"
          value={momento}
          placeholder="0:12"
          inputMode="decimal"
          onChange={(e) => setMomento(e.target.value)}
        />
        <span className="campo__dica">A imagem fica uns 3 segundos. Nos 2 primeiros fica o seu rosto.</span>
      </div>
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
      <ErroDaApi erro={revisao.error ?? foto.error} />
      <div className="video__acoes-imagem">
        <Button
          variant="secondary"
          onClick={() => {
            const t = em();
            if (t != null)
              revisao.mutate({ novaImagem: { em: t, fotoId: null } }, { onSuccess: () => setAberto(false) });
          }}
        >
          A IA escolhe
        </Button>
        <Button variant="secondary" onClick={() => setComFoto((x) => !x)}>
          Foto da empresa
        </Button>
        <Button variant="secondary" onClick={() => em() != null && entrada.current?.click()}>
          Foto minha
        </Button>
        <Button variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="pp-sr"
        tabIndex={-1}
        aria-label="Escolher uma foto sua"
        onChange={(e) => {
          const a = e.target.files?.[0];
          e.target.value = '';
          const t = lerMomento(momento);
          if (a && t != null) foto.mutate({ arquivo: a, em: t }, { onSuccess: () => setAberto(false) });
        }}
      />
      {comFoto && (
        <EscolherFoto
          aoEscolher={(fotoId) => {
            const t = em();
            if (t != null)
              revisao.mutate({ novaImagem: { em: t, fotoId } }, { onSuccess: () => setAberto(false) });
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Animações que acompanham a fala ───────────────────────────── */

export function MomentosDaFala({ v }: { v: DetalheVideo }) {
  const ficam = ficamDe(v);
  const momentos = momentosDe(v.animacoes);
  return (
    <>
      {momentos.map((m) => (
        <CartaoMomento key={m.id} v={v} m={m} ficam={ficam} />
      ))}
      <NovoMomento v={v} />
    </>
  );
}

function CartaoMomento({ v, m, ficam }: { v: DetalheVideo; m: MomentoVideo; ficam: Trecho[] }) {
  const revisao = useRevisao(v.id);
  const id = useId();
  const [titulo, setTitulo] = useState(m.titulo);
  const [numero, setNumero] = useState(m.numero);
  const [itens, setItens] = useState(m.itens.map((i) => i.texto));
  useEffect(() => {
    setTitulo(m.titulo);
    setNumero(m.numero);
    setItens(m.itens.map((i) => i.texto));
  }, [m]);
  const salvar = (e: { titulo?: string; numero?: string; itens?: string[]; usar?: boolean }) =>
    revisao.mutate({ momentos: [{ id: m.id, ...e }] });
  const rotuloTitulo =
    m.tipo === 'lista'
      ? 'Título da lista'
      : m.tipo === 'numero'
        ? 'Linha embaixo do número'
        : 'Texto do selo';
  return (
    <div className="video__animacao" data-fora={!m.usar || undefined}>
      <span className="video__corte-cabeca">
        <span>
          <span className="mono quieto">{quando(noEditado(m.inicio, ficam), null)}</span>{' '}
          <b>{ROTULO_MOMENTO[m.tipo]}</b>
        </span>
        <label className="video__usar">
          <input type="checkbox" checked={m.usar} onChange={(e) => salvar({ usar: e.target.checked })} />
          Usar
        </label>
      </span>
      {m.fala && <span className="campo__dica">Você falou "{semPonto(m.fala)}".</span>}
      {(m.tipo === 'lista' || m.tipo === 'numero' || m.tipo === 'selo') && (
        <div className="campo">
          <label htmlFor={`${id}-t`}>{rotuloTitulo}</label>
          <input
            id={`${id}-t`}
            className="filtro"
            value={titulo}
            maxLength={40}
            onChange={(e) => setTitulo(e.target.value.toUpperCase())}
            onBlur={() => titulo !== m.titulo && salvar({ titulo })}
          />
        </div>
      )}
      {m.tipo === 'numero' && (
        <div className="campo">
          <label htmlFor={`${id}-n`}>Número</label>
          <input
            id={`${id}-n`}
            className="filtro mono"
            value={numero}
            maxLength={8}
            onChange={(e) => setNumero(e.target.value)}
            onBlur={() => numero !== m.numero && salvar({ numero })}
          />
        </div>
      )}
      {m.tipo === 'lista' && (
        <fieldset className="campo">
          <legend>Itens (cada um marca quando você fala dele)</legend>
          {itens.map((t, n) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: a lista tem tamanho fixo
              key={n}
              className="filtro"
              value={t}
              maxLength={32}
              aria-label={`Item ${n + 1}`}
              onChange={(e) => setItens((x) => x.map((y, k) => (k === n ? e.target.value.toUpperCase() : y)))}
              onBlur={() =>
                itens.join('|') !== m.itens.map((i) => i.texto).join('|') &&
                itens.every((x) => x.trim()) &&
                salvar({ itens })
              }
            />
          ))}
        </fieldset>
      )}
      {m.tipo === 'oferta' && m.oferta && (
        <span className="campo__dica">
          Do O que divulgar, exatamente como foi digitado: {m.oferta.produto}
          {m.oferta.precoDe ? ` · de ${m.oferta.precoDe}` : ''}
          {m.oferta.precoPor ? ` · por ${m.oferta.precoPor}` : ''}
          {m.oferta.validade ? ` · ${m.oferta.validade}` : ''}. Para mudar, mude a promoção em Carrosséis.
        </span>
      )}
      {m.tipo === 'destaque' && (
        <span className="campo__dica">O vídeo se aproxima do seu rosto nesta frase e volta.</span>
      )}
    </div>
  );
}

function NovoMomento({ v }: { v: DetalheVideo }) {
  const id = useId();
  const revisao = useRevisao(v.id);
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<'selo' | 'destaque' | 'numero'>('selo');
  const [momento, setMomento] = useState('');
  const [titulo, setTitulo] = useState('');
  const [numero, setNumero] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  if (!aberto)
    return (
      <Button variant="secondary" icon="plus" onClick={() => setAberto(true)}>
        Pôr uma animação num momento
      </Button>
    );
  return (
    <div className="video__nova">
      <div className="campo">
        <label htmlFor={`${id}-tipo`}>Animação</label>
        <select
          id={`${id}-tipo`}
          className="filtro"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as typeof tipo)}
        >
          <option value="selo">{ROTULO_MOMENTO.selo}</option>
          <option value="numero">{ROTULO_MOMENTO.numero}</option>
          <option value="destaque">{ROTULO_MOMENTO.destaque}</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`${id}-em`}>Em que momento (no vídeo editado)</label>
        <input
          id={`${id}-em`}
          className="filtro mono"
          value={momento}
          placeholder="0:12"
          inputMode="decimal"
          onChange={(e) => setMomento(e.target.value)}
        />
      </div>
      {tipo === 'numero' && (
        <div className="campo">
          <label htmlFor={`${id}-n`}>Número</label>
          <input
            id={`${id}-n`}
            className="filtro mono"
            value={numero}
            maxLength={8}
            placeholder="2×"
            onChange={(e) => setNumero(e.target.value)}
          />
        </div>
      )}
      {tipo !== 'destaque' && (
        <div className="campo">
          <label htmlFor={`${id}-t`}>
            {tipo === 'selo' ? 'Texto do selo' : 'Linha embaixo do número (opcional)'}
          </label>
          <input
            id={`${id}-t`}
            className="filtro"
            value={titulo}
            maxLength={40}
            placeholder={tipo === 'selo' ? 'DICA' : 'MAIS DURABILIDADE'}
            onChange={(e) => setTitulo(e.target.value.toUpperCase())}
          />
        </div>
      )}
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
      <ErroDaApi erro={revisao.error} />
      <div className="video__acoes-imagem">
        <Button
          onClick={() => {
            const em = lerMomento(momento);
            if (em == null) return setErro('Escreva o momento como no vídeo, por exemplo 0:12.');
            setErro(null);
            revisao.mutate(
              { novoMomento: { tipo, em, titulo, numero } },
              {
                onSuccess: () => {
                  setAberto(false);
                  setMomento('');
                  setTitulo('');
                  setNumero('');
                },
              },
            );
          }}
        >
          Pôr a animação
        </Button>
        <Button variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Som ───────────────────────────── */

export function AbaSomCompleta({ v, situacao }: { v: DetalheVideo; situacao: SituacaoVideos | undefined }) {
  return (
    <div className="video__som">
      {v.som ? (
        <>
          <Musica v={v} liberada={!!situacao?.recursos.musica} />
          <Efeitos v={v} />
        </>
      ) : (
        <Mensagem tipo="aviso">
          Este vídeo foi feito antes da música e dos efeitos sonoros. Envie de novo para ter os dois.
        </Mensagem>
      )}
      <div className="video__animacao">
        <b>Sua voz</b>
        <span className="quieto">
          Chiado e ruído de fundo reduzidos, volume uniforme e no padrão do Instagram e do TikTok. Cada corte
          entra e sai suave, sem estalo.
        </span>
      </div>
    </div>
  );
}

/** v153: as partes em que a música foi composta, com o tempo de cada uma no vídeo. */
function PartesDaMusica(props: { partes: ParteMusica[] }) {
  const tempo = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  let inicio = 0;
  const linhas = props.partes.map((p) => {
    const de = inicio;
    inicio += p.segundos;
    return { ...p, de, ate: inicio };
  });
  // Trechos seguidos da mesma parte (a explicação longa é composta em mais de um) viram uma linha só.
  const juntas = linhas.reduce<typeof linhas>((l, p) => {
    const ultima = l.at(-1);
    if (ultima && ultima.nome === p.nome) ultima.ate = p.ate;
    else l.push({ ...p });
    return l;
  }, []);
  return (
    <div className="campo">
      <span className="campo__rotulo">A música acompanha o vídeo</span>
      <ul
        className="lista-simples"
        style={{ display: 'grid', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}
      >
        {juntas.map((p) => (
          <li key={`${p.nome}-${p.de}`}>
            <span className="dado">
              {tempo(p.de)} a {tempo(p.ate)}
            </span>{' '}
            <b>{ROTULO_PARTE_MUSICA[p.nome]}</b>
            <span className="campo__dica" style={{ display: 'block' }}>
              {DICA_PARTE_MUSICA[p.nome]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Musica({ v, liberada }: { v: DetalheVideo; liberada: boolean }) {
  const m = v.som!.musica;
  const revisao = useRevisao(v.id);
  const id = useId();
  const arq = useArquivo(v.id, 'musica', !!m.chave && m.usar, m.chave ?? undefined);
  const [descricao, setDescricao] = useState(m.descricao);
  const [volume, setVolume] = useState(m.volume);
  useEffect(() => {
    setDescricao(m.descricao);
    setVolume(m.volume);
  }, [m.descricao, m.volume]);
  const muda = (e: {
    usar?: boolean;
    clima?: ClimaMusica;
    descricao?: string;
    volume?: number;
    outra?: boolean;
  }) => revisao.mutate({ musica: e });
  if (!liberada)
    return (
      <div className="video__animacao">
        <b>Música</b>
        <span className="quieto">A música ainda não foi ligada na plataforma. Fale com a gente.</span>
      </div>
    );
  const clima = CLIMAS_MUSICA.find((c) => c.id === m.clima);
  return (
    <div className="video__animacao" data-fora={!m.usar || undefined}>
      <span className="video__corte-cabeca">
        <b>Música</b>
        <label className="video__usar">
          <input type="checkbox" checked={m.usar} onChange={(e) => muda({ usar: e.target.checked })} />
          Usar
        </label>
      </span>
      <span className="campo__dica">
        Feita para este vídeo, no tamanho certo, com o final junto da chamada.
      </span>
      <ErroDaApi erro={revisao.error} />
      {m.erro && m.usar && <Mensagem tipo="aviso">{m.erro}</Mensagem>}
      {m.usar && arq.data && (
        <div className="video__musica">
          <audio controls src={arq.data.url} preload="none" aria-label="Ouvir a música">
            <track kind="captions" />
          </audio>
          <span className="campo__dica">
            {clima?.nome}
            {m.descricao ? ` · ${m.descricao}` : m.estiloIa ? ' · a IA escolheu pelo assunto' : ''}
          </span>
        </div>
      )}
      {m.usar && arq.data && m.partes && m.partes.length > 1 && <PartesDaMusica partes={m.partes} />}
      {m.pedirOutra && m.usar && (
        <span className="campo__dica video__pendente">Uma música nova sai quando você gerar de novo.</span>
      )}
      {m.usar && (
        <>
          <fieldset className="campo">
            <legend>Clima</legend>
            <div className="video__climas">
              {CLIMAS_MUSICA.map((c) => (
                <label key={c.id} className="video__clima" data-ativo={m.clima === c.id || undefined}>
                  <input
                    type="radio"
                    name={`${id}-clima`}
                    className="pp-sr"
                    checked={m.clima === c.id}
                    onChange={() => muda({ clima: c.id })}
                  />
                  {c.nome}
                </label>
              ))}
            </div>
            <span className="campo__dica">{clima?.dica}.</span>
          </fieldset>
          <div className="campo">
            <label htmlFor={`${id}-d`}>Ou descreva</label>
            <input
              id={`${id}-d`}
              className="filtro"
              value={descricao}
              maxLength={120}
              placeholder="Ex.: rock leve, com guitarra"
              onChange={(e) => setDescricao(e.target.value)}
              onBlur={() => descricao !== m.descricao && muda({ descricao })}
            />
            <span className="campo__dica">Sem nome de artista ou de música: a música é sempre original.</span>
          </div>
          <div className="campo">
            <label htmlFor={`${id}-v`}>Volume da música</label>
            <input
              id={`${id}-v`}
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              onPointerUp={() => volume !== m.volume && muda({ volume })}
              onKeyUp={() => volume !== m.volume && muda({ volume })}
            />
            <span className="campo__dica">Sempre abaixo da sua voz. Nas pausas e no fim, sobe um pouco.</span>
          </div>
          {!m.pedirOutra && (
            <Button variant="secondary" onClick={() => muda({ outra: true })}>
              Fazer outra música
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Efeitos({ v }: { v: DetalheVideo }) {
  const e = v.som!.efeitos;
  const revisao = useRevisao(v.id);
  const tocar = (ef: EfeitoVideo) =>
    void new Audio(`/videos/sons/${ef.tipo}.wav`).play().catch(() => undefined);
  const alternar = (ef: EfeitoVideo) =>
    revisao.mutate({
      efeitos: {
        desligados: e.desligados.includes(ef.id)
          ? e.desligados.filter((x) => x !== ef.id)
          : [...e.desligados, ef.id],
      },
    });
  return (
    <div className="video__animacao" data-fora={!e.ligados || undefined}>
      <span className="video__corte-cabeca">
        <b>Efeitos sonoros</b>
        <label className="video__usar">
          <input
            type="checkbox"
            checked={e.ligados}
            onChange={(x) => revisao.mutate({ efeitos: { ligados: x.target.checked } })}
          />
          Usar
        </label>
      </span>
      {e.ligados && e.lista.length > 0 ? (
        <ul className="video__efeitos">
          {e.lista.map((ef) => {
            const fora = e.desligados.includes(ef.id);
            return (
              <li key={ef.id} data-fora={fora || undefined}>
                <span className="mono quieto">{fmtDuracao(ef.em)}</span>
                <span className="video__efeito-nome">
                  {ef.onde} <span className="quieto">· {ROTULO_EFEITO[ef.tipo]}</span>
                </span>
                <button type="button" className="video__link" onClick={() => tocar(ef)}>
                  Ouvir
                </button>
                <button type="button" className="video__link" onClick={() => alternar(ef)}>
                  {fora ? 'Pôr de volta' : 'Tirar'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="campo__dica">
          {e.ligados ? 'Os efeitos aparecem aqui depois que o vídeo for gerado.' : 'Desligados neste vídeo.'}
        </span>
      )}
      <span className="campo__dica">Discretos e sempre mais baixos que a sua voz.</span>
    </div>
  );
}

/* ───────────────────────────── Fotos da empresa ───────────────────────────── */

/**
 * As fotos da empresa (as mesmas dos Carrosséis) que a IA usa nos vídeos: subir e apagar daqui
 * mesmo, para quem tem só o módulo de vídeos.
 */
export function FotosDaEmpresa({ total }: { total: number }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const cliente = useQueryClient();
  const q = useFotosDaEmpresa(aberto);
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['videos'] });
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/videos/fotos/${id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const subir = async (lista: FileList) => {
    setErro(null);
    for (const a of [...lista].slice(0, 20)) {
      setEnviando((n) => n + 1);
      try {
        await enviarImagem(`/videos/fotos?nome=${encodeURIComponent(a.name.slice(0, 80))}`, a);
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setEnviando((n) => n - 1);
      }
    }
    await atualizar();
  };
  return (
    <div className="video__fotos-empresa">
      <button
        type="button"
        className="video__link"
        aria-expanded={aberto}
        onClick={() => setAberto((x) => !x)}
      >
        {aberto ? 'Fechar as fotos da empresa' : `Ver as fotos da empresa (${total})`}
      </button>
      {aberto && (
        <>
          <span className="campo__dica">
            Fotos dos produtos, da fachada e da equipe. A IA lê cada uma e escolhe a certa para o que você
            fala. São as mesmas dos Carrosséis.
          </span>
          {q.data && q.data.fotos.length > 0 && (
            <ul className="video__fotos">
              {q.data.fotos.map((f) => (
                <li key={f.id} className="video__foto">
                  {f.url ? <img src={f.url} alt={f.descricao ?? f.nome} /> : <Icon name="image" size={18} />}
                  <button
                    type="button"
                    className="video__foto-tirar"
                    aria-label={`Apagar ${f.nome}`}
                    onClick={() => apagar.mutate(f.id)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            icon="plus"
            onClick={() => entrada.current?.click()}
            disabled={enviando > 0}
          >
            {enviando > 0 ? 'Enviando…' : 'Adicionar fotos'}
          </Button>
          <input
            ref={entrada}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="pp-sr"
            tabIndex={-1}
            aria-label="Escolher fotos da empresa"
            onChange={(e) => {
              if (e.target.files?.length) void subir(e.target.files);
              e.target.value = '';
            }}
          />
          {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
          <ErroDaApi erro={apagar.error} />
        </>
      )}
    </div>
  );
}
