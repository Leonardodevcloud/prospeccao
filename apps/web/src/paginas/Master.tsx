import { LISTA_MODULOS, MODULOS, type Modulo, PLANOS, type Plano } from '@prospeccao/shared/planos';
import { Badge, Button, EmptyState, Icon, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type CampoSegredo,
  type ConsumoConta,
  type ContaDetalhe,
  type ContaResumo,
  type CredenciaisTela,
  type ItemAuditoria,
  type OrigemCredencial,
  type PapelUsuario,
  type PlanoConta,
  type ProvedorIa,
  ROTULO_PAPEL_USUARIO,
  type ServicoTestavel,
} from '../api';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { FormPlano, ResumoPlano, ROTULO_PLANO } from '../componentes/PlanoConta';
import { useSessao } from '../componentes/Sessao';
import { fmtMes, fmtNumero, fmtQuando, fmtReais } from '../formatar';
import { LinkConvite } from './Equipe';

/* ───────────────────────── Peças ───────────────────────── */

const ROTULO_PROVEDOR: Record<ProvedorIa, string> = {
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  openai: 'Compatível com OpenAI (OpenRouter, Groq, Together…)',
};
const MODELO_SUGERIDO: Record<ProvedorIa, string> = {
  deepseek: 'deepseek-flash',
  gemini: 'gemini-3.5-flash-lite',
  openai: '',
};

function Origem(props: { origem: OrigemCredencial; detalhe?: string | null }) {
  if (props.origem === 'conta')
    return (
      <Badge tone="brand" icon="check">
        Da conta{props.detalhe ? ` · ${props.detalhe}` : ''}
      </Badge>
    );
  if (props.origem === 'plataforma')
    return <Badge tone="outline">Da plataforma{props.detalhe ? ` · ${props.detalhe}` : ''}</Badge>;
  return <Badge tone="warning">Não configurado</Badge>;
}

/** Campo de segredo: nunca mostra a chave guardada, só o final dela. Vazio = mantém a atual. */
function Segredo(props: {
  id: string;
  rotulo: string;
  dica?: ReactNode;
  guardado: string | null;
  valor: string | null | undefined;
  aoMudar: (v: string | null | undefined) => void;
  exemplo?: string;
}) {
  const apagando = props.valor === null;
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className="copiar">
        <input
          id={props.id}
          className="filtro mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={apagando}
          placeholder={
            apagando
              ? 'será apagada ao salvar'
              : props.guardado
                ? `guardada (${props.guardado})`
                : props.exemplo
          }
          value={props.valor ?? ''}
          onChange={(e) => props.aoMudar(e.target.value || undefined)}
        />
        {props.guardado &&
          (apagando ? (
            <Button size="sm" variant="ghost" onClick={() => props.aoMudar(undefined)}>
              Desfazer
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => props.aoMudar(null)}>
              Remover
            </Button>
          ))}
      </div>
      {props.dica && <span className="campo__dica">{props.dica}</span>}
    </div>
  );
}

function Copiavel(props: { id: string; rotulo: string; valor: string; dica?: ReactNode }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className="copiar">
        <input
          id={props.id}
          className="filtro mono"
          readOnly
          value={props.valor}
          onFocus={(e) => e.target.select()}
        />
        <Button
          size="sm"
          icon={copiado ? 'check' : 'copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(props.valor);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {props.dica && <span className="campo__dica">{props.dica}</span>}
    </div>
  );
}

/** Botão "Testar" de um serviço, com o resultado logo abaixo. */
function Testar(props: { contaId: number; servico: ServicoTestavel; mudou: boolean }) {
  const t = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; resultado: string }>(`/master/contas/${props.contaId}/testar`, {
        metodo: 'POST',
        corpo: { servico: props.servico },
      }),
  });
  return (
    <div className="credencial__teste">
      <Button
        size="sm"
        icon="check"
        disabled={t.isPending || props.mudou}
        title={props.mudou ? 'Salve antes de testar' : undefined}
        onClick={() => t.mutate()}
      >
        {t.isPending ? 'Testando…' : 'Testar'}
      </Button>
      {t.data && <Mensagem tipo={t.data.ok ? 'ok' : 'aviso'}>{t.data.resultado}</Mensagem>}
      <ErroDaApi erro={t.error} />
    </div>
  );
}

/* ───────────────────────── Credenciais da conta ───────────────────────── */

interface FormCredenciais {
  emailRemetente: string;
  resendDominioRespostas: string;
  evolutionUrl: string;
  evolutionInstancia: string;
  iaProvedor: ProvedorIa | '';
  iaModelo: string;
  iaBaseUrl: string;
}

function doServidor(c: CredenciaisTela): FormCredenciais {
  return {
    emailRemetente: c.emailRemetente ?? '',
    resendDominioRespostas: c.resendDominioRespostas ?? '',
    evolutionUrl: c.evolutionUrl ?? '',
    evolutionInstancia: c.evolutionInstancia ?? '',
    iaProvedor: c.iaProvedor ?? '',
    iaModelo: c.iaModelo ?? '',
    iaBaseUrl: c.iaBaseUrl ?? '',
  };
}

