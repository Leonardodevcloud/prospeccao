import { Badge, Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtQuando } from '../formatar';
import { FundosDasReunioes } from './FundosReuniao';
import { MarcaCompleta, type MarcaDados } from './MarcaPainel';

/**
 * Marca e domínio (white label): o cliente coloca o nome, a cor, o logo, o ícone e a imagem de
 * divulgação, e escolhe o endereço próprio (crm.empresa.com.br). Ele mesmo faz tudo: a tela mostra o
 * registro de DNS, o passo a passo de cada provedor, e confere sozinha até ativar.
 */

interface RegistroDns {
  tipo: 'CNAME' | 'A' | 'TXT';
  nome: string;
  host: string;
  valor: string;
}

interface DadosMarca extends MarcaDados {
  dominio: {
    endereco: string;
    situacao: 'pendente' | 'ativo';
    registros: RegistroDns[];
    erro: string | null;
    desde: string | null;
    ativoEm: string | null;
    conferidoEm: string | null;
  } | null;
  dominioDisponivel: boolean;
}

function useDadosMarca() {
  return useQuery({
    queryKey: ['marca'],
    queryFn: () => api<DadosMarca>('/marca'),
    // Esperando o DNS: a tela acompanha a conferência automática.
    refetchInterval: (q) => (q.state.data?.dominio?.situacao === 'pendente' ? 60_000 : false),
  });
}

type Aba = 'marca' | 'dominio' | 'fundos';
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'marca', rotulo: 'Marca' },
  { id: 'dominio', rotulo: 'Domínio próprio' },
  { id: 'fundos', rotulo: 'Fundos das reuniões' },
];

