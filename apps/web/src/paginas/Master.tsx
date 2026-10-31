import {
  LISTA_MODULOS,
  LISTA_RECURSOS,
  MODULOS,
  type Modulo,
  type Plano,
  planoEfetivo,
  RECURSOS,
  type Recurso,
  TABELA_PADRAO,
} from '@prospeccao/shared/planos';
import { Badge, Button, EmptyState, Icon, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, Fragment, type ReactNode, useEffect, useState } from 'react';
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
import { AcessoUsuario, SituacaoCliente } from '../componentes/GerenciarCliente';
import {
  Contador,
  FormPlano,
  ResumoPlano,
  ROTULO_PLANO,
  TabelaDePrecos,
  useTabelaPrecos,
} from '../componentes/PlanoConta';
import { useSessao } from '../componentes/Sessao';
import { fmtMes, fmtNumero, fmtQuando, fmtReais } from '../formatar';
import { LinkConvite } from './Equipe';
import { type ClientePainel, ROTULO_SAUDE, TOM_SAUDE } from './Plataforma';

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
  iaProvedor: ProvedorIa | '';
  iaModelo: string;
  iaBaseUrl: string;
}

function doServidor(c: CredenciaisTela): FormCredenciais {
  return {
    emailRemetente: c.emailRemetente ?? '',
    resendDominioRespostas: c.resendDominioRespostas ?? '',
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
          <Icon name="message-circle" size={16} /> WhatsApp (Z-API)
          <Origem origem={c.emUso.whatsapp} />
        </legend>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          {c.emUso.whatsapp
            ? 'A Z-API é da plataforma. O próprio cliente conecta os números dele em Agente → Números de WhatsApp, lendo o QR Code; o sistema cria, assina e cancela as instâncias sozinho. Quantos números ele pode ter fica em Consumo → Tetos do mês.'
            : 'Falta ZAPI_PARCEIRO_TOKEN (e ZAPI_CLIENT_TOKEN) nas variáveis da api e do worker-enriquecimento.'}
        </p>
        <Testar contaId={props.conta.id} servico="whatsapp" mudou={mudou} />
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

export function Usuarios(props: { conta: ContaDetalhe }) {
  const cliente = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [acesso, setAcesso] = useState<number | null>(null);
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
                  icon="lock"
                  aria-expanded={acesso === u.id}
                  onClick={() => setAcesso(acesso === u.id ? null : u.id)}
                >
                  E-mail e senha
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
            {acesso === u.id && <AcessoUsuario usuario={u} aoFechar={() => setAcesso(null)} />}
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
  const [f, setF] = useState({
    usaIaPlataforma: true,
    iaMes: '',
    emailsMes: '',
    whatsappMes: '',
    numerosWhatsapp: '',
  });
  const l = q.data?.limites;
  useEffect(() => {
    if (l)
      setF({
        usaIaPlataforma: l.usaIaPlataforma,
        iaMes: l.iaMes == null ? '' : String(l.iaMes),
        emailsMes: l.emailsMes == null ? '' : String(l.emailsMes),
        whatsappMes: l.whatsappMes == null ? '' : String(l.whatsappMes),
        numerosWhatsapp: l.numerosWhatsapp == null ? '' : String(l.numerosWhatsapp),
      });
  }, [l]);
  const num = (v: string) => (v === '' ? null : Number(v));
  const mudou =
    !!l &&
    (f.usaIaPlataforma !== l.usaIaPlataforma ||
      num(f.iaMes) !== l.iaMes ||
      num(f.emailsMes) !== l.emailsMes ||
      num(f.whatsappMes) !== l.whatsappMes ||
      num(f.numerosWhatsapp) !== l.numerosWhatsapp);
  const salvar = useMutation({
    mutationFn: () =>
      api<ConsumoConta>(`/master/contas/${props.conta.id}/limites`, {
        metodo: 'PUT',
        corpo: {
          usaIaPlataforma: f.usaIaPlataforma,
          iaMes: num(f.iaMes),
          emailsMes: num(f.emailsMes),
          whatsappMes: num(f.whatsappMes),
          numerosWhatsapp: num(f.numerosWhatsapp),
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
          rotulo="Números de WhatsApp (Z-API)"
          usado={d.whatsapp.numeros}
          teto={l?.numerosWhatsapp ?? null}
          detalhe="Cada número conectado é uma instância paga na Z-API."
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
          <Teto
            id="teto-numeros"
            rotulo="Números de WhatsApp"
            valor={f.numerosWhatsapp}
            aoMudar={(v) => setF({ ...f, numerosWhatsapp: v })}
            dica="Quantos o cliente pode conectar pelo QR Code."
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
    <Drawer titulo={c?.nome ?? 'Cliente'} barra="Clientes" aoFechar={props.aoFechar} largo>
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
                {!c.principal && (
                  <div className="pilha" style={{ gap: 8 }}>
                    <span className="fin-titulo">Cliente {c.organizacaoNome}</span>
                    <SituacaoCliente
                      organizacaoId={c.organizacaoId}
                      nome={c.organizacaoNome}
                      ativa={c.organizacaoAtiva}
                      principal={c.principal}
                      aoExcluir={props.aoFechar}
                    />
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
      {q.data.organizacao.unidades > 1 && (
        <Mensagem tipo="aviso">
          O plano é do cliente {q.data.organizacao.nome} e vale somado para as {q.data.organizacao.unidades}{' '}
          unidades. Esta unidade
          {q.data.unidade?.cota != null
            ? ` tem cota de ${fmtNumero(q.data.unidade.cota)} leads por mês`
            : ' não tem cota própria (usa o que sobra do total)'}
          ; já usou {fmtNumero(q.data.unidade?.leadsMes ?? 0)} neste mês.
        </Mensagem>
      )}
      <ResumoPlano p={q.data} />
      <hr className="divisor" />
      <FormPlano contaId={props.contaId} p={q.data} />
    </div>
  );
}

/* ───────────────────────── Nova conta ───────────────────────── */

export function NovaConta(props: {
  aoFechar: () => void;
  aoAbrir: (id: number) => void;
  /** Pedido do quadro de vendas que virou cliente: os dados já vêm preenchidos. */
  inicial?: {
    nome?: string;
    adminNome?: string;
    email?: string | null;
    plano?: Plano | null;
    observacoes?: string;
  };
  aoCriar?: (id: number) => void;
}) {
  const cliente = useQueryClient();
  const ini = props.inicial;
  const [f, setF] = useState({
    nome: ini?.nome ?? '',
    observacoes: ini?.observacoes ?? '',
    admin: { nome: ini?.adminNome ?? '', email: ini?.email ?? '' },
  });
  const [plano, setPlano] = useState<Plano>(ini?.plano ?? 'start');
  const tabela = useTabelaPrecos().data ?? TABELA_PADRAO;
  const [modulos, setModulos] = useState<Modulo[]>([]);
  // Personalizado: os números e os recursos ficam à vista (e o preço sai na hora, item a item).
  const [pers, setPers] = useState({ usuarios: 2, leads: 2000, recursos: [] as Recurso[] });
  const previaPers = planoEfetivo(
    {
      plano: 'personalizado',
      limiteUsuarios: pers.usuarios,
      limiteLeadsMes: pers.leads,
      modulos,
      mensalidadeManual: null,
      numerosExtras: 0,
      recursosExtras: pers.recursos,
      horasReuniao: null,
      conversasIa: null,
    },
    tabela,
  );
  const [varias, setVarias] = useState(false);
  const [unidade, setUnidade] = useState('');
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number; convite: string; diasValidade: number }>('/master/contas', {
        metodo: 'POST',
        corpo: {
          ...f,
          observacoes: f.observacoes || undefined,
          primeiroAcesso: varias ? 'gestor' : 'admin',
          unidade: varias && unidade.trim() ? unidade.trim() : undefined,
          // Personalizado: com os números e os recursos escolhidos aqui (o resto ajusta em Plano e módulos).
          plano:
            plano === 'personalizado'
              ? {
                  plano,
                  limiteUsuarios: pers.usuarios,
                  limiteLeadsMes: pers.leads,
                  modulos,
                  recursosExtras: pers.recursos,
                }
              : { plano, modulos },
        },
      }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ['master'] });
      props.aoCriar?.(r.id);
    },
  });

  return (
    <Drawer titulo="Novo cliente" barra="Clientes" aoFechar={props.aoFechar}>
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
                      <span className="quieto">Você monta: usuários, leads, módulos e recursos</span>
                    ) : (
                      <span className="quieto">
                        {fmtReais(tabela.planos[id].preco)} · {tabela.planos[id].usuarios} usuários ·{' '}
                        {fmtNumero(tabela.planos[id].leadsMes)} leads
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
                    {MODULOS[m].nome} · {fmtReais(tabela.modulos[m])}/mês
                  </label>
                ))}
              </div>
              {plano === 'personalizado' && (
                <div className="nc-personalizado">
                  <div className="form__duas">
                    <Contador
                      id="nc-usuarios"
                      rotulo="Usuários"
                      valor={pers.usuarios}
                      passo={1}
                      minimo={1}
                      aoMudar={(v) => setPers({ ...pers, usuarios: v })}
                    />
                    <Contador
                      id="nc-leads"
                      rotulo="Leads enriquecidos por mês"
                      valor={pers.leads}
                      passo={1000}
                      minimo={0}
                      aoMudar={(v) => setPers({ ...pers, leads: v })}
                    />
                  </div>
                  <fieldset className="campo">
                    <legend>Recursos liberados</legend>
                    <div className="nc-recursos">
                      {LISTA_RECURSOS.map((r) => (
                        <label key={r} className="opcao" title={RECURSOS[r].descricao}>
                          <input
                            type="checkbox"
                            checked={pers.recursos.includes(r)}
                            onChange={(e) =>
                              setPers({
                                ...pers,
                                recursos: e.target.checked
                                  ? [...pers.recursos, r]
                                  : pers.recursos.filter((x) => x !== r),
                              })
                            }
                          />
                          {RECURSOS[r].nome}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="plano-composicao">
                    <b>{fmtReais(previaPers.mensalidadeCalculada ?? 0)}/mês</b> ={' '}
                    {previaPers.itens.map((i, n) => (
                      <span key={i.rotulo}>
                        {n > 0 && ' + '}
                        {i.rotulo} <span className="mono">{fmtReais(i.valor)}</span>
                      </span>
                    ))}
                    . Usuário {fmtReais(tabela.usuario)} e cada 1.000 leads {fmtReais(tabela.milLeads)}{' '}
                    (Tabela de preços); os recursos não mudam o valor. Dá para combinar outro valor depois, em
                    Plano e módulos.
                  </p>
                </div>
              )}
              <span className="campo__dica">Números, módulos e mensalidade podem ser ajustados depois.</span>
            </fieldset>
            <label className="opcao">
              <input type="checkbox" checked={varias} onChange={(e) => setVarias(e.target.checked)} />
              <span>
                Cliente com várias unidades (regionais, filiais ou times)
                <span className="campo__dica" style={{ display: 'block' }}>
                  O primeiro acesso vira gestor da organização: ele cria as outras unidades, divide a cota de
                  leads e convida as pessoas de cada uma.
                </span>
              </span>
            </label>
            {varias && (
              <div className="campo">
                <label htmlFor="nc-unidade">Primeira unidade</label>
                <input
                  id="nc-unidade"
                  className="filtro"
                  maxLength={80}
                  placeholder="Ex.: Matriz, Regional Sudeste"
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                />
              </div>
            )}
            <fieldset className="opcoes">
              <legend>{varias ? 'Gestor da organização' : 'Primeiro administrador'}</legend>
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

/** Nova unidade num cliente (o contrato continua o do cliente, somado). */
function NovaUnidade(props: {
  organizacao: { id: number; nome: string };
  aoFechar: () => void;
  aoCriar: (id: number) => void;
}) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState('');
  const [cota, setCota] = useState('');
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number }>(`/master/organizacoes/${props.organizacao.id}/unidades`, {
        metodo: 'POST',
        corpo: { nome, cotaLeadsMes: cota.trim() ? Number(cota.replace(/\D/g, '')) : null },
      }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ['master'] });
      props.aoCriar(r.id);
    },
  });
  return (
    <Drawer titulo={`Nova unidade de ${props.organizacao.nome}`} barra="Clientes" aoFechar={props.aoFechar}>
      <form
        className="drawer__corpo form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          criar.mutate();
        }}
      >
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          A unidade tem funil, campanhas, WhatsApp e equipe próprios; o plano, os usuários e os leads do mês
          são do cliente, somados. O gestor do cliente também cria unidades pela tela Organização.
        </p>
        <div className="campo">
          <label htmlFor="nu-nome">Nome da unidade</label>
          <input
            id="nu-nome"
            className="filtro"
            maxLength={80}
            placeholder="Ex.: Regional Nordeste"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="nu-cota">Cota de leads por mês (opcional)</label>
          <input
            id="nu-cota"
            className="filtro"
            inputMode="numeric"
            value={cota}
            onChange={(e) => setCota(e.target.value)}
          />
        </div>
        <ErroDaApi erro={criar.error} />
        <Button variant="primary" type="submit" disabled={criar.isPending || nome.trim().length < 2}>
          {criar.isPending ? 'Criando…' : 'Criar unidade'}
        </Button>
      </form>
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
  const [precos, setPrecos] = useState(false);
  const [novaUnidade, setNovaUnidade] = useState<{ id: number; nome: string } | null>(null);
  const q = useQuery({
    queryKey: ['master', 'contas'],
    queryFn: () => api<ContaResumo[]>('/master/contas'),
    enabled: !!sessao.data?.master,
  });
  const painel = useQuery({
    queryKey: ['master', 'clientes-painel'],
    queryFn: () => api<{ clientes: ClientePainel[] }>('/master/plataforma/clientes'),
    enabled: !!sessao.data?.master,
  });
  // Saúde por cliente (organização).
  const saude = new Map(painel.data?.clientes.map((c) => [c.id, c]) ?? []);
  const aberta = Number(params.get('conta')) || null;
  const abrir = (id: number | null) => {
    const p = new URLSearchParams(params);
    id ? p.set('conta', String(id)) : p.delete('conta');
    setParams(p, { replace: true });
  };

  if (sessao.data && !sessao.data.master) return <Navigate to="/" replace />;

  const contas = q.data ?? [];
  // Um cliente (organização) pode ter várias unidades: o contrato é dele, as unidades vêm abaixo.
  const grupos = [
    ...new Map(
      contas.map((c) => [c.organizacaoId, contas.filter((x) => x.organizacaoId === c.organizacaoId)]),
    ).values(),
  ];
  const clientes = grupos.filter((g) => !g.some((c) => c.principal)).map((g) => g[0]!);
  const ativos = clientes.filter((c) => c.organizacaoAtiva && c.plano.plano);
  const mrr = ativos.reduce((s, c) => s + (c.plano.mensalidade ?? 0), 0);
  const noLimite = ativos.filter(
    (c) => c.plano.leadsMes != null && c.plano.uso.leadsMes >= c.plano.leadsMes * 0.9,
  ).length;
  const termo = busca.trim().toLowerCase();
  // A conta da plataforma (onde ficam os administradores) não é cliente: fica fora da lista.
  const visiveis = grupos.filter(
    (g) =>
      !g.some((c) => c.principal) &&
      (!termo ||
        g[0]!.organizacaoNome.toLowerCase().includes(termo) ||
        g.some((c) => c.nome.toLowerCase().includes(termo))),
  );

  return (
    <>
      <div className="topo">
        <div>
          <h1>Clientes</h1>
          <p>
            As empresas que contrataram o Prospect Team: plano, módulos, usuários, uso do mês, chaves de API e
            o acesso para dar suporte.
          </p>
        </div>
        <div className="acoes">
          <Button variant="ghost" icon="file-text" onClick={() => setPrecos(true)}>
            Tabela de preços
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setNova(true)}>
            Novo cliente
          </Button>
        </div>
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
                  <th>Saúde</th>
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
                {visiveis.map((g) => {
                  const c = g[0]!;
                  const p = c.plano;
                  const pctLeads = p.leadsMes ? p.uso.leadsMes / Math.max(1, p.leadsMes) : 0;
                  const varias = g.length > 1;
                  const principal = g.some((x) => x.principal);
                  const x = saude.get(c.organizacaoId);
                  return (
                    <Fragment key={c.organizacaoId}>
                      <tr data-inativo={!c.organizacaoAtiva || undefined} data-grupo={varias || undefined}>
                        <td>
                          {varias ? (
                            <b className="tabela-contas__nome">{c.organizacaoNome}</b>
                          ) : (
                            <button
                              type="button"
                              className="link-botao tabela-contas__nome"
                              onClick={() => abrir(c.id)}
                            >
                              {c.organizacaoNome}
                            </button>
                          )}{' '}
                          {principal && <Badge tone="brand">Sua conta</Badge>}
                          {varias && <Badge tone="outline">{g.length} unidades</Badge>}
                          {!c.organizacaoAtiva && <Badge tone="danger">Desativado</Badge>}
                          {!varias && sessao.data?.conta.id === c.id && (
                            <Badge tone="outline">Você está aqui</Badge>
                          )}
                          {!principal && (
                            <button
                              type="button"
                              className="link-botao tabela-contas__unidade"
                              onClick={() => setNovaUnidade({ id: c.organizacaoId, nome: c.organizacaoNome })}
                            >
                              + unidade
                            </button>
                          )}
                        </td>
                        <td>
                          {!x || principal ? (
                            <span className="quieto">—</span>
                          ) : (
                            <span title={x.saudeTexto}>
                              <Badge tone={TOM_SAUDE[x.saude]}>{ROTULO_SAUDE[x.saude]}</Badge>
                            </span>
                          )}
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
                        <td className="mono">{fmtNumero(g.reduce((s, u) => s + u.leadsNoFunil, 0))}</td>
                        <td className="quieto">
                          {(() => {
                            const ultimo = g
                              .map((u) => u.ultimoAcesso)
                              .filter((v): v is string => !!v)
                              .sort()
                              .at(-1);
                            return ultimo ? fmtQuando(ultimo) : 'nunca';
                          })()}
                        </td>
                      </tr>
                      {varias &&
                        g.map((u) => (
                          <tr
                            key={u.id}
                            className="tabela-contas__linha-unidade"
                            data-inativo={!u.ativa || undefined}
                          >
                            <td>
                              <button
                                type="button"
                                className="link-botao tabela-contas__nome"
                                onClick={() => abrir(u.id)}
                              >
                                {u.nome}
                              </button>{' '}
                              {!u.ativa && <Badge tone="danger">Desativada</Badge>}
                              {sessao.data?.conta.id === u.id && <Badge tone="outline">Você está aqui</Badge>}
                            </td>
                            <td />
                            <td colSpan={2} className="quieto">
                              {u.cotaLeadsMes != null
                                ? `Cota de ${fmtNumero(u.cotaLeadsMes)} leads/mês`
                                : 'Sem cota própria'}
                            </td>
                            <td className="mono">{fmtNumero(u.usuarios)}</td>
                            <td className="mono">{fmtNumero(u.plano.unidade?.leadsMes ?? 0)}</td>
                            <td />
                            <td className="mono">{fmtNumero(u.leadsNoFunil)}</td>
                            <td className="quieto">{u.ultimoAcesso ? fmtQuando(u.ultimoAcesso) : 'nunca'}</td>
                          </tr>
                        ))}
                    </Fragment>
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
      {novaUnidade && (
        <NovaUnidade
          organizacao={novaUnidade}
          aoFechar={() => setNovaUnidade(null)}
          aoCriar={(id) => {
            setNovaUnidade(null);
            abrir(id);
          }}
        />
      )}
      {precos && (
        <Drawer titulo="Tabela de preços" barra="Clientes" aoFechar={() => setPrecos(false)} largo>
          <div className="drawer__corpo">
            <TabelaDePrecos />
          </div>
        </Drawer>
      )}
    </>
  );
}
