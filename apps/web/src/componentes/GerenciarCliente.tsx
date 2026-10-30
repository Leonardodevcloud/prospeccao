import { Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from './Formulario';

/*
 * Gestão do cliente pelo master: ativar/desativar o cliente inteiro, excluir de vez e mudar o e-mail
 * de login ou definir a senha de alguém dele.
 */

/** Desativar ou reativar o cliente inteiro (todas as unidades) e, desativado, excluir. */
export function SituacaoCliente(props: {
  organizacaoId: number;
  nome: string;
  ativa: boolean;
  principal: boolean;
  aoExcluir?: () => void;
}) {
  const cliente = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const mudar = useMutation({
    mutationFn: (ativa: boolean) =>
      api(`/master/organizacoes/${props.organizacaoId}`, { metodo: 'PATCH', corpo: { ativa } }),
    onSuccess: () => {
      setConfirmar(false);
      cliente.invalidateQueries({ queryKey: ['master'] });
    },
  });
  if (props.principal) return null;
  return (
    <div className="pilha" style={{ gap: 12 }}>
      {props.ativa ? (
        confirmar ? (
          <div className="confirmar">
            <b>Desativar {props.nome}?</b>
            <span className="quieto">
              Ninguém do cliente consegue entrar (em nenhuma unidade) e os envios automáticos (e-mail,
              WhatsApp, agente) param. Os dados ficam guardados e dá para reativar depois.
            </span>
            <div className="acoes">
              <Button variant="danger" disabled={mudar.isPending} onClick={() => mudar.mutate(false)}>
                Desativar {props.nome}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmar(false)}>
                Manter ativo
              </Button>
            </div>
          </div>
        ) : (
          <div className="gerenciar-linha">
            <span>
              <b>Cliente ativo.</b> <span className="quieto">Para excluir, desative primeiro.</span>
            </span>
            <Button variant="secondary" onClick={() => setConfirmar(true)}>
              Desativar cliente
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="gerenciar-linha">
            <span>
              <b>Cliente desativado.</b>{' '}
              <span className="quieto">Ninguém dele consegue entrar; os dados estão guardados.</span>
            </span>
            <Button variant="primary" disabled={mudar.isPending} onClick={() => mudar.mutate(true)}>
              Reativar cliente
            </Button>
          </div>
          <ExcluirCliente organizacaoId={props.organizacaoId} nome={props.nome} aoExcluir={props.aoExcluir} />
        </>
      )}
      <ErroDaApi erro={mudar.error} />
    </div>
  );
}

/** Excluir de vez (só desativado): digitar o nome do cliente confirma. */
export function ExcluirCliente(props: { organizacaoId: number; nome: string; aoExcluir?: () => void }) {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  const confere = norm(texto) === norm(props.nome);
  const excluir = useMutation({
    mutationFn: () =>
      api(`/master/organizacoes/${props.organizacaoId}/excluir`, {
        metodo: 'POST',
        corpo: { confirmacao: texto },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['master'] });
      props.aoExcluir?.();
    },
  });
  if (!aberto)
    return (
      <div>
        <Button variant="ghost" icon="trash-2" onClick={() => setAberto(true)}>
          Excluir cliente
        </Button>
      </div>
    );
  return (
    // Não é <form>: pode aparecer dentro do formulário dos dados da conta.
    <div className="confirmar confirmar--perigo">
      <b>Excluir {props.nome} de vez?</b>
      <span>
        Saem todas as unidades, os usuários e tudo o que é deles: funil, conversas, campanhas, reuniões,
        visitas e configurações. <b>Não tem como desfazer.</b> As empresas pesquisadas continuam na base da
        plataforma.
      </span>
      <div className="campo">
        <label htmlFor={`excluir-${props.organizacaoId}`}>
          Para confirmar, digite o nome do cliente: <b>{props.nome}</b>
        </label>
        <input
          id={`excluir-${props.organizacaoId}`}
          className="filtro"
          autoComplete="off"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (confere && !excluir.isPending) excluir.mutate();
          }}
        />
      </div>
      <ErroDaApi erro={excluir.error} />
      <div className="acoes">
        <Button variant="danger" disabled={!confere || excluir.isPending} onClick={() => excluir.mutate()}>
          {excluir.isPending ? 'Excluindo…' : `Excluir ${props.nome}`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setAberto(false);
            setTexto('');
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Mudar o e-mail de login ou definir uma senha nova para alguém do cliente. */
export function AcessoUsuario(props: {
  usuario: { id: number; nome: string; email: string };
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const [email, setEmail] = useState(props.usuario.email);
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const mudouEmail = email.trim().toLowerCase() !== props.usuario.email.toLowerCase();
  const salvar = useMutation({
    mutationFn: () =>
      api(`/master/usuarios/${props.usuario.id}/acesso`, {
        metodo: 'PATCH',
        corpo: { ...(mudouEmail ? { email: email.trim() } : {}), ...(senha ? { senha } : {}) },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['master'] });
    },
  });
  const id = `acesso-${props.usuario.id}`;
  return (
    <form
      className="form caixa acesso-usuario"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <b>Acesso de {props.usuario.nome}</b>
      <div className="form__duas">
        <div className="campo">
          <label htmlFor={`${id}-email`}>E-mail de login</label>
          <input
            id={`${id}-email`}
            className="filtro"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor={`${id}-senha`}>Senha nova (opcional)</label>
          <div className="acesso-usuario__senha">
            <input
              id={`${id}-senha`}
              className="filtro"
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            <Button size="sm" variant="ghost" onClick={() => setVer(!ver)}>
              {ver ? 'Esconder' : 'Mostrar'}
            </Button>
          </div>
          <span className="campo__dica">
            Pelo menos 8 caracteres, com letras e números. Quem estiver conectado sai e entra com a nova.
          </span>
        </div>
      </div>
      {salvar.isSuccess && (
        <Mensagem tipo="ok">
          Pronto.{' '}
          {senha
            ? 'Passe a senha nova para a pessoa por um canal seguro; ela pode trocar depois em Minha conta.'
            : 'O login agora é com o e-mail novo.'}
        </Mensagem>
      )}
      <ErroDaApi erro={salvar.error} />
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending || (!mudouEmail && !senha)}>
          {salvar.isPending ? 'Salvando…' : 'Salvar acesso'}
        </Button>
        <Button variant="ghost" onClick={props.aoFechar}>
          Fechar
        </Button>
      </div>
    </form>
  );
}
