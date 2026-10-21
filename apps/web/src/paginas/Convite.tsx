import { Button, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { TelaAcesso } from '../componentes/Marca';

/** Link do convite: a pessoa cria a senha e já entra. */
export function Convite() {
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const convite = useQuery({
    queryKey: ['convite', token],
    queryFn: () =>
      api<{ nome: string; email: string; conta?: string }>(`/auth/convite/${encodeURIComponent(token)}`),
    retry: false,
  });
  const criar = useMutation({
    mutationFn: () => api(`/auth/convite/${encodeURIComponent(token)}`, { metodo: 'POST', corpo: { senha } }),
    onSuccess: () => {
      cliente.clear();
      navegar('/hoje', { replace: true });
    },
  });
  const diferentes = !!repetir && senha !== repetir;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!diferentes) criar.mutate();
  };

  return (
    <TelaAcesso>
      <form className="login__caixa" onSubmit={enviar} noValidate>
        {convite.isPending ? (
          <div className="esqueleto" />
        ) : convite.error ? (
          <>
            <h1>Link inválido</h1>
            <Mensagem tipo="aviso">
              Este convite expirou ou já foi usado. Peça um link novo para quem administra o sistema.
            </Mensagem>
            <Button onClick={() => navegar('/login')}>Ir para o login</Button>
          </>
        ) : (
          <>
            <div>
              <h1>Olá, {convite.data.nome.split(' ')[0]}!</h1>
              <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
                Crie sua senha para entrar no Prospect Team
                {convite.data.conta ? ` da ${convite.data.conta}` : ''} com {convite.data.email}.
              </p>
            </div>
            <TextField
              rotulo="Senha"
              type="password"
              autoComplete="new-password"
              dica="Pelo menos 8 caracteres, com letras e números."
              value={senha}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
            />
            <TextField
              rotulo="Repita a senha"
              type="password"
              autoComplete="new-password"
              erro={diferentes ? 'As senhas não são iguais.' : undefined}
              value={repetir}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepetir(e.target.value)}
            />
            <ErroDaApi erro={criar.error} />
            <Button variant="primary" type="submit" disabled={criar.isPending || !senha || senha !== repetir}>
              {criar.isPending ? 'Entrando…' : 'Criar senha e entrar'}
            </Button>
          </>
        )}
      </form>
    </TelaAcesso>
  );
}
