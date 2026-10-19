import { Icon } from '@prospeccao/ui';
import type { ReactNode } from 'react';
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
