import { Icon } from '@prospeccao/ui';
import { type ReactNode, useState } from 'react';
import { ErroApi } from '../api';

export function Mensagem(props: { tipo: 'erro' | 'aviso' | 'ok'; children: ReactNode }) {
  const icone = props.tipo === 'erro' ? 'circle-x' : props.tipo === 'aviso' ? 'circle-help' : 'check';
  return (
    <div className={`mensagem mensagem--${props.tipo}`} role={props.tipo === 'erro' ? 'alert' : 'status'}>
      <Icon name={icone} size={16} />
      <span>{props.children}</span>
    </div>
  );
}

/** Erro de API com a lista de campos inválidos, quando houver. */
export function ErroDaApi({ erro }: { erro: unknown }) {
  if (!erro) return null;
  if (erro instanceof ErroApi) {
    return (
      <Mensagem tipo="erro">
        {erro.message}
        {erro.detalhes && erro.detalhes.length > 1 && (
          <>
            {' '}
            {erro.detalhes
              .slice(1)
              .map((d) => d.mensagem)
              .join(' ')}
          </>
        )}
      </Mensagem>
    );
  }
  return <Mensagem tipo="erro">Algo deu errado. Tente de novo.</Mensagem>;
}

/** Lista de textos editada como "um por linha". */
export function CampoLista(props: {
  id: string;
  rotulo: string;
  valor: string[];
  aoMudar: (v: string[]) => void;
  dica?: string;
  exemplo?: string;
}) {
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <textarea
        id={props.id}
        value={props.valor.join('\n')}
        placeholder={props.exemplo}
        aria-describedby={props.dica ? `${props.id}-dica` : undefined}
        onChange={(e) => props.aoMudar(e.target.value.split('\n').map((l) => l.trimStart()))}
        onBlur={(e) =>
          props.aoMudar(
            e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
          )
        }
      />
      {props.dica && (
        <span id={`${props.id}-dica`} className="campo__dica">
          {props.dica}
        </span>
      )}
    </div>
  );
}

export function limparLista(itens: string[]): string[] {
  return itens.map((i) => i.trim()).filter(Boolean);
}

/**
 * Lista de textos em etiquetas: digita e tecla Enter (ou vírgula) para incluir, clica no × para
 * tirar. As sugestões que ainda não estão na lista aparecem embaixo e entram com um clique.
 */
export function CampoEtiquetas(props: {
  id: string;
  rotulo: string;
  valor: string[];
  aoMudar: (v: string[]) => void;
  sugestoes?: string[];
  dica?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  /** Ajusta o texto antes de incluir (ex.: formatar CNAE). */
  normalizar?: (t: string) => string;
}) {
  const [texto, setTexto] = useState('');
  const incluir = (bruto: string) => {
    const novos = bruto
      .split(/[,;\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (props.normalizar ? props.normalizar(t) : t));
    const atuais = new Set(props.valor.map((v) => v.toLowerCase()));
    const juntar = novos.filter((n) => !atuais.has(n.toLowerCase()));
    if (juntar.length) props.aoMudar([...props.valor, ...juntar]);
    setTexto('');
  };
  const presentes = new Set(props.valor.map((v) => v.toLowerCase()));
  const sugestoes = (props.sugestoes ?? []).filter((s) => !presentes.has(s.toLowerCase()));

  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className="tags-campo">
        {props.valor.map((v) => (
          <span key={v} className={props.mono ? 'tag-campo tag-campo--mono' : 'tag-campo'}>
            {v}
            <button
              type="button"
              className="tag-campo__tirar"
              aria-label={`Tirar ${v}`}
              onClick={() => props.aoMudar(props.valor.filter((x) => x !== v))}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          id={props.id}
          className="tags-campo__entrada"
          value={texto}
          placeholder={props.valor.length ? 'Adicionar…' : props.placeholder}
          aria-describedby={props.dica ? `${props.id}-dica` : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) incluir(v);
            else setTexto(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              incluir(texto);
            } else if (e.key === 'Backspace' && !texto && props.valor.length) {
              props.aoMudar(props.valor.slice(0, -1));
            }
          }}
          onBlur={() => texto.trim() && incluir(texto)}
        />
      </div>
      {sugestoes.length > 0 && (
        <div className="tags-campo__sugestoes">
          <span className="quieto">Sugestões:</span>
          {sugestoes.map((s) => (
            <button key={s} type="button" className="tag-sugestao" onClick={() => incluir(s)}>
              <Icon name="plus" size={12} />
              {s}
            </button>
          ))}
        </div>
      )}
      {props.dica && (
        <span id={`${props.id}-dica`} className="campo__dica">
          {props.dica}
        </span>
      )}
    </div>
  );
}
