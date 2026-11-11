import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtQuando } from '../formatar';
import type { Peca } from './Publicacao';

/**
 * Publicar e agendar pelo CRM (v133): o dia e a hora, a legenda e o Comente e receba ligado direto no
 * post. Antes de a Meta aprovar a permissão de publicar, o cartão diz isso e o caminho continua o de
 * baixar e postar pelo celular.
 */

export interface SituacaoPublicar {
  ligado: boolean;
  conectado: boolean;
  permissao: boolean;
  limite: { usadas: number; limite: number } | null;
}

export interface AgendamentoPost {
  id: number;
  para: string;
  legenda: string;
  comente: boolean;
  situacao: 'agendado' | 'publicando' | 'publicado' | 'falhou' | 'cancelado';
  midiaLink: string | null;
  erro: string | null;
  publicadoEm: string | null;
}

interface RespostaPublicar {
  situacao: SituacaoPublicar;
  agendamento: AgendamentoPost | null;
}

const BASE = { carrossel: 'carrosseis', video: 'videos' } as const;

export const usePublicar = (peca: Peca) =>
  useQuery({
    queryKey: [BASE[peca.tipo], peca.id, 'publicar'],
    queryFn: () => api<RespostaPublicar>(`/${BASE[peca.tipo]}/${peca.id}/publicar`),
    refetchInterval: (q) => (q.state.data?.agendamento?.situacao === 'publicando' ? 10_000 : false),
  });

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Amanhã às 18:30 no horário do aparelho (o horário de pico mais comum, ajustável). */
function sugestao(): { dia: string; hora: string } {
  const d = new Date(Date.now() + 86_400_000);
  return {
    dia: `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`,
    hora: '18:30',
  };
}

const fmtDiaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function AgendarPublicacao(props: {
  peca: Peca;
  legenda: string;
  /** A palavra da regra do Comente e receba (null: a peça não pede para comentar). */
  palavra: string | null;
  /** Salva o que está na tela antes (a peça muda de situação). */
  salvarAntes: () => Promise<void>;
  aoMudar: () => void;
}) {
  const q = usePublicar(props.peca);
  const cliente = useQueryClient();
  const inicial = useMemo(sugestao, []);
  const [dia, setDia] = useState(inicial.dia);
  const [hora, setHora] = useState(inicial.hora);
  const [legenda, setLegenda] = useState<string | null>(null);
  const [comente, setComente] = useState(true);
  const atualizar = (r: RespostaPublicar) => {
    cliente.setQueryData([BASE[props.peca.tipo], props.peca.id, 'publicar'], r);
    void cliente.invalidateQueries({ queryKey: [BASE[props.peca.tipo], 'calendario'] });
    props.aoMudar();
  };
  const pedir = useMutation({
    mutationFn: async (agora: boolean) => {
      await props.salvarAntes();
      const para = agora ? null : new Date(`${dia}T${hora}:00`).toISOString();
      return api<RespostaPublicar>(`/${BASE[props.peca.tipo]}/${props.peca.id}/publicar`, {
        metodo: 'POST',
        corpo: { para, legenda: legenda ?? props.legenda, comente: comente && !!props.palavra },
      });
    },
    onSuccess: atualizar,
  });
  const cancelar = useMutation({
    mutationFn: () =>
      api<RespostaPublicar>(`/${BASE[props.peca.tipo]}/${props.peca.id}/publicar`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });

  if (q.isPending) return <div className="esqueleto" style={{ height: 120 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const { situacao: s, agendamento: a } = q.data;

  if (!s.ligado)
    return (
      <div className="pub__cartao pub__cartao--quieto">
        <div className="pub__titulo">
          <b>Publicar e agendar pelo CRM</b>
          <Badge tone="neutral">em breve</Badge>
        </div>
        <p className="pub__texto">
          Assim que a Meta aprovar a permissão de publicar, dá para escolher o dia e a hora aqui e o CRM posta
          sozinho. Por enquanto, baixe e poste pelo celular: o Comente e receba funciona do mesmo jeito.
        </p>
      </div>
    );
  if (!s.conectado || !s.permissao)
    return (
      <div className="pub__cartao">
        <div className="pub__titulo">
          <b>Publicar e agendar pelo CRM</b>
        </div>
        <p className="pub__texto">
          {s.conectado
            ? 'A conexão do Instagram é de antes da permissão de publicar. Reconecte o Instagram para o CRM poder postar.'
            : 'Conecte o Instagram da empresa para o CRM poder postar.'}
        </p>
        <div className="pub__acoes">
          <Link to="/instagram?aba=conexao" className="botao-link botao-link--prim">
            {s.conectado ? 'Reconectar o Instagram' : 'Conectar o Instagram'}
          </Link>
        </div>
      </div>
    );

  if (a && (a.situacao === 'agendado' || a.situacao === 'publicando'))
    return (
      <div className="pub__cartao">
        <div className="pub__titulo">
          <b>
            {a.situacao === 'publicando' ? 'Publicando no Instagram…' : `Agendado para ${fmtDiaHora(a.para)}`}
          </b>
          <Badge tone="warning">{a.situacao === 'publicando' ? 'publicando' : 'agendado'}</Badge>
        </div>
        <p className="pub__texto">
          {a.situacao === 'publicando'
            ? 'A Meta está recebendo as imagens ou processando o vídeo. Leva alguns minutos; chega um aviso no sino.'
            : `O CRM posta sozinho no horário${a.comente && props.palavra ? ` e liga o Comente e receba do ${props.palavra} no post` : ''}. Para editar, cancele o agendamento.`}
        </p>
        {a.erro && <Mensagem tipo="aviso">Na tentativa anterior: {a.erro} Vamos tentar de novo.</Mensagem>}
        {a.situacao === 'agendado' && (
          <div className="pub__acoes">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
            >
              Cancelar o agendamento
            </Button>
          </div>
        )}
        <ErroDaApi erro={cancelar.error} />
      </div>
    );

  const texto = legenda ?? props.legenda;
  const quando = new Date(`${dia}T${hora}:00`);
  const valido = !Number.isNaN(quando.getTime()) && quando.getTime() > Date.now();
  return (
    <form
      className="pub__cartao agendar"
      onSubmit={(e) => {
        e.preventDefault();
        pedir.mutate(false);
      }}
    >
      <div className="pub__titulo">
        <b>Publicar e agendar pelo CRM</b>
        {s.limite && (
          <span className="quieto">
            {s.limite.usadas} de {s.limite.limite} posts pela API nas últimas 24 h
          </span>
        )}
      </div>
      {a?.situacao === 'falhou' && <Mensagem tipo="erro">A última tentativa não publicou: {a.erro}</Mensagem>}
      <div className="form__duas">
        <div className="campo">
          <label htmlFor="agendar-dia">Dia</label>
          <input
            id="agendar-dia"
            type="date"
            className="filtro"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="agendar-hora">Hora</label>
          <input
            id="agendar-hora"
            type="time"
            className="filtro mono"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="agendar-legenda">Legenda</label>
        <textarea
          id="agendar-legenda"
          className="filtro"
          rows={5}
          maxLength={2200}
          value={texto}
          onChange={(e) => setLegenda(e.target.value)}
        />
        <span className="campo__dica">
          {texto.length.toLocaleString('pt-BR')} de 2.200 · as primeiras 125 letras aparecem antes do “mais”.
        </span>
      </div>
      {props.palavra && (
        <label className="opcao">
          <input type="checkbox" checked={comente} onChange={(e) => setComente(e.target.checked)} />
          <span>
            <b>Ligar o Comente e receba neste post</b>
            <span className="campo__dica" style={{ display: 'block' }}>
              Quem comentar <span className="mono">{props.palavra}</span> recebe o direct e vira lead no
              funil.
            </span>
          </span>
        </label>
      )}
      <p className="quieto">
        O post sai sozinho no horário. Se a Meta recusar, chega um aviso e{' '}
        {props.peca.tipo === 'video' ? 'o vídeo' : 'o carrossel'} volta para Pronto.
      </p>
      <ErroDaApi erro={pedir.error} />
      <div className="pub__acoes">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon="calendar"
          disabled={!valido || pedir.isPending}
        >
          {valido ? `Agendar para ${fmtDiaHora(quando.toISOString())}` : 'Escolha um horário que não passou'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon="send"
          onClick={() => pedir.mutate(true)}
          disabled={pedir.isPending}
        >
          Publicar agora
        </Button>
      </div>
      {a?.situacao === 'publicado' && a.publicadoEm && (
        <span className="campo__dica">Último publicado pelo CRM {fmtQuando(a.publicadoEm)}.</span>
      )}
    </form>
  );
}

/* ───────────────────────────── O calendário ───────────────────────────── */

interface ItemDoCalendario {
  tipo: 'carrossel' | 'video';
  id: number;
  titulo: string;
  em: string;
  situacao: 'agendado' | 'publicando' | 'publicado' | 'falhou';
  peloCrm: boolean;
  link: string | null;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

const diaEmSp = (iso: string) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return { dia: d.getDate(), hora: `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}` };
};

/** A aba Calendário: os carrosséis e vídeos agendados e publicados no mês. */
export function CalendarioDePosts() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const chave = `${ano}-${doisDigitos(mes + 1)}`;
  const q = useQuery({
    queryKey: ['carrosseis', 'calendario', chave],
    queryFn: () =>
      api<{ itens: ItemDoCalendario[]; situacao: SituacaoPublicar }>(`/carrosseis/calendario?mes=${chave}`),
  });
  const mover = (n: number) => {
    const d = new Date(ano, mes + n, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
  };
  const primeiro = new Date(ano, mes, 1).getDay();
  const nDias = new Date(ano, mes + 1, 0).getDate();
  const celulas = Array.from({ length: Math.ceil((primeiro + nDias) / 7) * 7 }, (_, i) => i - primeiro + 1);
  const porDia = new Map<number, (ItemDoCalendario & { hora: string })[]>();
  for (const it of q.data?.itens ?? []) {
    const { dia, hora } = diaEmSp(it.em);
    porDia.set(dia, [...(porDia.get(dia) ?? []), { ...it, hora }]);
  }
  const s = q.data?.situacao;
  return (
    <section className="calendario" aria-label={`${MESES[mes]} de ${ano}`}>
      <div className="calendario__topo">
        <Button
          size="sm"
          variant="ghost"
          icon="chevron-left"
          aria-label="Mês anterior"
          onClick={() => mover(-1)}
        />
        <h2>
          {MESES[mes]![0]!.toUpperCase() + MESES[mes]!.slice(1)} de {ano}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          icon="chevron-right"
          aria-label="Próximo mês"
          onClick={() => mover(1)}
        />
        <span className="quieto calendario__nota">
          {s && !s.ligado
            ? 'Publicar pelo CRM liga quando a Meta aprovar. Aqui aparecem os posts reconhecidos.'
            : 'Agende pela aba Publicação de cada carrossel ou vídeo.'}
        </span>
      </div>
      {q.error && <ErroDaApi erro={q.error} />}
      <div className="calendario__semana" aria-hidden="true">
        {DIAS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendario__grade">
        {celulas.map((n) => (
          <div key={`d${n}`} className="calendario__dia" data-fora={n < 1 || n > nDias || undefined}>
            {n >= 1 && n <= nDias && (
              <>
                <span className="calendario__n mono">{n}</span>
                {(porDia.get(n) ?? []).map((it) => (
                  <Link
                    key={`${it.tipo}-${it.id}-${it.em}`}
                    to={
                      it.tipo === 'video'
                        ? `/videos/${it.id}?aba=publicacao`
                        : `/carrosseis/${it.id}?aba=publicacao`
                    }
                    className="calendario__post"
                    data-situacao={it.situacao}
                  >
                    <b>
                      <Icon name={it.tipo === 'video' ? 'video' : 'layout-grid'} size={12} /> {it.titulo}
                    </b>
                    <span>
                      {it.situacao === 'publicado'
                        ? 'publicado'
                        : it.situacao === 'falhou'
                          ? 'não publicou'
                          : 'agendado'}{' '}
                      · {it.hora}
                    </span>
                  </Link>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
