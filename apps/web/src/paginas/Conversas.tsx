import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  api,
  type ContatoLead,
  type ConversaAberta,
  type ConversaResumo,
  type MensagemConversa,
  type RespostaRapida,
  type TipoMidia,
} from '../api';
import { EnviarPara, FaixaIndicacoes, PainelContatos } from '../componentes/ContatosNegociacao';
import { Drawer } from '../componentes/Drawer';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { Dono } from '../componentes/Sessao';
import { FormTarefa } from '../componentes/Tarefas';
import { fmtCidade, fmtHoraSo, fmtNome, fmtQuando, formatarTelefone } from '../formatar';
import { ListaNaoIdentificados, PainelNaoIdentificado, useNaoIdentificados } from './NaoIdentificados';

const LIMITE = 10 * 1024 * 1024;

/** Mesmas variáveis dos modelos da cadência: {saudacao}, {nome}, {empresa}, {cidade}, {remetente}. */
function aplicarVariaveis(texto: string, v: ConversaAberta['variaveis']): string {
  const nome = v.nome?.trim() || '';
  const valores: Record<string, string> = {
    saudacao: nome ? `Olá, ${nome}!` : 'Olá!',
    nome,
    empresa: v.empresa,
    cidade: v.cidade?.trim() || 'sua cidade',
    remetente: v.remetente?.trim() || '',
  };
  return texto
    .replace(/\{(\w+)\}/g, (todo, k: string) => valores[k] ?? todo)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim();
}

function tipoDoArquivo(mime: string): TipoMidia {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'imagem';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'documento';
}

function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

const ROTULO_MIDIA: Record<TipoMidia, string> = {
  imagem: 'Foto',
  audio: 'Áudio',
  video: 'Vídeo',
  documento: 'Documento',
};
const ICONE_MIDIA: Record<TipoMidia, string> = {
  imagem: 'image',
  audio: 'mic',
  video: 'play',
  documento: 'file-text',
};

function prefixo(c: ConversaResumo): string {
  if (c.ultimaDirecao !== 'enviada') return '';
  return c.ultimaOrigem === 'agente' ? 'IA: ' : 'Você: ';
}