export function MarcaEDominio() {
  const q = useDadosMarca();
  const [params, setParams] = useSearchParams();
  const aba: Aba = ABAS.some((a) => a.id === params.get('aba')) ? (params.get('aba') as Aba) : 'marca';
  return (
    <>
      <div className="topo">
        <div>
          <h1>Marca e domínio</h1>
          <p>O sistema com o nome, as cores e o endereço da sua empresa, para toda a equipe e os clientes.</p>
        </div>
        <LinkAjuda artigo="marca-dominio">Como funciona</LinkAjuda>
      </div>
      <div className="pipelines" role="tablist" aria-label="Seções de Marca e domínio">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setParams({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
            {a.id === 'dominio' && q.data?.dominio && (
              <span
                className={`pipelines__conta${q.data.dominio.situacao === 'pendente' ? ' pipelines__conta--nova' : ''}`}
              >
                {q.data.dominio.situacao === 'ativo' ? 'ativo' : 'DNS'}
              </span>
            )}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.error || !q.data ? (
        <ErroDaApi erro={q.error} />
      ) : (
        <Conteudo dados={q.data} aba={aba} />
      )}
    </>
  );
}

function Conteudo(props: { dados: DadosMarca; aba: Aba }) {
  const d = props.dados;
  return (
    <>
      {!d.podeEditar && (
        <Mensagem tipo="aviso">
          Só o gestor da organização muda a marca, o domínio e os fundos (vale para todas as unidades). Você
          pode ver como está.
        </Mensagem>
      )}
      {props.aba === 'dominio' && (
        <div className="marca-dominio">
          <PainelDominio dados={d} />
        </div>
      )}
      {props.aba === 'fundos' && <FundosDasReunioes />}
      {/* A marca fica montada (escondida nas outras abas) para não perder o que ainda não foi salvo. */}
      <div hidden={props.aba !== 'marca'}>
        <MarcaCompleta
          dados={d}
          endereco={d.dominio?.situacao === 'ativo' ? d.dominio.endereco : location.host}
        />
      </div>
    </>
  );
}

/* ---------- Domínio ---------- */

function PainelDominio(props: { dados: DadosMarca }) {
  const d = props.dados;
  const dom = d.dominio;
  const [trocando, setTrocando] = useState(false);
  const [tirando, setTirando] = useState(false);
  const cliente = useQueryClient();
  const atualizar = (r: DadosMarca) => {
    cliente.setQueryData(['marca'], r);
    cliente.invalidateQueries({ queryKey: ['sessao'] });
  };
  const tirar = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio', { metodo: 'DELETE' }),
    onSuccess: (r) => {
      atualizar(r);
      setTirando(false);
      setTrocando(false);
    },
  });
  const chip =
    dom?.situacao === 'ativo' ? (
      <Badge tone="brand" icon="check">
        Ativo
      </Badge>
    ) : dom ? (
      <Badge tone="warning">Aguardando o DNS</Badge>
    ) : null;
  return (
    <Panel titulo="Domínio próprio" acoes={chip}>
      {!d.dominioDisponivel ? (
        <Mensagem tipo="aviso">
          O domínio próprio ainda não está liberado na plataforma. Fale com o suporte do Prospect Team.
        </Mensagem>
      ) : !dom || trocando ? (
        <EscolherEndereco
          atual={dom?.endereco ?? null}
          editar={d.podeEditar}
          aoSalvar={(r) => {
            atualizar(r);
            setTrocando(false);
          }}
          aoCancelar={dom ? () => setTrocando(false) : undefined}
        />
      ) : dom.situacao === 'ativo' ? (
        <div className="pilha" style={{ gap: 12 }}>
          <div className="dominio-ativo">
            <span className="mono dominio-ativo__endereco">{dom.endereco}</span>
            <Button
              size="sm"
              variant="ghost"
              iconRight="external-link"
              href={`https://${dom.endereco}`}
              target="_blank"
              rel="noopener"
            >
              Abrir
            </Button>
          </div>
          <p className="quieto dominio-texto">
            Login, links de reunião, convites e “esqueci a senha” saem com este endereço. O cadeado (HTTPS) é
            renovado sozinho. O endereço de antes continua funcionando. Na primeira vez no endereço novo, cada
            pessoa entra de novo com e-mail e senha.
          </p>
          {dom.ativoEm && <p className="quieto dominio-texto">Ativo desde {fmtQuando(dom.ativoEm)}.</p>}
          {d.podeEditar && (
            <div className="acoes">
              <Button size="sm" onClick={() => setTrocando(true)}>
                Trocar endereço
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTirando(true)}>
                Tirar domínio
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Assistente
          dados={d}
          aoAtualizar={atualizar}
          aoTrocar={() => setTrocando(true)}
          aoDesistir={() => setTirando(true)}
        />
      )}
      {tirando && dom && (
        <Modal
          titulo="Tirar o domínio próprio?"
          aoFechar={() => setTirando(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setTirando(false)}>
                Manter
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate()}>
                {tirar.isPending ? 'Tirando…' : 'Tirar domínio'}
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            O sistema deixa de abrir em <b className="mono">{dom.endereco}</b> e os links novos voltam a sair
            com o endereço do Prospect Team. Links já enviados com o seu endereço param de funcionar.
          </p>
          <p className="quieto" style={{ marginBottom: 0 }}>
            Depois, se quiser, apague o registro no DNS do seu domínio.
          </p>
          <ErroDaApi erro={tirar.error} />
        </Modal>
      )}
    </Panel>
  );
}

function EscolherEndereco(props: {
  atual: string | null;
  editar: boolean;
  aoSalvar: (r: DadosMarca) => void;
  aoCancelar?: () => void;
}) {
  const [endereco, setEndereco] = useState('');
  const definir = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio', { metodo: 'POST', corpo: { dominio: endereco } }),
    onSuccess: props.aoSalvar,
  });
  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (endereco.trim()) definir.mutate();
      }}
    >
      <div className="campo">
        <label htmlFor="mk-dominio">Endereço do sistema</label>
        <div className="dominio-linha">
          <input
            id="mk-dominio"
            className="filtro mono"
            placeholder="crm.suaempresa.com.br"
            autoComplete="off"
            spellCheck={false}
            value={endereco}
            disabled={!props.editar}
            onChange={(e) => setEndereco(e.target.value)}
          />
          {props.editar && (
            <Button variant="primary" type="submit" disabled={definir.isPending || !endereco.trim()}>
              {definir.isPending ? 'Preparando…' : 'Usar este endereço'}
            </Button>
          )}
        </div>
        <span className="campo__dica">
          Use um subdomínio do site da empresa (crm., sistema., app.). O site continua igual: só esse endereço
          novo passa a abrir o sistema.
          {props.atual ? ` Hoje: ${props.atual}.` : ''}
        </span>
      </div>
      <ErroDaApi erro={definir.error} />
      {props.aoCancelar && (
        <div className="acoes">
          <Button size="sm" variant="ghost" onClick={props.aoCancelar}>
            Cancelar
          </Button>
        </div>
      )}
    </form>
  );
}

