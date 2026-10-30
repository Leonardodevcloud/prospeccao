import { LIMITE_ARQUIVO_SALA } from '@prospeccao/shared/reunioes';
import { Button, Icon } from '@prospeccao/ui';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { ErroApi } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { apiSala, type MensagemChat } from './api';

const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "1,2 MB", "820 KB". */
export function fmtTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

/**
 * Chat da sala: mensagens e arquivos (até 10 MB). Tudo fica guardado na reunião (e aparece na ficha
 * do lead depois); quem entra no meio vê o que já foi mandado.
 */
export function PainelChat(props: {
  codigo: string;
  credencial: string;
  participanteId: string;
  mensagens: MensagemChat[];
  aoEnviar: (m: MensagemChat) => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const fim = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  // Mensagem nova: rola para o fim.
  const total = props.mensagens.length;
  useEffect(() => {
    if (total) fim.current?.scrollIntoView({ block: 'end' });
  }, [total]);

  const mandar = async (corpo: object, rota: 'mensagens' | 'arquivos') => {
    setEnviando(true);
    setErro(null);
    try {
      const m = await apiSala<MensagemChat>(`/${props.codigo}/${rota}`, {
        metodo: 'POST',
        corpo,
        credencial: props.credencial,
      });
      props.aoEnviar(m);
      return true;
    } catch (e) {
      setErro(e);
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    if (await mandar({ texto: t }, 'mensagens')) setTexto('');
  };

  const anexar = async (e: ChangeEvent<HTMLInputElement>) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    if (a.size > LIMITE_ARQUIVO_SALA) {
      setErro(
        new ErroApi(0, 'arquivo_grande', 'O arquivo passa de 10 MB. Mande um link ou um arquivo menor.'),
      );
      return;
    }
    const base64 = await lerBase64(a);
    await mandar(
      { nome: a.name, mime: a.type || 'application/octet-stream', base64, texto: texto.trim() || undefined },
      'arquivos',
    );
    setTexto('');
  };

  return (
    <>
      <div className="painel-sala__lista" aria-live="polite">
        <p className="aviso-sala">As mensagens e os arquivos ficam guardados com a reunião.</p>
        {props.mensagens.map((m) => {
          const minha = m.participanteId === props.participanteId;
          return (
            <div key={m.id} className="msg" data-minha={minha || undefined}>
              <div className="msg__quem">
                <span>{minha ? 'Você' : m.autor}</span>
                <time dateTime={m.criadoEm}>{fmtHora.format(new Date(m.criadoEm))}</time>
              </div>
              {m.texto && <div className="msg__bolha">{m.texto}</div>}
              {m.arquivo && (
                <a className="msg__arquivo" href={m.arquivo.url} download={m.arquivo.nome}>
                  <span className="msg__arquivo-icone">
                    <Icon name={m.arquivo.mime.startsWith('image/') ? 'image' : 'file-text'} size={18} />
                  </span>
                  <span className="msg__arquivo-texto">
                    <b>{m.arquivo.nome}</b>
                    <span>{fmtTamanho(m.arquivo.tamanho)} · baixar</span>
                  </span>
                  <Icon name="download" size={18} />
                </a>
              )}
            </div>
          );
        })}
        <div ref={fim} />
      </div>
      <ErroDaApi erro={erro} />
      <form className="escrever" onSubmit={enviar}>
        <input
          ref={arquivo}
          type="file"
          className="pp-sr"
          tabIndex={-1}
          aria-hidden="true"
          onChange={anexar}
        />
        <button
          type="button"
          className="ico"
          aria-label="Anexar arquivo"
          title="Anexar arquivo (até 10 MB)"
          disabled={enviando}
          onClick={() => arquivo.current?.click()}
        >
          <Icon name="paperclip" size={20} />
        </button>
        <label className="pp-sr" htmlFor="chat-texto">
          Mensagem para todos na sala
        </label>
        <input
          id="chat-texto"
          type="text"
          placeholder="Escreva para todos"
          maxLength={2000}
          autoComplete="off"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          icon="send"
          aria-label="Mandar mensagem para todos"
          disabled={enviando || !texto.trim()}
        />
      </form>
    </>
  );
}