function ItemLista(props: { c: ConversaResumo; ativo: boolean; aoAbrir: () => void }) {
  const { c } = props;
  return (
    <li>
      <button
        type="button"
        className="conversa-item"
        aria-current={props.ativo || undefined}
        onClick={props.aoAbrir}
      >
        <span className="conversa-item__topo">
          <b>{fmtNome(c.nome)}</b>
          <span
            className={c.naoLidas ? 'conversa-item__hora conversa-item__hora--nova' : 'conversa-item__hora'}
          >
            {fmtQuando(c.ultimaEm)}
          </span>
        </span>
        <span className="conversa-item__linha">
          <span className="conversa-item__previa">
            {c.ultimoCanal === 'email' && <Icon name="mail" size={12} />}
            {prefixo(c)}
            {c.ultimaMidia && <Icon name={ICONE_MIDIA[c.ultimaMidia]} size={12} />} {c.ultima ?? ''}
          </span>
          {c.naoLidas > 0 && <span className="conversa-item__conta">{c.naoLidas}</span>}
        </span>
        {(c.falandoCom || c.sugestoes > 0) && (
          <span className="conversa-item__quem">
            {c.falandoCom && (
              <span>
                <Icon name="users" size={12} /> com {c.falandoCom}
              </span>
            )}
            {c.sugestoes > 0 && (
              <span className="etiqueta etiqueta--nova">
                <Icon name="user-plus" size={10} />{' '}
                {c.sugestoes === 1 ? '1 indicação' : `${c.sugestoes} indicações`}
              </span>
            )}
          </span>
        )}
        <span className="conversa-item__rodape">
          <span className="ponto-etapa" style={{ background: c.etapaCor ?? '#94a3b8' }} aria-hidden="true" />
          <span>{c.etapaNome ?? c.etapa}</span>
          {c.agente && !c.agentePausa && (
            <span className="etiqueta etiqueta--marca">
              <Icon name="bot" size={10} /> IA
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            <Dono id={c.responsavelId} nome={c.responsavelNome} tamanho={18} />
          </span>
        </span>
      </button>
    </li>
  );
}

function Midia(props: { m: MensagemConversa }) {
  const { m } = props;
  if (!m.midiaTipo) return null;
  if (!m.midiaId)
    return (
      <span className="bolha__midia-ausente">
        <Icon name={ICONE_MIDIA[m.midiaTipo]} size={14} /> {ROTULO_MIDIA[m.midiaTipo]} (baixando…)
      </span>
    );
  const src = `/api/conversas/midia/${m.midiaId}`;
  if (m.midiaTipo === 'imagem')
    return (
      <a href={src} target="_blank" rel="noreferrer" className="bolha__imagem">
        <img src={src} alt={m.texto && !m.texto.startsWith('[') ? m.texto : 'Foto'} loading="lazy" />
      </a>
    );
  if (m.midiaTipo === 'audio')
    return (
      <audio controls preload="none" src={src} className="bolha__audio">
        <track kind="captions" />
      </audio>
    );
  if (m.midiaTipo === 'video')
    return (
      <video controls preload="none" src={src} className="bolha__video">
        <track kind="captions" />
      </video>
    );
  return (
    <a href={src} target="_blank" rel="noreferrer" className="bolha__doc">
      <Icon name="file-down" size={16} /> {m.texto.replace(/^\[documento\]\s*/, '') || 'Abrir arquivo'}
    </a>
  );
}

/** Links (http, https, www.) viram clicáveis e abrem em outra aba; o resto fica como texto. */
const LINK = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
export function TextoComLinks(props: { texto: string }) {
  const partes = props.texto.split(LINK);
  return (
    <>
      {partes.map((parte, i) => {
        if (i % 2 === 0) return parte;
        // Pontuação colada no fim ("veja www.site.com.") fica fora do link.
        const [, url = parte, sobra = ''] = parte.match(/^(.*?)([.,;:!?)\]]*)$/) ?? [];
        const href = url.startsWith('http') ? url : `https://${url}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: as partes não mudam de ordem
          <span key={i}>
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="bolha__link">
              {url}
            </a>
            {sobra}
          </span>
        );
      })}
    </>
  );
}

const diaSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});

/** Quem falou ou para quem foi, quando a conversa tem mais de uma pessoa da empresa. */
function participante(m: MensagemConversa): string | null {
  if (m.canal !== 'whatsapp' || !m.telefone) return null;
  const quem = m.contatoNome
    ? `${fmtNome(m.contatoNome)}${m.contatoCargo ? ` · ${m.contatoCargo}` : ''}`
    : 'Número da empresa';
  return m.direcao === 'enviada' ? `Para ${quem}` : quem;
}

function Bolhas(props: { mensagens: MensagemConversa[]; variasPessoas: boolean }) {
  const fim = useRef<HTMLDivElement>(null);
  const ultima = props.mensagens.at(-1)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola só quando chega mensagem nova
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [ultima]);
  let diaAnterior = '';
  return (
    <div className="bolhas" aria-live="polite">
      {props.mensagens.map((m) => {
        const dia = diaSP.format(new Date(m.em));
        const separador = dia !== diaAnterior;
        diaAnterior = dia;
        const soRotulo = m.midiaTipo && /^\[(foto|figurinha|áudio|vídeo|documento)\]/.test(m.texto);
        return (
          <div key={m.id} className="bolhas__grupo">
            {separador && <div className="bolhas__dia">{dia}</div>}
            <div
              className="bolha"
              data-lado={m.direcao}
              data-status={m.status}
              data-origem={m.origem}
              data-canal={m.canal}
            >
              {props.variasPessoas && participante(m) && (
                <span className="bolha__pessoa" title={m.telefone ? formatarTelefone(m.telefone) : undefined}>
                  {participante(m)}
                </span>
              )}
              {m.canal === 'email' && (
                <span className="bolha__canal">
                  <Icon name="mail" size={12} /> E-mail
                  {m.assunto ? ` · ${m.assunto}` : ''}
                </span>
              )}
              <Midia m={m} />
              {!soRotulo && !(m.canal === 'email' && m.origem === 'sequencia') && (
                <p className="bolha__texto">
                  <TextoComLinks texto={m.texto} />
                </p>
              )}
              {m.canal === 'email' && m.origem === 'sequencia' && m.nota && (
                <p className="bolha__texto quieto">Sequência “{m.nota}”</p>
              )}
              <span className="bolha__meta">
                {m.autor && <span>{m.autor}</span>}
                {m.status === 'rascunho' && (
                  <Badge tone="warning">esperando sua aprovação na tela Agente</Badge>
                )}
                {m.status === 'aprovada' && <Badge tone="neutral">na fila de envio</Badge>}
                {m.status === 'erro' && <Badge tone="danger">não enviada{m.erro ? `: ${m.erro}` : ''}</Badge>}
                {m.status === 'registrada' && <span title="Registrado à mão na ficha">registrado</span>}
                <span>{fmtHoraSo(m.em)}</span>
              </span>
            </div>
          </div>
        );
      })}
      <div ref={fim} />
    </div>
  );
}

/** Caixa de escrever: texto, "/" para respostas rápidas, anexo e áudio gravado. */
function Compositor(props: {
  conversa: ConversaAberta;
  aoEnviado: (c: ConversaAberta) => void;
  aoGerenciarRespostas: () => void;
}) {
  const { conversa } = props;
  // Canal: WhatsApp, ou e-mail (o lead respondeu por e-mail ou não tem WhatsApp).
  const ultimaDoLead = [...conversa.mensagens].reverse().find((m) => m.direcao === 'recebida');
  const [canal, setCanal] = useState<'whatsapp' | 'email'>(
    !conversa.telefone || ultimaDoLead?.canal === 'email' ? 'email' : 'whatsapp',
  );
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [escolhida, setEscolhida] = useState(0);
  const [gravando, setGravando] = useState<{ rec: MediaRecorder; inicio: number } | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const respostas = useQuery({
    queryKey: ['respostas-rapidas'],
    queryFn: () => api<RespostaRapida[]>('/conversas/respostas'),
    staleTime: 60_000,
  });

  const enviarTexto = useMutation({
    mutationFn: (t: string) =>
      api<ConversaAberta>(`/conversas/${conversa.empresaId}/mensagens`, {
        metodo: 'POST',
        corpo: { texto: t },
      }),
    onSuccess: (c) => {
      setTexto('');
      props.aoEnviado(c);
    },
  });
  const enviarEmail = useMutation({
    mutationFn: (t: string) =>
      api<ConversaAberta>(`/conversas/${conversa.empresaId}/email`, {
        metodo: 'POST',
        corpo: { texto: t, assunto: assunto.trim() || undefined },
      }),
    onSuccess: (c) => {
      setTexto('');
      setAssunto('');
      props.aoEnviado(c);
    },
  });
  const enviarMidia = useMutation({
    mutationFn: (m: { tipo: TipoMidia; mime: string; nome?: string; base64: string; legenda?: string }) =>
      api<ConversaAberta>(`/conversas/${conversa.empresaId}/midia`, { metodo: 'POST', corpo: m }),
    onSuccess: (c) => {
      setTexto('');
      props.aoEnviado(c);
    },
  });

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - gravando.inicio) / 1000)), 500);
    return () => clearInterval(t);
  }, [gravando]);

  // "/preco" no começo abre a lista das respostas rápidas.
  const filtro = texto.startsWith('/') && !texto.includes(' ') ? texto.slice(1).toLowerCase() : null;
  const sugestoes = useMemo(
    () =>
      filtro === null ? [] : (respostas.data ?? []).filter((r) => r.atalho.includes(filtro)).slice(0, 6),
    [filtro, respostas.data],
  );
  const usar = (r: RespostaRapida) => {
    setTexto(aplicarVariaveis(r.texto, conversa.variaveis));
    setEscolhida(0);
    campo.current?.focus();
  };

  const enviar = (e?: FormEvent) => {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviarTexto.isPending || enviarEmail.isPending) return;
    if (canal === 'email') enviarEmail.mutate(t);
    else enviarTexto.mutate(t);
  };

  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugestoes.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setEscolhida((i) => (i + (e.key === 'ArrowDown' ? 1 : sugestoes.length - 1)) % sugestoes.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const r = sugestoes[escolhida];
        if (r) usar(r);
        return;
      }
      if (e.key === 'Escape') {
        setTexto('');
        return;
      }
    }
    // No e-mail, Enter quebra a linha (texto mais longo); Ctrl+Enter envia.
    if (e.key === 'Enter' && (canal === 'email' ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
      e.preventDefault();
      enviar();
    }
  };

  const anexar = async (f: File | undefined) => {
    setErroLocal(null);
    if (!f) return;
    if (f.size > LIMITE) {
      setErroLocal('Arquivo grande demais: até 10 MB.');
      return;
    }
    const mime = f.type || 'application/octet-stream';
    enviarMidia.mutate({
      tipo: tipoDoArquivo(mime),
      mime,
      nome: f.name,
      base64: await lerBase64(f),
      legenda: texto.trim() || undefined,
    });
  };

  const gravar = async () => {
    setErroLocal(null);
    if (gravando) {
      gravando.rec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const partes: Blob[] = [];
      rec.ondataavailable = (ev) => partes.push(ev.data);
      rec.onstop = async () => {
        for (const t of stream.getTracks()) t.stop();
        setGravando(null);
        setSegundos(0);
        const blob = new Blob(partes, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1500) return; // clique sem querer
        enviarMidia.mutate({ tipo: 'audio', mime: blob.type.split(';')[0]!, base64: await lerBase64(blob) });
      };
      rec.start();
      setGravando({ rec, inicio: Date.now() });
    } catch {
      setErroLocal('Não consegui usar o microfone. Libere o acesso ao microfone no navegador.');
    }
  };

  const ocupado = enviarTexto.isPending || enviarMidia.isPending || enviarEmail.isPending;
  if (!conversa.telefone && !conversa.email)
    return <Mensagem tipo="aviso">Este lead não tem WhatsApp nem e-mail.</Mensagem>;
  const porEmail = canal === 'email';

  return (
    <form className="compositor" onSubmit={enviar} data-canal={canal}>
      {conversa.telefone && conversa.email && (
        <fieldset className="segmentos segmentos--mini compositor__canal" aria-label="Responder por">
          {(
            [
              ['whatsapp', 'message-circle', 'WhatsApp'],
              ['email', 'mail', 'E-mail'],
            ] as const
          ).map(([id, icone, rotulo]) => (
            <button
              key={id}
              type="button"
              className="segmento"
              aria-pressed={canal === id}
              data-ativo={canal === id || undefined}
              onClick={() => setCanal(id)}
            >
              <Icon name={icone} size={12} /> {rotulo}
            </button>
          ))}
        </fieldset>
      )}
      {porEmail && (
        <div className="compositor__email">
          <span className="quieto">
            Para <b>{conversa.email}</b>
            {conversa.emailEmConversa ? ' · resposta na mesma conversa do e-mail dele' : ''}
          </span>
          {!conversa.emailEmConversa && (
            <>
              <label className="pp-sr" htmlFor="compositor-assunto">
                Assunto
              </label>
              <input
                id="compositor-assunto"
                className="filtro"
                placeholder={`Assunto (em branco: Contato · ${conversa.nome})`}
                maxLength={200}
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
              />
            </>
          )}
        </div>
      )}
      {sugestoes.length > 0 && (
        <ul className="sugestoes" aria-label="Respostas rápidas">
          {sugestoes.map((r, i) => (
            <li key={r.id} data-escolhida={i === escolhida || undefined}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => usar(r)}>
                <b>/{r.atalho}</b>{' '}
                <span className="quieto">{aplicarVariaveis(r.texto, conversa.variaveis)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtro !== null && !sugestoes.length && respostas.data && (
        <div className="sugestoes sugestoes--vazia">
          Nenhuma resposta rápida com “{filtro}”.{' '}
          <button type="button" className="link-botao" onClick={props.aoGerenciarRespostas}>
            Criar
          </button>
        </div>
      )}
      <ErroDaApi erro={enviarTexto.error ?? enviarMidia.error ?? enviarEmail.error} />
      {erroLocal && <Mensagem tipo="erro">{erroLocal}</Mensagem>}
      <div className="compositor__linha">
        <input
          ref={arquivo}
          type="file"
          hidden
          accept="image/*,application/pdf,audio/*,video/*,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => {
            void anexar(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="botao-icone"
          title={
            porEmail
              ? 'Anexo só pelo WhatsApp (no e-mail, use os modelos)'
              : 'Anexar foto ou arquivo (até 10 MB)'
          }
          aria-label="Anexar arquivo"
          disabled={ocupado || !!gravando || porEmail}
          onClick={() => arquivo.current?.click()}
        >
          <Icon name="paperclip" size={18} />
        </button>
        {gravando ? (
          <div className="compositor__gravando" role="status">
            <span className="vivo" aria-hidden="true" /> Gravando {Math.floor(segundos / 60)}:
            {String(segundos % 60).padStart(2, '0')}
          </div>
        ) : (
          <>
            <label className="pp-sr" htmlFor="compositor-texto">
              Mensagem
            </label>
            <textarea
              id="compositor-texto"
              ref={campo}
              rows={porEmail ? 4 : 1}
              className="compositor__texto"
              placeholder={
                porEmail
                  ? 'Escreva o e-mail… (Ctrl+Enter envia; a assinatura da sua identidade visual vai junto)'
                  : 'Escreva… ( / para respostas rápidas, Shift+Enter quebra a linha)'
              }
              value={texto}
              maxLength={4000}
              onChange={(e) => {
                setTexto(e.target.value);
                setEscolhida(0);
              }}
              onKeyDown={tecla}
            />
          </>
        )}
        {(texto.trim() || porEmail) && !gravando ? (
          <button
            type="submit"
            className="botao-enviar"
            aria-label="Enviar"
            title={porEmail ? 'Enviar e-mail (Ctrl+Enter)' : 'Enviar (Enter)'}
            disabled={ocupado || !texto.trim()}
          >
            <Icon name={ocupado ? 'loader' : 'send'} size={18} spin={ocupado} />
          </button>
        ) : (
          <button
            type="button"
            className="botao-enviar"
            data-gravando={gravando ? true : undefined}
            aria-label={gravando ? 'Parar e enviar o áudio' : 'Gravar áudio'}
            title={gravando ? 'Parar e enviar' : 'Gravar áudio'}
            disabled={ocupado && !gravando}
            onClick={() => void gravar()}
          >
            <Icon
              name={gravando ? 'square' : ocupado ? 'loader' : 'mic'}
              size={18}
              spin={ocupado && !gravando}
            />
          </button>
        )}
      </div>
    </form>
  );
}

function RespostasRapidas(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['respostas-rapidas'],
    queryFn: () => api<RespostaRapida[]>('/conversas/respostas'),
  });
  const [edit, setEdit] = useState<{ id?: number; atalho: string; texto: string }>({ atalho: '', texto: '' });
  const salvar = useMutation({
    mutationFn: () =>
      edit.id
        ? api<RespostaRapida[]>(`/conversas/respostas/${edit.id}`, {
            metodo: 'PUT',
            corpo: { atalho: edit.atalho, texto: edit.texto },
          })
        : api<RespostaRapida[]>('/conversas/respostas', {
            metodo: 'POST',
            corpo: { atalho: edit.atalho, texto: edit.texto },
          }),
    onSuccess: (d) => {
      cliente.setQueryData(['respostas-rapidas'], d);
      setEdit({ atalho: '', texto: '' });
    },
  });
  const apagar = useMutation({
    mutationFn: (id: number) => api<RespostaRapida[]>(`/conversas/respostas/${id}`, { metodo: 'DELETE' }),
    onSuccess: (d) => cliente.setQueryData(['respostas-rapidas'], d),
  });
  return (
    <Drawer titulo="Respostas rápidas" barra="Conversas" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <div className="pilha" style={{ gap: 16 }}>
          <p className="quieto" style={{ margin: 0 }}>
            Na conversa, digite <b>/</b> e o atalho (ex.: /preco). Use {'{saudacao}'}, {'{nome}'},{' '}
            {'{empresa}'}, {'{cidade}'} e {'{remetente}'}.
          </p>
          <ul className="lista-simples">
            {q.data?.map((r) => (
              <li key={r.id} className="resposta-rapida">
                <div>
                  <b className="mono">/{r.atalho}</b>
                  <p className="quieto" style={{ margin: '2px 0 0' }}>
                    {r.texto}
                  </p>
                </div>
                <div className="acoes">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => apagar.mutate(r.id)}>
                    Apagar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <h3 className="subtitulo">{edit.id ? `Editar /${edit.atalho}` : 'Nova resposta'}</h3>
            <div className="campo">
              <label htmlFor="rr-atalho">Atalho</label>
              <input
                id="rr-atalho"
                className="filtro mono"
                placeholder="ex.: tabela"
                maxLength={30}
                value={edit.atalho}
                onChange={(e) =>
                  setEdit({ ...edit, atalho: e.target.value.replace(/\s/g, '').toLowerCase() })
                }
              />
            </div>
            <div className="campo">
              <label htmlFor="rr-texto">Texto</label>
              <textarea
                id="rr-texto"
                rows={4}
                maxLength={2000}
                value={edit.texto}
                onChange={(e) => setEdit({ ...edit, texto: e.target.value })}
              />
            </div>
            <ErroDaApi erro={salvar.error} />
            <div className="acoes">
              <Button
                type="submit"
                variant="primary"
                disabled={!edit.atalho || !edit.texto.trim() || salvar.isPending}
              >
                {edit.id ? 'Salvar' : 'Adicionar'}
              </Button>
              {edit.id && (
                <Button variant="ghost" onClick={() => setEdit({ atalho: '', texto: '' })}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </Drawer>
  );
}

function Conversa(props: {
  empresaId: number;
  abrirPessoas?: boolean;
  aoVoltar: () => void;
  aoAbrirFicha: () => void;
}) {
  const cliente = useQueryClient();
  const [marcando, setMarcando] = useState(false);
  const [respostas, setRespostas] = useState(false);
  const [pessoas, setPessoas] = useState<{ editar: ContatoLead | null } | null>(
    props.abrirPessoas ? { editar: null } : null,
  );
  const chave = ['conversa', props.empresaId];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<ConversaAberta>(`/conversas/${props.empresaId}`),
    refetchInterval: 5_000,
  });
  // Abriu: a conversa sai de "não lidas" e o aviso some.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando muda a conversa ou chega mensagem
  useEffect(() => {
    if (!q.data) return;
    cliente.invalidateQueries({ queryKey: ['conversas'] });
    cliente.invalidateQueries({ queryKey: ['notificacoes'] });
  }, [props.empresaId, q.data?.mensagens.length]);

  const devolver = useMutation({
    mutationFn: () => api(`/funil/${props.empresaId}`, { metodo: 'PATCH', corpo: { devolverParaIa: true } }),
    onSuccess: () => q.refetch(),
  });

  if (q.isPending)
    return (
      <div className="chat">
        <div className="esqueleto" />
      </div>
    );
  if (q.error)
    return (
      <div className="chat">
        <ErroDaApi erro={q.error} />
      </div>
    );
  const c = q.data;
  const atualizar = (nova: ConversaAberta) => {
    cliente.setQueryData(chave, nova);
    cliente.invalidateQueries({ queryKey: ['conversas'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
    cliente.invalidateQueries({ queryKey: ['contatos-lead', props.empresaId] });
  };
  const confirmados = c.contatos.filter((x) => x.status === 'confirmado').length;
  const numeros = new Set(
    c.mensagens.filter((m) => m.canal === 'whatsapp' && m.telefone).map((m) => m.telefone!.slice(-8)),
  );
  const variasPessoas = numeros.size > 1 || c.mensagens.some((m) => m.contatoId);
  return (
    <div className="chat">
      <header className="chat__topo">
        <button
          type="button"
          className="botao-icone chat__voltar"
          aria-label="Voltar para a lista"
          onClick={props.aoVoltar}
        >
          <Icon name="arrow-right" size={18} className="girar-180" />
        </button>
        <div className="chat__quem">
          <button type="button" className="link-botao chat__nome" onClick={props.aoAbrirFicha}>
            {fmtNome(c.nome)}
          </button>
          <span className="chat__sub">
            <span
              className="ponto-etapa"
              style={{ background: c.etapaCor ?? '#94a3b8' }}
              aria-hidden="true"
            />
            {c.etapaNome ?? c.etapa}
            {c.cidade && ` · ${fmtCidade(c.cidade)}`}
            {c.telefone && <span className="mono"> · {formatarTelefone(c.telefone)}</span>}
          </span>
          <EnviarPara
            empresaId={c.empresaId}
            telefone={c.telefone}
            opcoes={c.opcoesEnvio}
            aoMudar={atualizar}
          />
        </div>
        <Dono id={c.responsavelId} nome={c.responsavelNome} tamanho={26} />
        <div className="acoes">
          <Button size="sm" variant="ghost" icon="users" onClick={() => setPessoas({ editar: null })}>
            Pessoas{confirmados ? ` (${confirmados})` : ''}
          </Button>
          <Button size="sm" variant="ghost" icon="calendar-plus" onClick={() => setMarcando(true)}>
            Marcar reunião
          </Button>
          <Button size="sm" variant="ghost" icon="id-card" onClick={props.aoAbrirFicha}>
            Ficha
          </Button>
          <Button size="sm" variant="ghost" icon="sticky-note" onClick={() => setRespostas(true)}>
            Respostas rápidas
          </Button>
        </div>
      </header>
      {c.agente && (
        <div className="chat__ia">
          <Icon name="bot" size={14} />
          {c.agentePausa ? (
            <>
              <span>A IA está pausada neste lead: {c.agentePausa}</span>
              <button
                type="button"
                className="link-botao"
                disabled={devolver.isPending}
                onClick={() => devolver.mutate()}
              >
                Devolver para a IA
              </button>
            </>
          ) : (
            <span>
              A IA está conduzindo esta conversa. Se você responder, ela para e o lead fica com você.
            </span>
          )}
        </div>
      )}
      <FaixaIndicacoes conversa={c} aoRevisar={(x) => setPessoas({ editar: x })} aoMudar={atualizar} />
      {c.mensagens.length ? (
        <Bolhas mensagens={c.mensagens} variasPessoas={variasPessoas} />
      ) : (
        <div className="bolhas">
          <EmptyState
            icone="message-circle"
            titulo="Nenhuma mensagem ainda"
            texto="Mande a primeira mensagem por aqui."
          />
        </div>
      )}
      <Compositor
        conversa={c}
        aoEnviado={(nova) => {
          cliente.setQueryData(chave, nova);
          cliente.invalidateQueries({ queryKey: ['conversas'] });
          cliente.invalidateQueries({ queryKey: ['quadro'] });
        }}
        aoGerenciarRespostas={() => setRespostas(true)}
      />
      {marcando && (
        <FormTarefa
          empresaId={c.empresaId}
          empresaNome={c.nome}
          tipoInicial="reuniao"
          aoFechar={() => setMarcando(false)}
        />
      )}
      {respostas && <RespostasRapidas aoFechar={() => setRespostas(false)} />}
      {pessoas && (
        <PainelContatos
          conversa={c}
          editarInicial={pessoas.editar}
          aoMudar={atualizar}
          aoFechar={() => setPessoas(null)}
        />
      )}
    </div>
  );
}

export function Conversas() {
  const [params, setParams] = useSearchParams();
  const filtro =
    (params.get('filtro') as 'todas' | 'nao_lidas' | 'minhas' | 'nao_identificados' | null) ?? 'todas';
  const soltos = filtro === 'nao_identificados';
  const lead = Number(params.get('lead')) || null;
  const numero = params.get('numero');
  const naoIdentificados = useNaoIdentificados();
  const totalSoltos = naoIdentificados.data?.length ?? 0;
  const ficha = params.get('empresa');
  const [busca, setBusca] = useState('');
  const [buscaFeita, setBuscaFeita] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBuscaFeita(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const lista = useQuery({
    queryKey: ['conversas', filtro, buscaFeita],
    queryFn: () =>
      api<ConversaResumo[]>(
        `/conversas?filtro=${filtro}${buscaFeita ? `&busca=${encodeURIComponent(buscaFeita)}` : ''}`,
      ),
    enabled: !soltos,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const FILTROS: { id: typeof filtro; rotulo: string }[] = [
    { id: 'todas', rotulo: 'Todas' },
    { id: 'nao_lidas', rotulo: 'Não lidas' },
    { id: 'minhas', rotulo: 'Meus leads' },
    ...(totalSoltos || soltos
      ? [{ id: 'nao_identificados' as const, rotulo: `Sem lead${totalSoltos ? ` (${totalSoltos})` : ''}` }]
      : []),
  ];
  const aberta = soltos ? !!numero : !!lead;

  return (
    <>
      <div className="inbox" data-aberta={aberta || undefined}>
        <aside className="inbox__lista" aria-label="Conversas">
          <div className="inbox__cabeca">
            <h1>Conversas</h1>
            <div className="segmentos" role="tablist" aria-label="Filtro">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filtro === f.id}
                  className="segmento"
                  data-ativo={filtro === f.id || undefined}
                  title={
                    f.id === 'nao_identificados'
                      ? 'Mensagens de números que não são de nenhum lead (ex.: a pessoa indicada que escreveu primeiro)'
                      : undefined
                  }
                  onClick={() => mudar({ filtro: f.id === 'todas' ? null : f.id, lead: null, numero: null })}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            {!soltos && (
              <>
                <label className="pp-sr" htmlFor="conversas-busca">
                  Buscar conversa
                </label>
                <input
                  id="conversas-busca"
                  className="filtro"
                  placeholder="Buscar por empresa, pessoa ou telefone"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </>
            )}
          </div>
          <ErroDaApi erro={lista.error} />
          {soltos ? (
            <ListaNaoIdentificados ativo={numero} aoAbrir={(t) => mudar({ numero: t })} />
          ) : lista.isPending ? (
            <div className="esqueleto" />
          ) : !lista.data?.length ? (
            <p className="quieto inbox__vazia">
              {filtro === 'nao_lidas'
                ? 'Nenhuma conversa esperando resposta.'
                : buscaFeita
                  ? 'Nenhuma conversa com essa busca.'
                  : 'As conversas de WhatsApp com os leads do funil aparecem aqui: as que a IA conduz, as que você manda e as respostas que chegam.'}
            </p>
          ) : (
            <ul className="conversas">
              {lista.data.map((c) => (
                <ItemLista
                  key={c.empresaId}
                  c={c}
                  ativo={c.empresaId === lead}
                  aoAbrir={() => mudar({ lead: String(c.empresaId) })}
                />
              ))}
            </ul>
          )}
        </aside>
        <section className="inbox__chat">
          {soltos && numero ? (
            <PainelNaoIdentificado
              key={numero}
              telefone={numero}
              aoVoltar={() => mudar({ numero: null })}
              aoVinculado={(id) => mudar({ filtro: null, numero: null, lead: String(id) })}
            />
          ) : soltos ? (
            <div className="chat chat--vazio">
              <EmptyState
                icone="inbox"
                titulo="Mensagens sem lead"
                texto="Escolha um número para ver as mensagens e vincular a um lead. Ele vira um contato da negociação e a conversa continua no mesmo card."
              />
            </div>
          ) : lead ? (
            <Conversa
              key={lead}
              empresaId={lead}
              abrirPessoas={params.get('pessoas') === '1'}
              aoVoltar={() => mudar({ lead: null })}
              aoAbrirFicha={() => mudar({ empresa: String(lead) })}
            />
          ) : (
            <div className="chat chat--vazio">
              <EmptyState
                icone="message-circle"
                titulo="Escolha uma conversa"
                texto="Responda os leads sem sair do CRM: texto, foto, PDF ou áudio, com respostas rápidas."
              />
            </div>
          )}
        </section>
      </div>
      {ficha && (
        <FichaEmpresa
          id={Number(ficha)}
          aoFechar={() => mudar({ empresa: null })}
          aoAbrir={(id) => mudar({ empresa: String(id) })}
        />
      )}
    </>
  );
}
