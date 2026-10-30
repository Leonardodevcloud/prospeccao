import {
  RAIO_CHEGADA_METROS,
  RESULTADOS_VISITA,
  type ResultadoVisita,
  ROTULO_RESULTADO,
} from '@prospeccao/shared/rua';
import { Avatar, Button, EmptyState, Icon, ScoreBadge } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ErroApi } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import {
  enviarArquivo,
  localizacaoAgora,
  nomeBonito,
  type ParadaRua,
  reduzirFoto,
  useEstadoRua,
  useHoje,
} from './api';
import { haDias } from './MeuRoteiro';

/**
 * Na visita (celular): o check-in, quem decide e o que já aconteceu, como foi (um toque), a
 * anotação (falada ou digitada), a foto da fachada e o próximo passo. Concluir registra a visita no
 * histórico do lead, move o funil e volta para o roteiro.
 */

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

const fmtDiaPasso = (dia: string) =>
  new Date(`${dia}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/\./g, '');

/** Para onde vai no funil, para a frase do rodapé. */
const DESTINO: Partial<Record<ResultadoVisita, string>> = {
  decisor: 'Em conversa',
  proposta: 'Proposta',
  reuniao: 'Reunião',
  sem_interesse: 'Perdido (sem interesse)',
  fechou: 'Ganho',
};

/** Grava a fala pelo microfone (para a anotação). */
function useGravador() {
  const [gravando, setGravando] = useState(false);
  const rec = useRef<{ r: MediaRecorder; partes: Blob[]; fim: (b: Blob) => void } | null>(null);
  const comecar = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const tipo = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    const partes: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && partes.push(e.data);
    rec.current = { r, partes, fim: () => undefined };
    r.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      rec.current?.fim(new Blob(partes, { type: r.mimeType || 'audio/webm' }));
    };
    r.start(500);
    setGravando(true);
  };
  const parar = () =>
    new Promise<Blob>((ok) => {
      const atual = rec.current;
      setGravando(false);
      if (!atual) return ok(new Blob());
      atual.fim = ok;
      atual.r.stop();
    });
  useEffect(() => () => (rec.current?.r.state === 'recording' ? rec.current.r.stop() : undefined), []);
  return { gravando, comecar, parar };
}

export function Visita() {
  const { id } = useParams();
  const hoje = useHoje();
  const parada = hoje.data?.paradas.find((p) => p.id === Number(id));
  if (hoje.isLoading) return <p className="quieto">Abrindo a visita…</p>;
  if (!parada)
    return (
      <EmptyState
        icone="map-pin"
        titulo="Esta visita não está no seu roteiro de hoje"
        acao={
          <Button href="/rua" icon="chevron-left">
            Voltar ao roteiro
          </Button>
        }
      />
    );
  return <FormVisita key={parada.id} p={parada} />;
}

function FormVisita({ p }: { p: ParadaRua }) {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const estado = useEstadoRua();
  const gravador = useGravador();
  const [resultado, setResultado] = useState<ResultadoVisita | null>(p.resultado);
  const [anotacao, setAnotacao] = useState(p.anotacao ?? '');
  const [passo, setPasso] = useState(p.proximoPasso ?? '');
  const [passoDia, setPassoDia] = useState(p.proximoPassoEm ?? '');
  const [passoMexido, setPassoMexido] = useState(!!p.proximoPasso);
  const [trocarPasso, setTrocarPasso] = useState(false);
  const [fotoOk, setFotoOk] = useState(p.temFoto);
  const [chegada, setChegada] = useState<{ distanciaM: number | null; noEndereco: boolean } | null>(
    p.chegouEm
      ? { distanciaM: p.chegouDistanciaM, noEndereco: (p.chegouDistanciaM ?? 1e9) <= RAIO_CHEGADA_METROS }
      : null,
  );
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['rua', 'hoje'] });

  const checkin = useMutation({
    mutationFn: async () => {
      const l = await localizacaoAgora(8000);
      return api<{ distanciaM: number | null; noEndereco: boolean }>(`/rua/paradas/${p.id}/chegada`, {
        metodo: 'POST',
        corpo: { lat: l?.lat ?? null, lng: l?.lng ?? null, precisao: l?.precisao ?? null },
      });
    },
    onSuccess: (c) => {
      setChegada(c);
      atualizar();
    },
  });

  const sugestao = useMutation({
    mutationFn: (r: ResultadoVisita) =>
      api<{ texto: string; dia: string; fonte: 'ia' | 'padrao' } | null>('/rua/sugestao-passo', {
        metodo: 'POST',
        corpo: { resultado: r, anotacao: anotacao.trim() || null },
      }),
    onSuccess: (s) => {
      if (passoMexido) return;
      setPasso(s?.texto ?? '');
      setPassoDia(s?.dia ?? '');
    },
  });
  const escolher = (r: ResultadoVisita) => {
    setResultado(r);
    sugestao.mutate(r);
  };

  const transcrever = useMutation({
    mutationFn: async () => {
      const audio = await gravador.parar();
      if (audio.size < 1200)
        throw new ErroApi(0, 'curto', 'O áudio ficou curto demais. Segure e fale de novo.');
      return enviarArquivo<{ texto: string }>('/assistente/transcrever', audio);
    },
    onSuccess: ({ texto }) => {
      if (!texto) return;
      setAnotacao((a) => (a.trim() ? `${a.trim()} ${texto}` : texto));
      if (resultado && !passoMexido) sugestao.mutate(resultado);
    },
  });
  const microfone = useMutation({ mutationFn: gravador.comecar });

  const foto = useMutation({
    mutationFn: async (arquivo: File) =>
      enviarArquivo(`/rua/paradas/${p.id}/foto`, await reduzirFoto(arquivo)),
    onSuccess: () => {
      setFotoOk(true);
      atualizar();
    },
  });

  const concluir = useMutation({
    mutationFn: () =>
      api<{ etapa: string }>(`/rua/paradas/${p.id}/concluir`, {
        metodo: 'POST',
        corpo: {
          resultado,
          anotacao: anotacao.trim() || null,
          proximoPasso: passo.trim() || null,
          proximoPassoEm: passo.trim() && passoDia ? passoDia : null,
        },
      }),
    onSuccess: () => {
      atualizar();
      cliente.invalidateQueries({ queryKey: ['funil'] });
      navegar('/rua?ver=hoje');
    },
  });
  const pular = useMutation({
    mutationFn: () => api(`/rua/paradas/${p.id}/pular`, { metodo: 'POST' }),
    onSuccess: () => {
      atualizar();
      navegar('/rua?ver=hoje');
    },
  });

  const dias = haDias(p.etapaDesde);
  const pontos = [
    p.proximaAcao ? `Próximo passo no funil: ${p.proximaAcao}.` : null,
    p.etapa === 'proposta' && dias != null
      ? `Recebeu a proposta há ${dias} ${dias === 1 ? 'dia' : 'dias'}.`
      : null,
    ...p.historico.map((h) => h.texto.split('\n')[0]!.slice(0, 160)),
  ].filter((x): x is string => !!x);
  const telefone = p.telefone?.replace(/\D/g, '');
  const erro =
    checkin.error ?? microfone.error ?? transcrever.error ?? foto.error ?? concluir.error ?? pular.error;

  return (
    <div className="rua-visita">
      <header className="rua-visita__topo">
        <div className="rua-visita__nome">
          <Link to="/rua?ver=hoje" className="rua-voltar" aria-label="Voltar ao roteiro">
            <Icon name="chevron-left" size={20} />
          </Link>
          <span className="rua-num">{p.ordem}</span>
          <div className="rua-visita__txt">
            <b>{nomeBonito(p.nome)}</b>
            <span className="quieto">
              {[p.bairro && nomeBonito(p.bairro), nomeBonito(p.cidade)].filter(Boolean).join(' · ')}
            </span>
          </div>
          {p.faixa && <ScoreBadge faixa={p.faixa} score={p.score ?? undefined} />}
        </div>
        {p.chegouEm || chegada ? (
          <div className="rua-checkin">
            <Icon name="check" size={16} />
            <span>
              Chegou às <b className="mono">{fmtHora(p.chegouEm ?? new Date().toISOString())}</b>
              {chegada?.distanciaM != null &&
                (chegada.noEndereco
                  ? ' · no endereço da empresa'
                  : ` · a ${chegada.distanciaM >= 1000 ? `${(chegada.distanciaM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `${chegada.distanciaM} m`} do endereço`)}
            </span>
          </div>
        ) : (
          <Button
            variant="primary"
            icon="map-pin"
            disabled={checkin.isPending}
            onClick={() => checkin.mutate()}
          >
            {checkin.isPending ? 'Registrando…' : 'Cheguei (fazer check-in)'}
          </Button>
        )}
      </header>

      <main className="rua-visita__corpo">
        {(p.decisor || pontos.length > 0 || telefone) && (
          <section className="rua-cartao" aria-label="Antes de entrar">
            <span className="rua-sobretitulo">Antes de entrar</span>
            {(p.decisor || telefone) && (
              <div className="rua-decisor">
                {p.decisor && <Avatar nome={p.decisor.nome} size={36} />}
                <div className="rua-decisor__txt">
                  <b>{p.decisor ? nomeBonito(p.decisor.nome) : 'Telefone da empresa'}</b>
                  {p.decisor?.cargo && <span className="quieto">{p.decisor.cargo}</span>}
                </div>
                {telefone && (
                  <a
                    className="rua-icone rua-icone--borda"
                    href={`tel:+55${telefone.replace(/^55/, '')}`}
                    aria-label="Ligar"
                  >
                    <Icon name="phone" size={18} />
                  </a>
                )}
              </div>
            )}
            {pontos.length > 0 && (
              <ul className="rua-pontos">
                {pontos.slice(0, 4).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <fieldset className="rua-secao">
          <legend className="rua-sobretitulo">Como foi</legend>
          <div className="rua-chips">
            {RESULTADOS_VISITA.map((r) => (
              <button
                key={r}
                type="button"
                className="rua-chip rua-chip--alto"
                aria-pressed={resultado === r}
                onClick={() => escolher(r)}
              >
                {ROTULO_RESULTADO[r]}
              </button>
            ))}
          </div>
        </fieldset>

        <section className="rua-secao" aria-label="Anotação">
          <label className="rua-sobretitulo" htmlFor="rua-anotacao">
            Anotação
          </label>
          <textarea
            id="rua-anotacao"
            className="rua-texto"
            rows={3}
            placeholder="O que foi conversado, objeções, combinados…"
            value={anotacao}
            onChange={(e) => setAnotacao(e.target.value)}
            onBlur={() =>
              resultado && !passoMexido && anotacao.trim().length > 15 && sugestao.mutate(resultado)
            }
          />
          <div className="rua-grade-botoes">
            {estado.data?.voz &&
              (gravador.gravando ? (
                <button
                  type="button"
                  className="rua-botao rua-botao--gravando"
                  onClick={() => transcrever.mutate()}
                >
                  <Icon name="square" size={16} /> Parar e escrever
                </button>
              ) : (
                <button
                  type="button"
                  className="rua-botao"
                  disabled={transcrever.isPending}
                  onClick={() => microfone.mutate()}
                >
                  <Icon name="mic" size={18} /> {transcrever.isPending ? 'Escrevendo…' : 'Falar'}
                </button>
              ))}
            {estado.data?.fotos && (
              <label className="rua-botao" data-feito={fotoOk || undefined}>
                <Icon name={fotoOk ? 'check' : 'camera'} size={18} />
                {foto.isPending ? 'Enviando…' : fotoOk ? 'Foto guardada' : 'Foto da fachada'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="pp-sr"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) foto.mutate(f);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {gravador.gravando && (
            <span className="rua-dica quieto">Gravando… fale e toque em "Parar e escrever".</span>
          )}
        </section>

        {resultado && resultado !== 'sem_interesse' && (
          <section className="rua-secao" aria-label="Próximo passo">
            <span className="rua-sobretitulo">Próximo passo</span>
            {trocarPasso || !passo ? (
              <div className="rua-passo-editar">
                <label className="pp-sr" htmlFor="rua-passo">
                  O que fazer
                </label>
                <input
                  id="rua-passo"
                  className="filtro"
                  placeholder="Ex.: mandar a proposta"
                  value={passo}
                  onChange={(e) => {
                    setPasso(e.target.value);
                    setPassoMexido(true);
                  }}
                />
                <label className="pp-sr" htmlFor="rua-passo-dia">
                  Quando
                </label>
                <input
                  id="rua-passo-dia"
                  className="filtro"
                  type="date"
                  value={passoDia}
                  onChange={(e) => {
                    setPassoDia(e.target.value);
                    setPassoMexido(true);
                  }}
                />
              </div>
            ) : (
              <div className="rua-cartao rua-passo">
                <Icon name="calendar" size={18} />
                <div className="rua-passo__txt">
                  <b>{passo}</b>
                  <span className="quieto">
                    {passoDia ? fmtDiaPasso(passoDia) : 'Sem data'}
                    {sugestao.data?.fonte === 'ia' && !passoMexido ? ' · sugerido pela anotação' : ''}
                  </span>
                </div>
                <button type="button" className="rua-link-pequeno" onClick={() => setTrocarPasso(true)}>
                  Trocar
                </button>
              </div>
            )}
          </section>
        )}

        <ErroDaApi erro={erro} />
        {!estado.data?.fotos && estado.data && (
          <span className="rua-dica quieto">
            A foto da fachada aparece quando o armazenamento de arquivos estiver ligado.
          </span>
        )}
      </main>

      <footer className="rua-visita__rodape">
        <button
          type="button"
          className="rua-botao rua-botao--primario rua-botao--grande"
          disabled={!resultado || concluir.isPending || p.situacao === 'feita'}
          onClick={() => concluir.mutate()}
        >
          {concluir.isPending ? 'Registrando…' : 'Concluir e ir para a próxima'}
        </button>
        {resultado ? (
          <span className="quieto rua-dica">
            {DESTINO[resultado]
              ? `O lead vai para ${DESTINO[resultado]} no funil`
              : 'O lead fica na mesma etapa do funil'}{' '}
            e a visita entra no histórico.
          </span>
        ) : (
          <span className="quieto rua-dica">Escolha como foi a visita para concluir.</span>
        )}
        {p.situacao !== 'feita' && (
          <button
            type="button"
            className="rua-link-pequeno"
            disabled={pular.isPending}
            onClick={() => pular.mutate()}
          >
            Pular esta visita
          </button>
        )}
        {p.situacao === 'feita' && <Mensagem tipo="ok">Esta visita já foi registrada.</Mensagem>}
      </footer>
    </div>
  );
}