const PROVEDORES = ['Registro.br', 'Cloudflare', 'Hostinger', 'GoDaddy', 'Outro'] as const;
type Provedor = (typeof PROVEDORES)[number];

/** O passo a passo de cada lugar onde o domínio costuma estar. */
function passos(p: Provedor, r: RegistroDns): ReactNode[] {
  const campos = (
    <>
      tipo <b>{r.tipo}</b>, nome <b className="mono">{r.nome}</b> e, no valor, o que está na tabela acima
    </>
  );
  switch (p) {
    case 'Registro.br':
      return [
        <>
          Entre em <b>registro.br</b> › seu domínio › <b>DNS</b> › <b>Editar zona</b> (modo avançado).
        </>,
        <>
          <b>Nova entrada</b>: {campos}.
        </>,
        <>
          <b>Salvar alterações</b> no fim da página. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'Cloudflare':
      return [
        <>
          Entre no <b>Cloudflare</b> › seu domínio › <b>DNS</b> › <b>Records</b> › <b>Add record</b>.
        </>,
        <>
          Preencha {campos}. Deixe a nuvem <b>cinza</b> (Proxy desligado, “DNS only”).
        </>,
        <>
          <b>Save</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'Hostinger':
      return [
        <>
          No <b>hPanel</b> › <b>Domínios</b> › seu domínio › <b>DNS / Nameservers</b>.
        </>,
        <>
          Em <b>Gerenciar registros DNS</b>, preencha {campos} (“Aponta para”). TTL pode ficar o padrão.
        </>,
        <>
          <b>Adicionar registro</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'GoDaddy':
      return [
        <>
          Em <b>Meus produtos</b> › seu domínio › <b>DNS</b> › <b>Adicionar novo registro</b>.
        </>,
        <>Preencha {campos}.</>,
        <>
          <b>Salvar</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    default:
      return [
        <>
          Abra o painel onde o domínio está registrado e procure <b>DNS</b>, <b>Zona DNS</b> ou{' '}
          <b>Gerenciar registros</b>.
        </>,
        <>Crie um registro novo com {campos}.</>,
        <>
          Salve. Se o painel completa o nome sozinho com o domínio, digite só <b className="mono">{r.nome}</b>
          .
        </>,
      ];
  }
}

/** Texto para mandar a quem cuida do site da empresa. */
function instrucoesEmTexto(endereco: string, registros: RegistroDns[]): string {
  const linhas = registros.map((r) => `- Tipo ${r.tipo} | Nome: ${r.nome} | Valor: ${r.valor}`);
  return [
    `Preciso que o endereço ${endereco} aponte para o nosso sistema comercial.`,
    'Por favor, crie no DNS do domínio:',
    ...linhas,
    '',
    'Não precisa apagar nada do que já existe (site e e-mail continuam iguais). Se usar Cloudflare, deixe o proxy desligado (nuvem cinza, "DNS only").',
  ].join('\n');
}

function Copiar(props: { valor: string; rotulo?: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={['link-botao', props.className].filter(Boolean).join(' ')}
      onClick={() => {
        void navigator.clipboard?.writeText(props.valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
    >
      {copiado ? 'Copiado' : (props.rotulo ?? 'Copiar')}
    </button>
  );
}

function Assistente(props: {
  dados: DadosMarca;
  aoAtualizar: (r: DadosMarca) => void;
  aoTrocar: () => void;
  aoDesistir: () => void;
}) {
  const dom = props.dados.dominio!;
  const [provedor, setProvedor] = useState<Provedor>('Registro.br');
  const conferir = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio/conferir', { metodo: 'POST' }),
    onSuccess: props.aoAtualizar,
  });
  const principal = dom.registros.find((r) => r.tipo !== 'TXT') ?? dom.registros[0];
  const txt = dom.registros.filter((r) => r.tipo === 'TXT');
  const semanaPassou = !!dom.desde && Date.now() - new Date(dom.desde).getTime() > 7 * 86_400_000;
  const editar = props.dados.podeEditar;
  return (
    <ol className="dominio-passos">
      <li className="dominio-passo dominio-passo--feito">
        <span className="dominio-passo__num" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
        <div className="dominio-passo__corpo">
          <b>1. Escolha o endereço</b>
          <div className="dominio-ativo">
            <span className="mono dominio-ativo__endereco">{dom.endereco}</span>
            {editar && (
              <button type="button" className="link-botao" onClick={props.aoTrocar}>
                Trocar
              </button>
            )}
          </div>
        </div>
      </li>
      <li className="dominio-passo">
        <span className="dominio-passo__num" aria-hidden="true">
          2
        </span>
        <div className="dominio-passo__corpo">
          <b>
            2. Crie {dom.registros.length > 1 ? 'estes registros' : 'este registro'} no DNS do seu domínio
          </b>
          <div className="dominio-tabela">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Nome</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {dom.registros.map((r) => (
                  <tr key={`${r.tipo}-${r.host}-${r.valor}`}>
                    <td className="mono">{r.tipo}</td>
                    <td>
                      <span className="mono">{r.nome}</span> <Copiar valor={r.nome} />
                    </td>
                    <td className="dominio-tabela__valor">
                      <span className="mono">{r.valor}</span> <Copiar valor={r.valor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txt.length > 0 && (
            <p className="quieto dominio-texto">
              O registro TXT prova que o endereço é seu (ele já foi usado em outro site). Crie os dois.
            </p>
          )}
          <p className="quieto dominio-texto" id="mk-provedor">
            Onde o seu domínio está?
          </p>
          <div className="chips-provedor" role="tablist" aria-labelledby="mk-provedor">
            {PROVEDORES.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={provedor === p}
                className={`chip-provedor${provedor === p ? ' chip-provedor--ativo' : ''}`}
                onClick={() => setProvedor(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {principal && (
            <ol className="dominio-instrucoes" role="tabpanel">
              {passos(provedor, principal).map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: passos fixos de cada provedor
                <li key={i}>{p}</li>
              ))}
              {txt.length > 0 && <li>Repita com o registro TXT da tabela.</li>}
            </ol>
          )}
          <p className="quieto dominio-texto">
            Não tem acesso ao DNS? Mande este passo a passo para quem cuida do site da empresa.{' '}
            <Copiar valor={instrucoesEmTexto(dom.endereco, dom.registros)} rotulo="Copiar instruções" />
          </p>
        </div>
      </li>
      <li className="dominio-passo">
        <span className="dominio-passo__num" aria-hidden="true">
          3
        </span>
        <div className="dominio-passo__corpo">
          <b>3. Conferência</b>
          <div className="dominio-conferencia">
            <Badge tone="warning">Aguardando o DNS</Badge>
            <span className="quieto dominio-texto">
              {semanaPassou
                ? 'Já passou uma semana: agora só conferimos quando você clica em Conferir agora.'
                : 'Conferimos sozinhos a cada 5 minutos e o domínio passa a valer assim que o DNS chegar (pode levar de minutos a algumas horas).'}
            </span>
            {editar && (
              <Button size="sm" disabled={conferir.isPending} onClick={() => conferir.mutate()}>
                {conferir.isPending ? 'Conferindo…' : 'Conferir agora'}
              </Button>
            )}
          </div>
          {dom.erro && (
            <p className="dominio-texto dominio-erro">
              {dom.erro}
              {dom.conferidoEm ? ` (conferido ${fmtQuando(dom.conferidoEm)})` : ''}
            </p>
          )}
          <ErroDaApi erro={conferir.error} />
          <p className="quieto dominio-texto">
            Enquanto isso, o sistema segue no endereço de sempre,{' '}
            <span className="mono">{location.host}</span>. Quando ativar, os dois funcionam e os links novos
            saem com o seu.
          </p>
          {editar && (
            <div className="acoes">
              <Button size="sm" variant="ghost" onClick={props.aoDesistir}>
                Desistir deste endereço
              </Button>
            </div>
          )}
        </div>
      </li>
    </ol>
  );
}