function Credenciais(props: { conta: ContaDetalhe }) {
  const cliente = useQueryClient();
  const c = props.conta.credenciais;
  const [f, setF] = useState<FormCredenciais>(() => doServidor(c));
  const [segredos, setSegredos] = useState<Partial<Record<CampoSegredo, string | null>>>({});
  useEffect(() => {
    setF(doServidor(c));
    setSegredos({});
  }, [c]);
  const original = doServidor(c);
  const mudou =
    (Object.keys(f) as (keyof FormCredenciais)[]).some((k) => f[k] !== original[k]) ||
    Object.values(segredos).some((v) => v !== undefined);

  const salvar = useMutation({
    mutationFn: () =>
      api<CredenciaisTela>(`/master/contas/${props.conta.id}/credenciais`, {
        metodo: 'PUT',
        corpo: {
          ...f,
          iaProvedor: f.iaProvedor || null,
          segredos: Object.fromEntries(Object.entries(segredos).filter(([, v]) => v !== undefined)),
        },
      }),
    onSuccess: (cred) => {
      cliente.setQueryData<ContaDetalhe>(['master', 'conta', props.conta.id], (x) =>
        x ? { ...x, credenciais: cred } : x,
      );
      cliente.invalidateQueries({ queryKey: ['master', 'contas'] });
      // A tela da própria conta (status do e-mail, agente) pode ter mudado.
      cliente.invalidateQueries({ queryKey: ['email'] });
      cliente.invalidateQueries({ queryKey: ['agente'] });
    },
  });
  const seg = (k: CampoSegredo) => ({
    guardado: c.segredos[k],
    valor: segredos[k],
    aoMudar: (v: string | null | undefined) => setSegredos((s) => ({ ...s, [k]: v })),
  });
  const principal = props.conta.principal;
  const provedor = (f.iaProvedor || 'deepseek') as ProvedorIa;

  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      {!c.podeGuardar && (
        <Mensagem tipo="aviso">
          O servidor está sem a variável CHAVE_CREDENCIAIS: sem ela não dá para guardar chaves com segurança.
          Coloque o mesmo valor (32 caracteres ou mais) na API e nos dois workers do Railway.
        </Mensagem>
      )}
      {c.erro && <Mensagem tipo="erro">{c.erro}</Mensagem>}
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Campos de chave em branco mantêm o que já está guardado.
        {principal
          ? ' Esta é a conta principal: o que ficar em branco usa as variáveis do Railway.'
          : ' A IA, se ficar em branco, usa a da plataforma (variáveis do Railway).'}
      </p>

      <fieldset className="credencial">
        <legend>
          <Icon name="mail" size={16} /> E-mail (Resend)
          <Origem origem={c.emUso.resend} detalhe={c.emUso.remetente} />
        </legend>
        <Segredo id="cr-resend" rotulo="Chave da API" exemplo="re_…" {...seg('resendKey')} />
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="cr-remetente">Remetente padrão</label>
            <input
              id="cr-remetente"
              className="filtro"
              type="email"
              placeholder="comercial@contato.empresa.com.br"
              value={f.emailRemetente}
              onChange={(e) => setF({ ...f, emailRemetente: e.target.value })}
            />
            <span className="campo__dica">De um domínio verificado no Resend desta conta.</span>
          </div>
          <div className="campo">
            <label htmlFor="cr-respostas">Domínio de respostas</label>
            <input
              id="cr-respostas"
              className="filtro"
              placeholder="respostas.empresa.com.br"
              value={f.resendDominioRespostas}
              onChange={(e) => setF({ ...f, resendDominioRespostas: e.target.value })}
            />
            <span className="campo__dica">O domínio de recebimento (Receiving) do Resend.</span>
          </div>
        </div>
        <Segredo
          id="cr-whsec"
          rotulo="Segredo do webhook"
          exemplo="whsec_…"
          dica="O “Signing secret” do webhook que você criou no Resend com o endereço abaixo."
          {...seg('resendWebhookSegredo')}
        />
        <Copiavel
          id="cr-webhook-resend"
          rotulo="Endereço do webhook (cole no Resend → Webhooks)"
          valor={props.conta.webhooks.resend}
          dica="Marque os eventos de e-mail: received, delivered, opened, clicked, bounced, complained, failed."
        />
        <Testar contaId={props.conta.id} servico="resend" mudou={mudou} />
      </fieldset>

      <fieldset className="credencial">
        <legend>
          <Icon name="message-circle" size={16} /> WhatsApp (Evolution)
          <Origem origem={c.emUso.evolution} />
        </legend>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="cr-evo-url">Endereço da Evolution</label>
            <input
              id="cr-evo-url"
              className="filtro"
              placeholder="https://evolution.empresa.com.br"
              value={f.evolutionUrl}
              onChange={(e) => setF({ ...f, evolutionUrl: e.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor="cr-evo-inst">Instância</label>
            <input
              id="cr-evo-inst"
              className="filtro"
              value={f.evolutionInstancia}
              onChange={(e) => setF({ ...f, evolutionInstancia: e.target.value })}
            />
            <span className="campo__dica">O chip desta conta (um número por conta).</span>
          </div>
        </div>
        <Segredo id="cr-evo-key" rotulo="Chave da API" {...seg('evolutionKey')} />
        {props.conta.webhooks.evolution && (
          <Copiavel
            id="cr-webhook-evo"
            rotulo="Webhook (cole na instância da Evolution)"
            valor={props.conta.webhooks.evolution}
            dica="Evento MESSAGES_UPSERT. É assim que o sistema sabe de qual conta é cada mensagem recebida."
          />
        )}
        <Testar contaId={props.conta.id} servico="evolution" mudou={mudou} />
      </fieldset>

      <fieldset className="credencial">
        <legend>
          <Icon name="bot" size={16} /> Inteligência artificial
          <Origem origem={c.emUso.ia} detalhe={c.emUso.iaModelo} />
        </legend>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="cr-ia-prov">Provedor</label>
            <select
              id="cr-ia-prov"
              className="filtro"
              value={f.iaProvedor}
              onChange={(e) => setF({ ...f, iaProvedor: e.target.value as ProvedorIa | '' })}
            >
              <option value="">{principal ? 'O das variáveis do Railway' : 'O da plataforma'}</option>
              {(Object.keys(ROTULO_PROVEDOR) as ProvedorIa[]).map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PROVEDOR[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="cr-ia-modelo">Modelo</label>
            <input
              id="cr-ia-modelo"
              className="filtro mono"
              placeholder={MODELO_SUGERIDO[provedor] || 'obrigatório'}
              value={f.iaModelo}
              onChange={(e) => setF({ ...f, iaModelo: e.target.value })}
            />
            <span className="campo__dica">Em branco: {MODELO_SUGERIDO[provedor] || 'informe o modelo'}.</span>
          </div>
        </div>
        {f.iaProvedor === 'openai' && (
          <div className="campo">
            <label htmlFor="cr-ia-url">Endereço da API</label>
            <input
              id="cr-ia-url"
              className="filtro mono"
              placeholder="https://openrouter.ai/api/v1"
              value={f.iaBaseUrl}
              onChange={(e) => setF({ ...f, iaBaseUrl: e.target.value })}
            />
          </div>
        )}
        {f.iaProvedor && <Segredo id="cr-ia-key" rotulo="Chave da API" {...seg('iaKey')} />}
        <span className="campo__dica">
          A IA lê as respostas, conversa no WhatsApp, avalia o lead e escreve a abertura de cada e-mail.
          DeepSeek custa uma fração do Gemini para esse trabalho.
        </span>
        <Testar contaId={props.conta.id} servico="ia" mudou={mudou} />
      </fieldset>

      <fieldset className="credencial">
        <legend>
          <Icon name="search" size={16} /> Google Places
          <Origem origem={c.emUso.places} />
        </legend>
        <Segredo
          id="cr-places"
          rotulo="Chave da API"
          exemplo="AIza…"
          dica="Busca de empresas no Maps. A franquia grátis e o teto de gasto valem por conta."
          {...seg('placesKey')}
        />
        <Testar contaId={props.conta.id} servico="places" mudou={mudou} />
      </fieldset>

      <fieldset className="credencial">
        <legend>
          <Icon name="map-pin" size={16} /> OpenRouteService
          <Origem origem={c.emUso.ors} />
        </legend>
        <Segredo
          id="cr-ors"
          rotulo="Chave da API"
          dica="Localiza as bases (endereços) da conta para medir a distância dos leads."
          {...seg('orsKey')}
        />
        <Testar contaId={props.conta.id} servico="ors" mudou={mudou} />
      </fieldset>

      <ErroDaApi erro={salvar.error} />
      {salvar.isSuccess && !mudou && <Mensagem tipo="ok">Credenciais salvas.</Mensagem>}
      <div className="acoes acoes--fixas">
        <Button type="submit" variant="primary" disabled={salvar.isPending || !mudou || !c.podeGuardar}>
          {salvar.isPending ? 'Salvando…' : 'Salvar credenciais'}
        </Button>
        {mudou && (
          <Button
            variant="ghost"
            onClick={() => {
              setF(original);
              setSegredos({});
            }}
          >
            Descartar mudanças
          </Button>
        )}
      </div>
    </form>
  );
}

/* ───────────────────────── Usuários da conta ───────────────────────── */

function Usuarios(props: { conta: ContaDetalhe }) {
  const cliente = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ nome: '', email: '', papel: 'admin' as PapelUsuario });
  const [link, setLink] = useState<{ link: string; nome: string; dias: number } | null>(null);
  const criar = useMutation({
    mutationFn: () =>
      api<{ convite: string; diasValidade: number }>(`/master/contas/${props.conta.id}/usuarios`, {
        metodo: 'POST',
        corpo: f,
      }),
    onSuccess: (d) => {
      setLink({ link: d.convite, nome: f.nome, dias: d.diasValidade });
      setF({ nome: '', email: '', papel: 'sdr' });
      setNovo(false);
      cliente.invalidateQueries({ queryKey: ['master'] });
    },
  });
  const editar = useMutation({
    mutationFn: (d: { id: number; papel?: PapelUsuario; ativo?: boolean }) =>
      api(`/master/usuarios/${d.id}`, { metodo: 'PATCH', corpo: { papel: d.papel, ativo: d.ativo } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master'] }),
  });
  const convite = useMutation({
    mutationFn: (u: { id: number; nome: string }) =>
      api<{ convite: string; diasValidade: number }>(`/master/usuarios/${u.id}/convite`, {
        metodo: 'POST',
      }).then((d) => ({ ...d, nome: u.nome })),
    onSuccess: (d) => setLink({ link: d.convite, nome: d.nome, dias: d.diasValidade }),
  });

  const plano = useQuery({
    queryKey: ['master', 'plano', props.conta.id],
    queryFn: () => api<PlanoConta>(`/master/contas/${props.conta.id}/plano`),
  });
  const p = plano.data;

  return (
    <div className="pilha" style={{ gap: 12 }}>
      {p?.usuarios != null && (
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          {p.uso.usuarios} de {p.usuarios} vagas do plano em uso
          {p.uso.usuarios >= p.usuarios
            ? '. Para convidar mais alguém, aumente o número de usuários na aba Plano e módulos.'
            : '.'}
        </p>
      )}
      {link && <LinkConvite link={link.link} nome={link.nome} dias={link.dias} conta={props.conta.nome} />}
      <ul className="usuarios-conta">
        {props.conta.usuarios.map((u) => (
          <li key={u.id} data-inativo={!u.ativo || undefined}>
            <span className="usuarios-conta__quem">
              <b>{u.nome}</b>
              <span className="quieto">{u.email}</span>
            </span>
            <span className="usuarios-conta__info">
              {(u.master || !u.ativo) && <Badge tone="outline">{ROTULO_PAPEL_USUARIO[u.papel]}</Badge>}
              {u.master && <Badge tone="brand">Master</Badge>}
              {!u.ativo && <Badge tone="neutral">Desativado</Badge>}
              {u.ativo && u.convitePendente && <Badge tone="warning">Convite pendente</Badge>}
              {u.ultimoAcesso && <span className="quieto">entrou {fmtQuando(u.ultimoAcesso)}</span>}
            </span>
            <span className="usuarios-conta__acoes">
              {!u.master && (
                <>
                  <label className="pp-sr" htmlFor={`mu-papel-${u.id}`}>
                    Papel de {u.nome}
                  </label>
                  <select
                    id={`mu-papel-${u.id}`}
                    className="filtro filtro--mini"
                    value={u.papel}
                    disabled={editar.isPending || !u.ativo}
                    onChange={(e) => editar.mutate({ id: u.id, papel: e.target.value as PapelUsuario })}
                  >
                    {(Object.keys(ROTULO_PAPEL_USUARIO) as PapelUsuario[]).map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {u.ativo && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="link"
                  disabled={convite.isPending}
                  onClick={() => convite.mutate(u)}
                >
                  {u.convitePendente ? 'Novo convite' : 'Link de nova senha'}
                </Button>
              )}
              {!u.master && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={editar.isPending}
                  onClick={() => editar.mutate({ id: u.id, ativo: !u.ativo })}
                >
                  {u.ativo ? 'Desativar' : 'Reativar'}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ErroDaApi erro={convite.error ?? editar.error} />
      {novo ? (
        <form
          className="form caixa"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="mu-nome">Nome</label>
              <input
                id="mu-nome"
                className="filtro"
                maxLength={80}
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="mu-email">E-mail</label>
              <input
                id="mu-email"
                className="filtro"
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </div>
          </div>
          <div className="campo">
            <label htmlFor="mu-papel">Papel</label>
            <select
              id="mu-papel"
              className="filtro"
              value={f.papel}
              onChange={(e) => setF({ ...f, papel: e.target.value as PapelUsuario })}
            >
              {(Object.keys(ROTULO_PAPEL_USUARIO) as PapelUsuario[]).map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL_USUARIO[p]}
                </option>
              ))}
            </select>
            <span className="campo__dica">
              O administrador da conta também convida pessoas pela tela Equipe.
            </span>
          </div>
          <ErroDaApi erro={criar.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={criar.isPending || !f.nome.trim() || !f.email.trim()}
            >
              Criar convite
            </Button>
            <Button variant="ghost" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" icon="user-plus" onClick={() => setNovo(true)}>
            Convidar pessoa
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Consumo e tetos ───────────────────────── */

const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`
    : n >= 1000
      ? `${Math.round(n / 1000)} mil`
      : String(n);

/** Barra de uso contra o teto (sem teto, só o número). */
function Uso(props: { rotulo: string; usado: number; teto: number | null; detalhe?: ReactNode }) {
  const pct = props.teto ? Math.min(100, Math.round((props.usado / Math.max(1, props.teto)) * 100)) : null;
  return (
    <div
      className="uso"
      data-cheio={pct != null && pct >= 100 ? true : undefined}
      data-alto={pct != null && pct >= 80 ? true : undefined}
    >
      <span className="uso__rotulo">{props.rotulo}</span>
      <b className="mono uso__numero">
        {fmtNumero(props.usado)}
        {props.teto != null && <span className="quieto"> / {fmtNumero(props.teto)}</span>}
      </b>
      {pct != null && (
        <span className="barra-uso" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {props.detalhe && <span className="quieto uso__detalhe">{props.detalhe}</span>}
    </div>
  );
}

/** Campo de teto: vazio = sem teto. */
function Teto(props: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  dica: string;
}) {
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <input
        id={props.id}
        className="filtro"
        inputMode="numeric"
        placeholder="sem teto"
        value={props.valor}
        onChange={(e) => props.aoMudar(e.target.value.replace(/\D/g, ''))}
      />
      <span className="campo__dica">{props.dica}</span>
    </div>
  );
}

function Consumo(props: { conta: ContaDetalhe }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'consumo', props.conta.id],
    queryFn: () => api<ConsumoConta>(`/master/contas/${props.conta.id}/consumo`),
  });
  const [f, setF] = useState({ usaIaPlataforma: true, iaMes: '', emailsMes: '', whatsappMes: '' });
  const l = q.data?.limites;
  useEffect(() => {
    if (l)
      setF({
        usaIaPlataforma: l.usaIaPlataforma,
        iaMes: l.iaMes == null ? '' : String(l.iaMes),
        emailsMes: l.emailsMes == null ? '' : String(l.emailsMes),
        whatsappMes: l.whatsappMes == null ? '' : String(l.whatsappMes),
      });
  }, [l]);
  const num = (v: string) => (v === '' ? null : Number(v));
  const mudou =
    !!l &&
    (f.usaIaPlataforma !== l.usaIaPlataforma ||
      num(f.iaMes) !== l.iaMes ||
      num(f.emailsMes) !== l.emailsMes ||
      num(f.whatsappMes) !== l.whatsappMes);
  const salvar = useMutation({
    mutationFn: () =>
      api<ConsumoConta>(`/master/contas/${props.conta.id}/limites`, {
        metodo: 'PUT',
        corpo: {
          usaIaPlataforma: f.usaIaPlataforma,
          iaMes: num(f.iaMes),
          emailsMes: num(f.emailsMes),
          whatsappMes: num(f.whatsappMes),
        },
      }),
    onSuccess: (d) => {
      cliente.setQueryData(['master', 'consumo', props.conta.id], d);
      cliente.invalidateQueries({ queryKey: ['master', 'contas'] });
      cliente.invalidateQueries({ queryKey: ['master', 'conta', props.conta.id] });
    },
  });
  const d = q.data;
  if (q.isPending) return <div className="esqueleto" />;
  if (!d) return <ErroDaApi erro={q.error} />;
  const maxDia = Math.max(1, ...d.iaPorDia.map((x) => x.chamadas));
  const iaDaConta = props.conta.credenciais.emUso.ia === 'conta';

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Consumo de {fmtMes(d.mes)} (fuso de São Paulo). Os tetos valem para o que sai sozinho; o que a equipe
        manda à mão nunca é bloqueado.
      </p>
      <div className="grade-uso">
        <Uso
          rotulo="IA pela sua chave (plataforma)"
          usado={d.ia.plataforma.chamadas}
          teto={l?.iaMes ?? null}
          detalhe={
            <>
              {fmtTokens(d.ia.plataforma.tokensEntrada)} tokens de entrada ·{' '}
              {fmtTokens(d.ia.plataforma.tokensSaida)} de saída
              {d.ia.plataforma.bloqueadas > 0 &&
                ` · ${fmtNumero(d.ia.plataforma.bloqueadas)} barradas pelo teto`}
              {d.ia.plataforma.erros > 0 && ` · ${fmtNumero(d.ia.plataforma.erros)} com erro`}
            </>
          }
        />
        <Uso
          rotulo="IA pela chave da conta"
          usado={d.ia.conta.chamadas}
          teto={null}
          detalhe={`${fmtTokens(d.ia.conta.tokensEntrada)} de entrada · ${fmtTokens(d.ia.conta.tokensSaida)} de saída (a conta paga)`}
        />
        <Uso
          rotulo="E-mails automáticos"
          usado={d.emails.enviados}
          teto={l?.emailsMes ?? null}
          detalhe={d.emails.naFila ? `${fmtNumero(d.emails.naFila)} na fila` : 'nada na fila'}
        />
        <Uso
          rotulo="WhatsApp automático"
          usado={d.whatsapp.automaticas}
          teto={l?.whatsappMes ?? null}
          detalhe={`${fmtNumero(d.whatsapp.equipe)} pela equipe · ${fmtNumero(d.whatsapp.recebidas)} recebidas`}
        />
        <Uso
          rotulo="Google Places (buscas)"
          usado={d.places.pedidos}
          teto={null}
          detalhe={`${fmtNumero(d.places.pagos)} pagas · US$ ${d.places.gastoUsd.toFixed(2).replace('.', ',')} · ${fmtNumero(d.places.enriquecimento)} no enriquecimento (a conta paga)`}
        />
        <Uso
          rotulo="Buscas no Google (Serper)"
          usado={d.buscas.serper}
          teto={null}
          detalhe={
            d.buscas.leadsEnriquecidos
              ? `${fmtNumero(d.buscas.leadsEnriquecidos)} leads enriquecidos · ${(d.buscas.serper / d.buscas.leadsEnriquecidos).toFixed(1).replace('.', ',')} buscas por lead · ~US$ ${(d.buscas.serper / 1000).toFixed(2).replace('.', ',')} (a US$ 1 por mil)`
              : 'nenhum lead enriquecido no mês'
          }
        />
      </div>
      {d.iaPorDia.length > 1 && (
        <figure className="grafico-dias" aria-label="Chamadas à IA por dia">
          <figcaption className="quieto">Chamadas à IA por dia</figcaption>
          <div className="grafico-dias__barras">
            {d.iaPorDia.map((x) => (
              <span
                key={x.dia}
                className="grafico-dias__barra"
                style={{ height: `${Math.max(2, Math.round((x.chamadas / maxDia) * 100))}%` }}
                title={`${x.dia.split('-').reverse().slice(0, 2).join('/')}: ${fmtNumero(x.chamadas)}`}
              />
            ))}
          </div>
        </figure>
      )}

      <form
        className="form caixa"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <h3 className="subtitulo" style={{ margin: 0 }}>
          Tetos do mês
        </h3>
        {!props.conta.principal && (
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.usaIaPlataforma}
              onChange={(e) => setF({ ...f, usaIaPlataforma: e.target.checked })}
            />
            <span>
              Pode usar a IA da plataforma (a sua chave) quando não tiver a própria
              {iaDaConta && <span className="quieto"> · hoje ela usa a própria chave</span>}
            </span>
          </label>
        )}
        <div className="form__tres">
          <Teto
            id="teto-ia"
            rotulo="Chamadas à IA da plataforma"
            valor={f.iaMes}
            aoMudar={(v) => setF({ ...f, iaMes: v })}
            dica="Passou, a IA para até o mês virar (o resto segue por regra)."
          />
          <Teto
            id="teto-emails"
            rotulo="E-mails automáticos"
            valor={f.emailsMes}
            aoMudar={(v) => setF({ ...f, emailsMes: v })}
            dica="Passou, a fila espera."
          />
          <Teto
            id="teto-whatsapp"
            rotulo="WhatsApp automático"
            valor={f.whatsappMes}
            aoMudar={(v) => setF({ ...f, whatsappMes: v })}
            dica="IA, cadência e sequências."
          />
        </div>
        <ErroDaApi erro={salvar.error} />
        {salvar.isSuccess && !mudou && <Mensagem tipo="ok">Tetos salvos.</Mensagem>}
        <div className="acoes">
          <Button type="submit" variant="primary" disabled={salvar.isPending || !mudou}>
            Salvar tetos
          </Button>
        </div>
      </form>
    </div>
  );
}

/** O que aconteceu na conta, inclusive o que o master fez nela. */
function HistoricoConta(props: { contaId: number }) {
  const q = useQuery({
    queryKey: ['master', 'auditoria', props.contaId],
    queryFn: () => api<ItemAuditoria[]>(`/master/contas/${props.contaId}/auditoria`),
  });
  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data?.length)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Nada registrado ainda.
      </p>
    );
  return (
    <ul className="historico-conta">
      {q.data.map((i) => (
        <li key={i.id} className="historico-conta__item">
          <span className="quieto historico-conta__quando">{fmtQuando(i.criadoEm)}</span>
          <span>
            <b>{i.usuarioNome ?? 'sistema'}</b>
            {i.comoMaster && <Badge tone="outline">suporte</Badge>} {i.descricao}
            {i.empresaNome && <span className="quieto"> · {i.empresaNome}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── Conta (drawer) ───────────────────────── */

type SecaoConta = 'plano' | 'credenciais' | 'consumo' | 'usuarios' | 'historico' | 'dados';

function Conta(props: { id: number; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const sessao = useSessao();
  const [secao, setSecao] = useState<SecaoConta>('plano');
  const q = useQuery({
    queryKey: ['master', 'conta', props.id],
    queryFn: () => api<ContaDetalhe>(`/master/contas/${props.id}`),
  });
  const [dados, setDados] = useState({ nome: '', observacoes: '' });
  const [desativar, setDesativar] = useState(false);
  useEffect(() => {
    if (q.data) setDados({ nome: q.data.nome, observacoes: q.data.observacoes ?? '' });
  }, [q.data]);
  const atualizar = useMutation({
    mutationFn: (corpo: { nome?: string; observacoes?: string | null; ativa?: boolean }) =>
      api(`/master/contas/${props.id}`, { metodo: 'PATCH', corpo }),
    onSuccess: () => {
      setDesativar(false);
      cliente.invalidateQueries({ queryKey: ['master'] });
    },
  });
  const entrar = useMutation({
    mutationFn: () => api(`/master/contas/${props.id}/entrar`, { metodo: 'POST' }),
    onSuccess: () => {
      // Os dados em cache eram da conta anterior.
      cliente.clear();
      navegar('/hoje');
    },
  });
  const c = q.data;
  const naConta = sessao.data?.conta.id === props.id;

  return (
    <Drawer titulo={c?.nome ?? 'Cliente'} barra="Clientes e planos" aoFechar={props.aoFechar} largo>
      <div className="drawer__corpo">
        {q.isPending ? (
          <div className="esqueleto" />
        ) : !c ? (
          <ErroDaApi erro={q.error} />
        ) : (
          <div className="pilha" style={{ gap: 16 }}>
            <header className="conta-topo">
              <div>
                <h2>
                  {c.nome} {c.principal && <Badge tone="brand">Principal</Badge>}{' '}
                  {!c.ativa && <Badge tone="danger">Desativada</Badge>}
                </h2>
                <span className="quieto">Criada {fmtQuando(c.criadoEm)}</span>
              </div>
              <Button
                variant={naConta ? 'ghost' : 'primary'}
                icon="arrow-right"
                disabled={entrar.isPending || naConta}
                onClick={() => entrar.mutate()}
              >
                {naConta ? 'Você está nesta conta' : 'Entrar na conta'}
              </Button>
            </header>
            <ErroDaApi erro={entrar.error} />
            <div className="pipelines" role="tablist" aria-label="Seções da conta">
              {(
                [
                  ['plano', 'Plano e módulos'],
                  ['credenciais', 'Credenciais'],
                  ['consumo', 'Consumo e tetos'],
                  ['usuarios', `Usuários (${c.usuarios.filter((u) => u.ativo).length})`],
                  ['historico', 'Histórico'],
                  ['dados', 'Dados da conta'],
                ] as [SecaoConta, string][]
              ).map(([id, rotulo]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={secao === id}
                  className="pipelines__aba"
                  onClick={() => setSecao(id)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            {secao === 'plano' && <PlanoDaConta contaId={c.id} />}
            {secao === 'credenciais' && <Credenciais conta={c} />}
            {secao === 'consumo' && <Consumo conta={c} />}
            {secao === 'usuarios' && <Usuarios conta={c} />}
            {secao === 'historico' && <HistoricoConta contaId={c.id} />}
            {secao === 'dados' && (
              <form
                className="form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  atualizar.mutate({ nome: dados.nome, observacoes: dados.observacoes || null });
                }}
              >
                <div className="campo">
                  <label htmlFor="cd-nome">Nome da conta</label>
                  <input
                    id="cd-nome"
                    className="filtro"
                    maxLength={80}
                    value={dados.nome}
                    onChange={(e) => setDados({ ...dados, nome: e.target.value })}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="cd-obs">Observações (só o master vê)</label>
                  <textarea
                    id="cd-obs"
                    rows={3}
                    maxLength={1000}
                    value={dados.observacoes}
                    onChange={(e) => setDados({ ...dados, observacoes: e.target.value })}
                  />
                </div>
                <ErroDaApi erro={atualizar.error} />
                <div className="acoes">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      atualizar.isPending ||
                      dados.nome.trim().length < 2 ||
                      (dados.nome === c.nome && dados.observacoes === (c.observacoes ?? ''))
                    }
                  >
                    Salvar
                  </Button>
                </div>
                {!c.principal && (
                  <div className="confirmar">
                    {c.ativa ? (
                      desativar ? (
                        <>
                          <b>Desativar a conta {c.nome}?</b>
                          <span className="quieto">
                            Ninguém dela consegue entrar e os envios automáticos (e-mail, WhatsApp, agente)
                            param. Os dados ficam guardados e dá para reativar depois.
                          </span>
                          <div className="acoes">
                            <Button
                              variant="danger"
                              disabled={atualizar.isPending}
                              onClick={() => atualizar.mutate({ ativa: false })}
                            >
                              Desativar {c.nome}
                            </Button>
                            <Button variant="ghost" onClick={() => setDesativar(false)}>
                              Manter ativa
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div>
                          <Button variant="ghost" onClick={() => setDesativar(true)}>
                            Desativar conta
                          </Button>
                        </div>
                      )
                    ) : (
                      <div>
                        <Button
                          disabled={atualizar.isPending}
                          onClick={() => atualizar.mutate({ ativa: true })}
                        >
                          Reativar conta
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ───────────────────────── Plano da conta ───────────────────────── */

function PlanoDaConta(props: { contaId: number }) {
  const q = useQuery({
    queryKey: ['master', 'plano', props.contaId],
    queryFn: () => api<PlanoConta>(`/master/contas/${props.contaId}/plano`),
  });
  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  return (
    <div className="pilha" style={{ gap: 20 }}>
      <ResumoPlano p={q.data} />
      <hr className="divisor" />
      <FormPlano contaId={props.contaId} p={q.data} />
    </div>
  );
}

/* ───────────────────────── Nova conta ───────────────────────── */

function NovaConta(props: { aoFechar: () => void; aoAbrir: (id: number) => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ nome: '', observacoes: '', admin: { nome: '', email: '' } });
  const [plano, setPlano] = useState<Plano>('start');
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number; convite: string; diasValidade: number }>('/master/contas', {
        metodo: 'POST',
        corpo: {
          ...f,
          observacoes: f.observacoes || undefined,
          // Personalizado: começa com os números do Start; ajuste na aba Plano e módulos.
          plano:
            plano === 'personalizado'
              ? { plano, limiteUsuarios: 2, limiteLeadsMes: 5000, modulos }
              : { plano, modulos },
        },
      }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master', 'contas'] }),
  });

  return (
    <Drawer titulo="Novo cliente" barra="Clientes e planos" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {criar.data ? (
          <div className="pilha" style={{ gap: 16 }}>
            <LinkConvite
              link={criar.data.convite}
              nome={f.admin.nome}
              dias={criar.data.diasValidade}
              conta={f.nome}
            />
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              A conta já vem com os funis SDR e Closer, modelos de mensagem e e-mail e uma identidade visual
              para ajustar. Falta cadastrar as chaves das APIs dela.
            </p>
            <div className="acoes">
              <Button variant="primary" icon="settings" onClick={() => props.aoAbrir(criar.data.id)}>
                Abrir a conta
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <div className="campo">
              <label htmlFor="nc-nome">Nome da empresa</label>
              <input
                id="nc-nome"
                className="filtro"
                maxLength={80}
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="nc-obs">Observações</label>
              <textarea
                id="nc-obs"
                rows={2}
                maxLength={1000}
                value={f.observacoes}
                onChange={(e) => setF({ ...f, observacoes: e.target.value })}
              />
              <span className="campo__dica">Só o master vê (contrato, contato, combinados).</span>
            </div>
            <fieldset className="campo">
              <legend>Plano</legend>
              <div className="planos-escolha">
                {(['start', 'time', 'escala', 'personalizado'] as Plano[]).map((id) => (
                  <label key={id} className="plano-opcao" data-ativo={plano === id || undefined}>
                    <input
                      type="radio"
                      name="nc-plano"
                      checked={plano === id}
                      onChange={() => setPlano(id)}
                    />
                    <b>{ROTULO_PLANO[id]}</b>
                    {id === 'personalizado' ? (
                      <span className="quieto">Ajuste os números depois</span>
                    ) : (
                      <span className="quieto">
                        {fmtReais(PLANOS[id].preco)} · {PLANOS[id].usuarios} usuários ·{' '}
                        {fmtNumero(PLANOS[id].leadsMes)} leads
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <div className="pilha" style={{ gap: 6, marginTop: 8 }}>
                {LISTA_MODULOS.map((m) => (
                  <label key={m} className="opcao">
                    <input
                      type="checkbox"
                      checked={modulos.includes(m)}
                      onChange={(e) => {
                        let novos = e.target.checked ? [...modulos, m] : modulos.filter((x) => x !== m);
                        if (m === 'agente_ia' && e.target.checked && !novos.includes('whatsapp'))
                          novos = [...novos, 'whatsapp'];
                        if (m === 'whatsapp' && !e.target.checked)
                          novos = novos.filter((x) => x !== 'agente_ia');
                        setModulos(novos);
                      }}
                    />
                    {MODULOS[m].nome} · {fmtReais(MODULOS[m].preco)}/mês
                  </label>
                ))}
              </div>
              <span className="campo__dica">Números, módulos e mensalidade podem ser ajustados depois.</span>
            </fieldset>
            <fieldset className="opcoes">
              <legend>Primeiro administrador</legend>
              <div className="form__duas">
                <div className="campo">
                  <label htmlFor="nc-admin-nome">Nome</label>
                  <input
                    id="nc-admin-nome"
                    className="filtro"
                    maxLength={80}
                    value={f.admin.nome}
                    onChange={(e) => setF({ ...f, admin: { ...f.admin, nome: e.target.value } })}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="nc-admin-email">E-mail</label>
                  <input
                    id="nc-admin-email"
                    className="filtro"
                    type="email"
                    value={f.admin.email}
                    onChange={(e) => setF({ ...f, admin: { ...f.admin, email: e.target.value } })}
                  />
                </div>
              </div>
              <span className="campo__dica">
                Recebe o link para criar a senha. Depois ele mesmo convida a equipe dele.
              </span>
            </fieldset>
            <ErroDaApi erro={criar.error} />
            <div className="acoes">
              <Button
                type="submit"
                variant="primary"
                disabled={
                  criar.isPending ||
                  f.nome.trim().length < 2 ||
                  f.admin.nome.trim().length < 2 ||
                  !f.admin.email.includes('@')
                }
              >
                {criar.isPending ? 'Criando…' : 'Criar conta'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  );
}

/* ───────────────────────── Página ───────────────────────── */

/** Painel master: as empresas que usam o sistema, as chaves de cada uma e o acesso de suporte. */
export function Master() {
  const sessao = useSessao();
  const [params, setParams] = useSearchParams();
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState('');
  const q = useQuery({
    queryKey: ['master', 'contas'],
    queryFn: () => api<ContaResumo[]>('/master/contas'),
    enabled: !!sessao.data?.master,
  });
  const aberta = Number(params.get('conta')) || null;
  const abrir = (id: number | null) => {
    const p = new URLSearchParams(params);
    id ? p.set('conta', String(id)) : p.delete('conta');
    setParams(p, { replace: true });
  };

  if (sessao.data && !sessao.data.master) return <Navigate to="/" replace />;

  const contas = q.data ?? [];
  const clientes = contas.filter((c) => !c.principal);
  const ativos = clientes.filter((c) => c.ativa && c.plano.plano);
  const mrr = ativos.reduce((s, c) => s + (c.plano.mensalidade ?? 0), 0);
  const noLimite = ativos.filter(
    (c) => c.plano.leadsMes != null && c.plano.uso.leadsMes >= c.plano.leadsMes * 0.9,
  ).length;
  const termo = busca.trim().toLowerCase();
  const visiveis = contas.filter((c) => !termo || c.nome.toLowerCase().includes(termo));

  return (
    <>
      <div className="topo">
        <div>
          <h1>Clientes e planos</h1>
          <p>
            As empresas que contrataram o Prospect Team: plano, módulos, usuários, uso do mês, chaves de API e
            o acesso para dar suporte.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setNova(true)}>
          Novo cliente
        </Button>
      </div>
      <div className="kpis">
        <Stat rotulo="Clientes ativos" valor={fmtNumero(ativos.length)} />
        <Stat rotulo="Mensalidades (por mês)" valor={fmtReais(mrr)} />
        <Stat
          rotulo="Usuários em uso"
          valor={fmtNumero(ativos.reduce((s, c) => s + c.plano.uso.usuarios, 0))}
        />
        <Stat rotulo="Perto ou no limite de leads" valor={fmtNumero(noLimite)} />
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !contas.length ? (
        <div className="pp-panel">
          <EmptyState
            icone="building-2"
            titulo="Nenhum cliente"
            texto="Cadastre o primeiro cliente para começar."
          />
        </div>
      ) : (
        <>
          {contas.length > 6 && (
            <input
              className="filtro"
              style={{ maxWidth: 320, marginBottom: 12 }}
              aria-label="Buscar cliente"
              placeholder="Buscar cliente…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          )}
          <div className="pp-tablewrap">
            <table className="pp-table tabela-contas">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Plano</th>
                  <th>Módulos</th>
                  <th>Usuários</th>
                  <th>Leads no mês</th>
                  <th>Mensalidade</th>
                  <th title="Leads abertos no funil">No funil</th>
                  <th>Último acesso</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((c) => {
                  const p = c.plano;
                  const pctLeads = p.leadsMes ? p.uso.leadsMes / Math.max(1, p.leadsMes) : 0;
                  return (
                    <tr key={c.id} data-inativo={!c.ativa || undefined}>
                      <td>
                        <button
                          type="button"
                          className="link-botao tabela-contas__nome"
                          onClick={() => abrir(c.id)}
                        >
                          {c.nome}
                        </button>{' '}
                        {c.principal && <Badge tone="brand">Sua conta</Badge>}
                        {!c.ativa && <Badge tone="danger">Desativada</Badge>}
                        {sessao.data?.conta.id === c.id && <Badge tone="outline">Você está aqui</Badge>}
                      </td>
                      <td>{p.plano ? ROTULO_PLANO[p.plano] : <span className="quieto">Sem plano</span>}</td>
                      <td>
                        {p.plano ? (
                          p.modulos.length ? (
                            <span className="modulos-mini">
                              {p.modulos.map((m) => (
                                <Badge key={m} tone="outline">
                                  {m === 'agente_ia' ? 'IA' : m === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                                </Badge>
                              ))}
                            </span>
                          ) : (
                            <span className="quieto">nenhum</span>
                          )
                        ) : (
                          <span className="quieto">todos</span>
                        )}
                      </td>
                      <td className="mono">
                        {fmtNumero(p.uso.usuarios)}
                        {p.usuarios != null && <span className="quieto"> / {fmtNumero(p.usuarios)}</span>}
                      </td>
                      <td
                        className="mono"
                        data-alerta={pctLeads >= 1 ? 'cheio' : pctLeads >= 0.9 ? 'quase' : undefined}
                      >
                        {fmtNumero(p.uso.leadsMes)}
                        {p.leadsMes != null && <span className="quieto"> / {fmtNumero(p.leadsMes)}</span>}
                      </td>
                      <td className="mono">{p.mensalidade != null ? fmtReais(p.mensalidade) : '—'}</td>
                      <td className="mono">{fmtNumero(c.leadsNoFunil)}</td>
                      <td className="quieto">{c.ultimoAcesso ? fmtQuando(c.ultimoAcesso) : 'nunca'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="nota-rodape">
        Cada cliente só vê os próprios dados (funil, campanhas, conversas, e-mails, equipe) e só usa o que o
        plano dele libera. “Entrar na conta” abre o sistema como administrador dele, para configurar ou dar
        suporte; a base de empresas (CNPJ, Maps, enriquecimento) é uma só e economiza buscas.
      </p>
      {nova && (
        <NovaConta
          aoFechar={() => setNova(false)}
          aoAbrir={(id) => {
            setNova(false);
            abrir(id);
          }}
        />
      )}
      {aberta && <Conta key={aberta} id={aberta} aoFechar={() => abrir(null)} />}
    </>
  );
}
