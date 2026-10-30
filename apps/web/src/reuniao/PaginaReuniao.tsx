import { faltaParaAbrir } from '@prospeccao/shared/reunioes';
import { Button, Icon } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ErroApi } from '../api';
import { Mensagem } from '../componentes/Formulario';
import { TecnologiaProspectTeam } from '../componentes/Marca';
import { Antessala, type Escolhas } from './Antessala';
import { apiSala, type InfoSala, type Liberado } from './api';
import { retomarEnviosPendentes } from './envio';
import { Sala, useEstadoGravador } from './Sala';
import './reuniao.css';
import { linkDaSala } from '../endereco';
import { useMarcaDoEndereco, useMarcaNoNavegador } from '../marcaPublica';

/**
 * Página do link da reunião (/r/<código>): antes da hora mostra quanto falta; depois, a antessala
 * (nome, câmera e microfone, aviso de gravação) e a sala. Quem é do time entra pelo próprio login.
 */

const fmtDia = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "Quinta, 30 de outubro · 15:00 às 16:00" no fuso de quem abriu o link. */
export function quandoReuniao(inicio: string, fim: string | null): string {
  const i = new Date(inicio);
  const dia = fmtDia.format(i);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${fmtHora.format(i)}${fim ? ` às ${fmtHora.format(new Date(fim))}` : ''}`;
}

export function Marca(props: { empresa: InfoSala['empresa'] }) {
  const iniciais = props.empresa.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <header className="rp__topo">
      <span
        className="rp__marca"
        aria-hidden="true"
        style={props.empresa.cor ? { background: props.empresa.cor } : undefined}
      >
        {props.empresa.logo ? <img src={props.empresa.logo} alt="" /> : iniciais}
      </span>
      <span className="rp__empresa">{props.empresa.nome}</span>
    </header>
  );
}

function Moldura(props: { info?: InfoSala; children: React.ReactNode }) {
  return (
    <div className="rp" data-theme="light">
      {props.info && <Marca empresa={props.info.empresa} />}
      <main className="rp__meio">{props.children}</main>
      <footer className="rp__rodape">
        <TecnologiaProspectTeam />
      </footer>
    </div>
  );
}

function Cartao(props: { children: React.ReactNode }) {
  return <section className="rp__cartao">{props.children}</section>;
}

/** Diferença entre o relógio do servidor e o do aparelho (a contagem não depende do relógio do celular). */
function useRelogio(agoraServidor: string | undefined) {
  const [ajuste, setAjuste] = useState(0);
  const [, setTique] = useState(0);
  useEffect(() => {
    if (agoraServidor) setAjuste(new Date(agoraServidor).getTime() - Date.now());
  }, [agoraServidor]);
  useEffect(() => {
    const t = setInterval(() => setTique((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  return () => new Date(Date.now() + ajuste);
}

type Fase =
  | { tipo: 'antessala' }
  | { tipo: 'aguardando'; participanteId: string; segredo: string; escolhas: Escolhas }
  | { tipo: 'recusado' }
  | { tipo: 'na_sala'; acesso: Liberado; escolhas: Escolhas }
  | { tipo: 'saiu'; motivo: 'saiu' | 'encerrada' | 'removido' | 'erro'; detalhe?: string };

/**
 * Depois de sair: a gravação feita neste navegador termina de subir. Mostra o progresso e pede
 * para não fechar a aba (se fechar, o que faltou sobe na próxima vez que abrir o sistema).
 */
function EnvioDaGravacao() {
  const e = useEstadoGravador();
  if (e.fase !== 'enviando' && e.fase !== 'concluido') return null;
  const pct = e.total ? Math.min(100, Math.round(((e.total - e.pendentes) / e.total) * 100)) : 100;
  const terminou = e.fase === 'concluido' || e.pendentes === 0;
  return (
    <div className="envio-gravacao" role="status" aria-live="polite">
      <div className="envio-gravacao__linha">
        <Icon name={terminou ? 'check' : 'loader'} spin={!terminou} size={18} />
        <b>{terminou ? 'Gravação enviada' : `Enviando a gravação… ${pct}%`}</b>
      </div>
      {!terminou && (
        <div className="envio-gravacao__barra" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="rp__nota" style={{ margin: 0 }}>
        {terminou
          ? 'O vídeo, a transcrição e o resumo ficam prontos em alguns minutos, em Reuniões.'
          : 'Deixe esta aba aberta até terminar. Se precisar fechar, o que faltou sobe na próxima vez que você abrir o sistema neste computador.'}
      </p>
      {e.aviso && <Mensagem tipo="aviso">{e.aviso}</Mensagem>}
    </div>
  );
}

export function PaginaReuniao() {
  const { codigo = '' } = useParams();
  const [fase, setFase] = useState<Fase>({ tipo: 'antessala' });
  const info = useQuery({
    queryKey: ['sala', codigo],
    queryFn: () => apiSala<InfoSala>(`/${codigo}`),
    // Antes de abrir, confere de tempos em tempos (a página entra sozinha na hora).
    refetchInterval: (q) => (q.state.data?.situacao === 'antes' ? 30_000 : false),
    retry: (n, erro) => !(erro instanceof ErroApi && erro.status < 500) && n < 3,
  });
  const agora = useRelogio(info.data?.agora);
  // No domínio próprio do cliente: ícone, nome e cor dele na aba.
  useMarcaNoNavegador(useMarcaDoEndereco().marca);
  // Gravação de uma reunião anterior que não terminou de subir (a aba fechou): sobe agora.
  useEffect(() => {
    void retomarEnviosPendentes();
  }, []);

  useEffect(() => {
    document.title = info.data ? `${info.data.titulo} · Reunião` : 'Reunião';
  }, [info.data]);

  // Hora de abrir chegou: busca de novo (a situação muda para "aberta").
  const abreEm = info.data?.situacao === 'antes' ? new Date(info.data.abreEm).getTime() : null;
  useEffect(() => {
    if (!abreEm) return;
    const falta = abreEm - agora().getTime();
    const t = setTimeout(() => void info.refetch(), Math.max(1000, Math.min(falta + 500, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [abreEm, info, agora]);

  if (info.isPending)
    return (
      <Moldura>
        <p className="quieto">Abrindo a reunião…</p>
      </Moldura>
    );
  if (info.isError || !info.data)
    return (
      <Moldura>
        <Cartao>
          <h1 className="rp__titulo">Reunião não encontrada</h1>
          <p className="rp__nota">
            Confira se o link está completo. Se o problema continuar, peça um link novo para quem marcou a
            reunião.
          </p>
        </Cartao>
      </Moldura>
    );

  const d = info.data;
  if (!d.videoConfigurado)
    return (
      <Moldura info={d}>
        <Cartao>
          <h1 className="rp__titulo">{d.titulo}</h1>
          <Mensagem tipo="aviso">
            A sala de vídeo ainda não está pronta neste sistema. Avise quem marcou a reunião.
          </Mensagem>
        </Cartao>
      </Moldura>
    );

  if (fase.tipo === 'na_sala')
    return (
      <Sala
        info={d}
        acesso={fase.acesso}
        escolhas={fase.escolhas}
        aoSair={(motivo, detalhe) => setFase({ tipo: 'saiu', motivo, detalhe })}
      />
    );

  if (fase.tipo === 'saiu')
    return (
      <Moldura info={d}>
        <Cartao>
          <EnvioDaGravacao />
          <h1 className="rp__titulo">
            {fase.motivo === 'encerrada'
              ? 'A reunião foi encerrada'
              : fase.motivo === 'removido'
                ? 'Você saiu da reunião'
                : fase.motivo === 'erro'
                  ? 'A conexão com a reunião caiu'
                  : 'Você saiu da reunião'}
          </h1>
          <p className="rp__nota">
            {fase.motivo === 'encerrada'
              ? 'Obrigado por participar.'
              : fase.motivo === 'removido'
                ? 'Quem conduz a reunião tirou você da sala.'
                : (fase.detalhe ?? 'Se saiu sem querer, é só voltar.')}
          </p>
          {(fase.motivo === 'saiu' || fase.motivo === 'erro') && (
            <div className="acoes">
              <Button
                variant="primary"
                icon="refresh-cw"
                onClick={() => {
                  void info.refetch();
                  setFase({ tipo: 'antessala' });
                }}
              >
                Voltar para a sala
              </Button>
            </div>
          )}
          {d.voce && (
            <p className="rp__nota">
              <a href="/reunioes">Ver reuniões no sistema</a>
            </p>
          )}
        </Cartao>
      </Moldura>
    );

  if (d.situacao === 'cancelada' || (d.situacao === 'encerrada' && !d.voce))
    return (
      <Moldura info={d}>
        <Cartao>
          <p className="rp__sobre">
            {d.situacao === 'cancelada' ? 'Reunião cancelada' : 'Reunião encerrada'}
          </p>
          <h1 className="rp__titulo">{d.titulo}</h1>
          <p className="rp__nota">
            {d.situacao === 'cancelada'
              ? 'Esta reunião foi cancelada. Fale com quem marcou para combinar outro horário.'
              : 'Esta reunião já terminou. Se precisar conversar de novo, peça um link novo.'}
          </p>
        </Cartao>
      </Moldura>
    );

  if (fase.tipo === 'recusado')
    return (
      <Moldura info={d}>
        <Cartao>
          <h1 className="rp__titulo">Não foi possível entrar</h1>
          <p className="rp__nota">
            Quem conduz a reunião não liberou a sua entrada. Fale com quem convidou você.
          </p>
        </Cartao>
      </Moldura>
    );

  if (fase.tipo === 'aguardando')
    return (
      <Moldura info={d}>
        <Espera
          info={d}
          participanteId={fase.participanteId}
          segredo={fase.segredo}
          aoLiberar={(acesso) => setFase({ tipo: 'na_sala', acesso, escolhas: fase.escolhas })}
          aoRecusar={() => setFase({ tipo: 'recusado' })}
          aoCancelar={() => setFase({ tipo: 'antessala' })}
        />
      </Moldura>
    );

  return (
    <Moldura info={d}>
      <Antessala
        info={d}
        agora={agora}
        aoAguardar={(r, escolhas) => setFase({ tipo: 'aguardando', ...r, escolhas })}
        aoEntrar={(acesso, escolhas) => setFase({ tipo: 'na_sala', acesso, escolhas })}
        aoRecusar={() => setFase({ tipo: 'recusado' })}
        aoAtualizar={() => void info.refetch()}
      />
    </Moldura>
  );
}

/** Na sala de espera: pergunta a cada 2 segundos se já pode entrar. */
function Espera(props: {
  info: InfoSala;
  participanteId: string;
  segredo: string;
  aoLiberar: (a: Liberado) => void;
  aoRecusar: () => void;
  aoCancelar: () => void;
}) {
  const { info, participanteId, segredo, aoLiberar, aoRecusar } = props;
  const q = useQuery({
    queryKey: ['sala', info.codigo, 'espera', participanteId],
    queryFn: () =>
      apiSala<
        Liberado | { estado: 'aguardando'; participanteId: string; segredo: string } | { estado: 'recusado' }
      >(`/${info.codigo}/espera/${participanteId}?segredo=${encodeURIComponent(segredo)}`),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (q.data?.estado === 'liberado') aoLiberar(q.data);
    else if (q.data?.estado === 'recusado') aoRecusar();
  }, [q.data, aoLiberar, aoRecusar]);
  return (
    <Cartao>
      <p className="rp__sobre">Sala de espera</p>
      <h1 className="rp__titulo">{info.titulo}</h1>
      <div className="rp__contagem">
        <Icon name="loader" spin size={20} />
        <span>Pedimos para você entrar.</span>
        <span className="rp__nota">
          Assim que alguém da reunião aceitar, você entra sozinho. Não feche esta página.
        </span>
      </div>
      {q.isError && <Mensagem tipo="aviso">A conexão oscilou. Continuamos tentando.</Mensagem>}
      <div className="acoes">
        <Button variant="ghost" onClick={props.aoCancelar}>
          Voltar
        </Button>
      </div>
    </Cartao>
  );
}

/** Tela "a sala ainda não abriu" (usada pela antessala). */
export function AntesDeAbrir(props: { info: InfoSala; agora: () => Date; aoTestar: () => void }) {
  const { info } = props;
  const abre = new Date(info.abreEm);
  const minutosAntes = Math.round((new Date(info.inicio).getTime() - abre.getTime()) / 60_000);
  return (
    <Cartao>
      <div className="pilha" style={{ gap: 8 }}>
        <p className="rp__sobre">Você foi convidado para</p>
        <h1 className="rp__titulo">{info.titulo}</h1>
        <div className="rp__dados">
          <span>
            <Icon name="calendar" size={16} />
            {quandoReuniao(info.inicio, info.fim)}
          </span>
          {info.anfitriao && (
            <span>
              <Icon name="user-round" size={16} />
              Com {info.anfitriao}, {info.empresa.nome}
            </span>
          )}
        </div>
      </div>
      <div className="rp__contagem" aria-live="polite">
        <span className="quieto">
          A sala abre às {fmtHora.format(abre)}
          {minutosAntes > 0 ? `, ${minutosAntes} minutos antes` : ''}
        </span>
        <strong>{faltaParaAbrir(abre, props.agora())}</strong>
        <span className="rp__nota">Esta página entra sozinha quando a sala abrir.</span>
      </div>
      <div className="acoes">
        <Button
          variant="secondary"
          icon="calendar-plus"
          href={linkAgenda(info)}
          target="_blank"
          rel="noreferrer"
        >
          Adicionar à minha agenda
        </Button>
        <Button variant="ghost" icon="video" onClick={props.aoTestar}>
          Testar câmera e microfone agora
        </Button>
      </div>
      <p className="rp__nota">
        Não precisa instalar nada nem criar conta. Funciona no navegador do computador ou do celular.
      </p>
    </Cartao>
  );
}

/** Evento no Google Agenda com o link da reunião. */
function linkAgenda(info: InfoSala): string {
  const f = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const inicio = new Date(info.inicio);
  const fim = info.fim ? new Date(info.fim) : new Date(inicio.getTime() + 60 * 60_000);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: info.titulo,
    dates: `${f(inicio)}/${f(fim)}`,
    details: `Entre pelo link: ${linkDaSala(info.codigo)}`,
    location: linkDaSala(info.codigo),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
