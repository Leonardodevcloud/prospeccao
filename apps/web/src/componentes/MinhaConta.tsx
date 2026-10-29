import { Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ROTULO_PAPEL_QUALQUER, ROTULO_PAPEL_USUARIO } from '../api';
import { formatarTelefone } from '../formatar';
import { DuasEtapas, LINK_PRIVACIDADE, LINK_TERMOS, SessoesAbertas } from './ContaSegura';
import { Drawer } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { NotificacoesCelular } from './NotificacoesCelular';
import { useSessao } from './Sessao';

/** Endereço da agenda para o Google Agenda assinar (passa pelo /api do próprio site). */
export function linkDaAgenda(token: string): string {
  return `${location.origin}/api/calendario/${token}.ics`;
}

/** Ligar a agenda ao Google Agenda: copiar o link e onde colar. */
export function ConectarGoogle(props: { token: string }) {
  const [copiado, setCopiado] = useState(false);
  const link = linkDaAgenda(props.token);
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <div className="copiar">
        <input
          className="filtro mono"
          readOnly
          value={link}
          aria-label="Link da sua agenda"
          onFocus={(e) => e.target.select()}
        />
        <Button
          icon={copiado ? 'check' : 'copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar link'}
        </Button>
      </div>
      <ol className="passos-curtos">
        <li>
          No computador, abra o{' '}
          <a
            href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
            target="_blank"
            rel="noreferrer"
          >
            Google Agenda → Adicionar agenda → Do URL
          </a>
          .
        </li>
        <li>Cole o link e clique em "Adicionar agenda". Pronto: aparece no celular também.</li>
      </ol>
      <span className="campo__dica">
        O Google atualiza agendas assinadas de tempos em tempos (pode levar algumas horas). Para ver na hora,
        use o botão "Google Agenda" de cada reunião. Não compartilhe este link: quem tiver ele vê sua agenda.
      </span>
    </div>
  );
}

export function MinhaConta(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const sessao = useSessao();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  useEffect(() => {
    if (sessao.data) {
      setNome(sessao.data.nome);
      setTelefone(sessao.data.telefone ? formatarTelefone(sessao.data.telefone) : '');
    }
  }, [sessao.data]);

  const salvar = useMutation({
    mutationFn: () => api('/auth/eu', { metodo: 'PATCH', corpo: { nome, telefone } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      cliente.invalidateQueries({ queryKey: ['equipe'] });
    },
  });
  const senha = useMutation({
    mutationFn: () => api('/auth/senha', { metodo: 'POST', corpo: { atual, nova } }),
    onSuccess: () => {
      setAtual('');
      setNova('');
    },
  });

  const u = sessao.data;
  return (
    <Drawer titulo="Minha conta" barra="Minha conta" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {!u ? (
          <div className="esqueleto" />
        ) : (
          <div className="pilha" style={{ gap: 24 }}>
            <form
              className="form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                salvar.mutate();
              }}
            >
              <p className="quieto" style={{ margin: 0 }}>
                {u.email} ·{' '}
                {u.papelOrganizacao
                  ? ROTULO_PAPEL_QUALQUER[u.papelOrganizacao]
                  : ROTULO_PAPEL_USUARIO[u.papel]}
              </p>
              <div className="campo">
                <label htmlFor="conta-nome">Seu nome</label>
                <input
                  id="conta-nome"
                  className="filtro"
                  value={nome}
                  maxLength={80}
                  onChange={(e) => setNome(e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="conta-tel">Seu WhatsApp</label>
                <input
                  id="conta-tel"
                  className="filtro"
                  inputMode="tel"
                  placeholder="71 99999-0000"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                />
                <span className="campo__dica">
                  Para receber o aviso das suas reuniões, se o administrador ligar.
                </span>
              </div>
              <ErroDaApi erro={salvar.error} />
              {salvar.isSuccess && <Mensagem tipo="ok">Dados salvos.</Mensagem>}
              <div className="acoes">
                <Button type="submit" variant="primary" disabled={salvar.isPending}>
                  Salvar
                </Button>
              </div>
            </form>

            <section className="pilha" style={{ gap: 12 }}>
              <h3 className="subtitulo">Sua agenda no Google Agenda</h3>
              <ConectarGoogle token={u.agendaToken} />
            </section>

            <NotificacoesCelular />

            <DuasEtapas />

            <SessoesAbertas />

            <form
              className="form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                senha.mutate();
              }}
            >
              <h3 className="subtitulo">Trocar a senha</h3>
              <div className="campo">
                <label htmlFor="conta-atual">Senha atual</label>
                <input
                  id="conta-atual"
                  className="filtro"
                  type="password"
                  autoComplete="current-password"
                  value={atual}
                  onChange={(e) => setAtual(e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="conta-nova">Nova senha</label>
                <input
                  id="conta-nova"
                  className="filtro"
                  type="password"
                  autoComplete="new-password"
                  value={nova}
                  onChange={(e) => setNova(e.target.value)}
                />
                <span className="campo__dica">
                  Pelo menos 8 caracteres, com letras e números. Os outros aparelhos saem na hora.
                </span>
              </div>
              <ErroDaApi erro={senha.error} />
              {senha.isSuccess && <Mensagem tipo="ok">Senha trocada.</Mensagem>}
              <div className="acoes">
                <Button type="submit" disabled={!atual || !nova || senha.isPending}>
                  Trocar senha
                </Button>
              </div>
            </form>
            <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
              <a href={LINK_TERMOS} target="_blank" rel="noopener noreferrer">
                Termos de uso
              </a>{' '}
              ·{' '}
              <a href={LINK_PRIVACIDADE} target="_blank" rel="noopener noreferrer">
                Política de privacidade
              </a>
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
