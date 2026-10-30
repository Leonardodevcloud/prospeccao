import { Badge, Button, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type Chip, type ContatoDeAntes, type ContatoNovoChip } from '../api';
import { fmtHoraSo, fmtNumero, fmtQuando } from '../formatar';
import { LinkAjuda } from './Ajuda';
import { Modal } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEhAdmin, useEhMaster, useEquipe } from './Sessao';

interface TelaChips {
  chips: Chip[];
  /** O WhatsApp está no plano da conta (dá para conectar números). */
  conectado: boolean;
  /** Quantos números a conta pode conectar (null: sem limite) e quantos já tem. */
  limite: number | null;
  usados: number;
}

const conectado = (c: Chip) => !!c.estado?.startsWith('ok');

function situacao(c: Chip): { tom: 'brand' | 'danger' | 'neutral' | 'outline' | 'warning'; texto: string } {
  if (!c.conectavel) return { tom: 'warning', texto: 'Conecte de novo' };
  if (!conectado(c) && c.estado?.startsWith('desconectado') && !c.numero)
    return { tom: 'outline', texto: 'Falta ler o QR Code' };
  if (!c.ativo) return { tom: 'neutral', texto: 'Pausado' };
  if (c.pausadoAte) return { tom: 'danger', texto: `Pausado por falhas até ${fmtHoraSo(c.pausadoAte)}` };
  if (!c.estado) return { tom: 'outline', texto: 'Não conferido' };
  return conectado(c) ? { tom: 'brand', texto: 'Conectado' } : { tom: 'danger', texto: 'Desconectado' };
}

/** 5571999998888 → (71) 99999-8888 */
export function fmtNumeroWhatsapp(n: string | null): string | null {
  if (!n) return null;
  const d = n.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const m = d.match(/^(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : n;
}

/**
 * QR Code para o cliente ler no celular. Pede de novo a cada poucos segundos (o código do WhatsApp
 * muda) até conectar.
 */
function ConectarNumero(props: {
  chip: Pick<Chip, 'id' | 'nome'>;
  usoDiario?: boolean;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['agente', 'chips', props.chip.id, 'qr'],
    queryFn: () => api<{ conectado: boolean; imagem: string | null }>(`/agente/chips/${props.chip.id}/qr`),
    refetchInterval: (r) => (r.state.data?.conectado ? false : 4_000),
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
  const pronto = !!q.data?.conectado;
  useEffect(() => {
    if (pronto) cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
  }, [pronto, cliente]);

  return (
    <Modal
      titulo={pronto ? 'Número conectado' : `Conectar “${props.chip.nome}”`}
      subtitulo={pronto ? undefined : 'Leia o código com o celular do número que vai prospectar.'}
      aoFechar={props.aoFechar}
      rodape={
        <Button variant={pronto ? 'primary' : 'ghost'} onClick={props.aoFechar}>
          {pronto ? 'Concluir' : 'Fazer depois'}
        </Button>
      }
    >
      {pronto ? (
        <Mensagem tipo="ok">
          Pronto! O WhatsApp está conectado. As mensagens do agente e das sequências já podem sair por este
          número.
          {props.usoDiario &&
            ' Agora estamos separando as conversas que já existiam: elas continuam só no celular, sem lead e sem IA. Leva alguns minutos.'}
        </Mensagem>
      ) : (
        <div className="qr-conectar">
          <div className="qr-conectar__codigo" aria-live="polite">
            {q.data?.imagem ? (
              <img src={q.data.imagem} alt="QR Code para conectar o WhatsApp" width={240} height={240} />
            ) : q.error ? (
              <ErroDaApi erro={q.error} />
            ) : (
              <div className="esqueleto qr-conectar__espera" role="status" aria-label="Gerando o QR Code" />
            )}
          </div>
          <ol className="qr-conectar__passos">
            <li>Abra o WhatsApp no celular.</li>
            <li>
              Toque em <b>⋮ Mais opções</b> (Android) ou <b>Configurações</b> (iPhone) e depois em{' '}
              <b>Dispositivos conectados</b>.
            </li>
            <li>
              Toque em <b>Conectar dispositivo</b> e aponte a câmera para o código.
            </li>
          </ol>
          <p className="quieto" style={{ margin: 0, fontSize: 12, gridColumn: '1 / -1' }}>
            O código se renova sozinho. Use um número de WhatsApp Business de preferência, e deixe o celular
            com internet: o WhatsApp precisa dele ligado de vez em quando para manter a conexão.
          </p>
        </div>
      )}
    </Modal>
  );
}

const REGRAS_CONTATO_NOVO: { valor: ContatoNovoChip; rotulo: string; dica: string }[] = [
  {
    valor: 'ignorar',
    rotulo: 'Fica só no celular',
    dica: 'Não entra no CRM. Bom para número pessoal ou de clientes antigos.',
  },
  {
    valor: 'sem_lead',
    rotulo: 'Vai para “Sem lead”',
    dica: 'Aparece em Conversas › Sem lead para alguém decidir. A IA não responde.',
  },
  { valor: 'lead', rotulo: 'Vira lead', dica: 'Entra no funil em “A abordar”, sem a IA.' },
  {
    valor: 'padrao',
    rotulo: 'Como no resto da conta',
    dica: 'Segue a regra escolhida em Conversas › Sem lead.',
  },
];

const ORIGEM_DE_ANTES: Record<ContatoDeAntes['origem'], string> = {
  conversa: 'Conversa que já existia',
  celular: 'A equipe puxou pelo celular',
  ignorado: 'Escreveu pela primeira vez',
};

/** Lista dos contatos que ficam só no celular, com “Trazer para o CRM”. */
function ConversasDeAntes(props: { chip: Chip; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const chave = ['agente', 'chips', props.chip.id, 'de-antes', termo];
  const q = useQuery({
    queryKey: chave,
    queryFn: () =>
      api<ContatoDeAntes[]>(
        `/agente/chips/${props.chip.id}/de-antes${termo ? `?busca=${encodeURIComponent(termo)}` : ''}`,
      ),
  });
  const trazer = useMutation({
    mutationFn: (telefone: string) =>
      api(`/agente/chips/${props.chip.id}/de-antes/${telefone}/trazer`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
    },
  });
  const lista = q.data ?? [];
  return (
    <Modal
      titulo={`Conversas de antes · ${props.chip.nome}`}
      subtitulo="Estes contatos falam com vocês só pelo celular: não viram lead, não aparecem em “Sem lead” e a IA não responde."
      largura="larga"
      aoFechar={props.aoFechar}
      rodape={
        <Button variant="ghost" onClick={props.aoFechar}>
          Fechar
        </Button>
      }
    >
      <div className="campo" style={{ maxWidth: 360 }}>
        <label htmlFor="de-antes-busca">Buscar por nome ou número</label>
        <input
          id="de-antes-busca"
          className="filtro"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Ex.: Maria ou 9999-8888"
        />
      </div>
      <ErroDaApi erro={q.error ?? trazer.error} />
      {q.isLoading ? (
        <div className="esqueleto" style={{ height: 120 }} role="status" aria-label="Carregando" />
      ) : lista.length === 0 ? (
        <p className="quieto" style={{ margin: 0 }}>
          {termo
            ? 'Ninguém com esse nome ou número.'
            : 'Nenhum contato separado ainda. Se o número acabou de conectar, espere alguns minutos.'}
        </p>
      ) : (
        <ul className="de-antes">
          {lista.map((c) => (
            <li key={c.telefone} className="de-antes__item" data-trazido={!!c.trazidoEm || undefined}>
              <div className="de-antes__quem">
                <b>{c.nome || fmtNumeroWhatsapp(c.telefone)}</b>
                <span className="quieto">
                  {c.nome && `${fmtNumeroWhatsapp(c.telefone)} · `}
                  {ORIGEM_DE_ANTES[c.origem]}
                  {c.ultimaEm && ` · última conversa ${fmtQuando(c.ultimaEm)}`}
                </span>
              </div>
              {c.trazidoEm ? (
                <Badge tone="brand">No CRM desde {fmtQuando(c.trazidoEm)}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="plus"
                  disabled={trazer.isPending}
                  title="A próxima mensagem desse contato entra no CRM normalmente"
                  onClick={() => trazer.mutate(c.telefone)}
                >
                  Trazer para o CRM
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {lista.length >= 300 && (
        <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
          Mostrando os 300 mais recentes. Use a busca para achar os outros.
        </p>
      )}
    </Modal>
  );
}

/** Número que já era usado no dia a dia: o que fica fora do CRM e o que fazer com quem é novo. */
function UsoDiario(props: { c: Chip; ligado: boolean }) {
  const { c } = props;
  const cliente = useQueryClient();
  const [ver, setVer] = useState(false);
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
  const editar = useMutation({
    mutationFn: (d: { usoDiario?: boolean; contatoNovo?: ContatoNovoChip }) =>
      api(`/agente/chips/${c.id}`, { metodo: 'PATCH', corpo: d }),
    onSuccess: atualizar,
  });
  const ler = useMutation({
    mutationFn: () => api(`/agente/chips/${c.id}/ler-conversas`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const lendo = c.contatosLeitura === 'lendo';
  const erro = c.contatosLeitura?.startsWith('erro') ? c.contatosLeitura.replace(/^erro:\s*/, '') : null;
  const regra = REGRAS_CONTATO_NOVO.find((r) => r.valor === c.contatoNovo);
  return (
    <div className="chip-dia">
      <label className="chip-dia__liga">
        <input
          type="checkbox"
          checked={c.usoDiario}
          disabled={editar.isPending}
          onChange={(e) => editar.mutate({ usoDiario: e.target.checked })}
        />
        <span>
          <b>Número de uso diário</b>
          <span className="quieto">
            {' '}
            · já conversava com clientes antes. Essas conversas ficam só no celular: sem lead, sem IA.
          </span>
        </span>
      </label>
      {c.usoDiario && (
        <div className="chip-dia__corpo">
          <div className="campo chip-dia__regra">
            <label htmlFor={`chip-novo-${c.id}`}>Quem escrever pela primeira vez</label>
            <select
              id={`chip-novo-${c.id}`}
              className="filtro"
              value={c.contatoNovo}
              disabled={editar.isPending}
              onChange={(e) => editar.mutate({ contatoNovo: e.target.value as ContatoNovoChip })}
            >
              {REGRAS_CONTATO_NOVO.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.rotulo}
                </option>
              ))}
            </select>
            {regra && <span className="campo__dica">{regra.dica}</span>}
          </div>
          <div className="chip-dia__estado">
            {lendo ? (
              <span role="status">Separando as conversas que já existiam…</span>
            ) : erro ? (
              <span className="chip-pausa">Não deu para ler as conversas: {erro}</span>
            ) : c.contatosLidosEm ? (
              <span>
                <b>{fmtNumero(c.contatosDeAntes)}</b>{' '}
                {c.contatosDeAntes === 1 ? 'contato fica' : 'contatos ficam'} só no celular
                <span className="quieto"> · lido {fmtQuando(c.contatosLidosEm)}</span>
              </span>
            ) : (
              <span className="quieto">
                {props.ligado
                  ? 'As conversas ainda não foram lidas.'
                  : 'Assim que conectar, as conversas que já existem são separadas.'}
              </span>
            )}
            <span className="chip-dia__botoes">
              <Button size="sm" variant="ghost" onClick={() => setVer(true)}>
                Ver contatos de antes
              </Button>
              {props.ligado && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lendo || ler.isPending}
                  title="Lê de novo as conversas do celular (não traz de volta quem você já trouxe para o CRM)"
                  onClick={() => ler.mutate()}
                >
                  {c.contatosLidosEm ? 'Ler de novo' : 'Ler agora'}
                </Button>
              )}
              <LinkAjuda artigo="whatsapp-uso-diario">Como funciona</LinkAjuda>
            </span>
          </div>
        </div>
      )}
      <ErroDaApi erro={editar.error ?? ler.error} />
      {ver && <ConversasDeAntes chip={c} aoFechar={() => setVer(false)} />}
    </div>
  );
}

function LinhaChip(props: { c: Chip; admin: boolean; master: boolean; conectar: (c: Chip) => void }) {
  const { c } = props;
  const cliente = useQueryClient();
  const equipe = useEquipe();
  const [limite, setLimite] = useState(String(c.limiteDia));
  const [apagar, setApagar] = useState(false);
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
  const editar = useMutation({
    mutationFn: (d: { ativo?: boolean; limiteDia?: number; aquecer?: boolean; usuarioId?: number | null }) =>
      api(`/agente/chips/${c.id}`, { metodo: 'PATCH', corpo: d }),
    onSuccess: atualizar,
  });
  const testar = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; resultado: string }>(`/agente/chips/${c.id}/testar`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const desconectar = useMutation({
    mutationFn: () => api(`/agente/chips/${c.id}/desconectar`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const remover = useMutation({
    mutationFn: () => api(`/agente/chips/${c.id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const s = situacao(c);
  const ligado = c.conectavel && conectado(c);
  // Limite de hoje: o do número, ou o do aquecimento se o número ainda é novo.
  const limiteHoje = c.tetoAquecimento != null ? Math.min(c.limiteDia, c.tetoAquecimento) : c.limiteDia;
  const usoPct = Math.min(100, Math.round((c.enviadosHoje / Math.max(1, limiteHoje)) * 100));
  return (
    <li className="chip-linha" data-inativo={(ligado && !c.ativo) || undefined}>
      <div className="chip-linha__quem">
        <b>{c.nome}</b>
        {c.numero && <span className="quieto">{fmtNumeroWhatsapp(c.numero)}</span>}
        {props.master && <span className="quieto mono">{c.instancia}</span>}
        {props.admin ? (
          <span className="chip-linha__dono">
            <label htmlFor={`chip-dono-${c.id}`} className="quieto">
              De quem é
            </label>
            <select
              id={`chip-dono-${c.id}`}
              className="filtro"
              value={c.usuarioId ?? ''}
              disabled={editar.isPending}
              title="Número próprio de um comercial: os leads novos que chegam por ele ficam com essa pessoa"
              onChange={(e) => editar.mutate({ usuarioId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Número da equipe</option>
              {equipe.data?.usuarios
                .filter((u) => u.ativo || u.id === c.usuarioId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
            </select>
          </span>
        ) : (
          c.usuarioNome && <span className="quieto">Número de {c.usuarioNome}</span>
        )}
      </div>
      {ligado || c.numero ? (
        <div className="chip-linha__uso">
          <span className="quieto">
            {fmtNumero(c.enviadosHoje)} de {fmtNumero(limiteHoje)} hoje
            {c.respostasHoje ? ` · ${fmtNumero(c.respostasHoje)} respostas` : ''} · {fmtNumero(c.leads)} leads
          </span>
          <span className="barra-uso" aria-hidden="true">
            <span style={{ width: `${usoPct}%` }} />
          </span>
        </div>
      ) : (
        <span className="quieto">Ainda não conectado: leia o QR Code com o celular.</span>
      )}
      <div className="chip-linha__estado">
        <Badge tone={s.tom}>{s.texto}</Badge>
        {ligado && c.tetoAquecimento != null && (
          <Badge tone="warning">
            Aquecendo · dia {c.diasDeUso + 1}, até {c.tetoAquecimento}/dia
          </Badge>
        )}
        {c.estadoEm && (ligado || c.numero) && (
          <span className="quieto">conferido {fmtQuando(c.estadoEm)}</span>
        )}
      </div>
      {props.admin && (
        <div className="chip-linha__acoes">
          {c.conectavel && !ligado && (
            <Button size="sm" variant="primary" icon="message-circle" onClick={() => props.conectar(c)}>
              Ler QR Code
            </Button>
          )}
          {ligado && (
            <>
              <label className="pp-sr" htmlFor={`chip-limite-${c.id}`}>
                Limite por dia do {c.nome}
              </label>
              <input
                id={`chip-limite-${c.id}`}
                className="filtro chip-linha__limite"
                inputMode="numeric"
                title="Mensagens automáticas por dia neste número"
                value={limite}
                onChange={(e) => setLimite(e.target.value.replace(/\D/g, ''))}
                onBlur={() => {
                  const n = Number(limite);
                  if (n >= 1 && n !== c.limiteDia) editar.mutate({ limiteDia: n });
                  else setLimite(String(c.limiteDia));
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                icon="check"
                disabled={testar.isPending}
                onClick={() => testar.mutate()}
              >
                {testar.isPending ? 'Conferindo…' : 'Conferir'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={editar.isPending}
                onClick={() => editar.mutate({ ativo: !c.ativo || !!c.pausadoAte })}
              >
                {c.pausadoAte ? 'Retomar agora' : c.ativo ? 'Pausar' : 'Reativar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={editar.isPending}
                title={
                  c.aquecer
                    ? 'Desliga o aquecimento: vale só o limite do número (para número que já é usado há tempo)'
                    : 'Liga o aquecimento: número novo manda pouco e vai subindo em 30 dias'
                }
                onClick={() => editar.mutate({ aquecer: !c.aquecer })}
              >
                {c.aquecer ? 'Sem aquecimento' : 'Aquecer'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={desconectar.isPending}
                title="Para trocar de celular ou de número: depois é só ler o QR Code de novo"
                onClick={() => desconectar.mutate()}
              >
                Desconectar
              </Button>
            </>
          )}
          {apagar ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={remover.isPending}
                onClick={() => remover.mutate()}
              >
                Remover “{c.nome}”
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setApagar(false)}>
                Manter
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              aria-label={`Remover ${c.nome}`}
              title="Remover o número"
              onClick={() => setApagar(true)}
            />
          )}
        </div>
      )}
      {!c.conectavel && (
        <span className="chip-pausa">
          Este número era do sistema antigo. Remova e conecte de novo em “Conectar número”, lendo o QR Code.
        </span>
      )}
      {apagar && (
        <span className="chip-pausa">
          O número para de enviar e receber pelo sistema. As conversas que já aconteceram continuam no
          histórico.
        </span>
      )}
      {c.pausadoAte && c.pausaMotivo && <span className="chip-pausa">{c.pausaMotivo}</span>}
      {props.admin && c.conectavel && <UsoDiario c={c} ligado={ligado} />}
      {testar.data && (
        <Mensagem tipo={testar.data.ok ? 'ok' : 'aviso'}>
          {testar.data.ok ? 'Conectado.' : 'Desconectado: leia o QR Code de novo.'}
        </Mensagem>
      )}
      <ErroDaApi erro={editar.error ?? testar.error ?? remover.error ?? desconectar.error} />
    </li>
  );
}

/**
 * Números de WhatsApp da conta. O próprio cliente conecta: dá um nome, lê o QR Code no celular e
 * pronto. Cada número tem o seu limite de mensagens automáticas por dia; o lead novo vai para o
 * número menos usado hoje e conversa sempre pelo mesmo.
 */
export function Chips() {
  const admin = useEhAdmin();
  const master = useEhMaster();
  const cliente = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState('');
  const [usoDiario, setUsoDiario] = useState<boolean | null>(null);
  const [qr, setQr] = useState<(Pick<Chip, 'id' | 'nome'> & { usoDiario?: boolean }) | null>(null);
  const q = useQuery({
    queryKey: ['agente', 'chips'],
    queryFn: () => api<TelaChips>('/agente/chips'),
    refetchInterval: 60_000,
  });
  const criar = useMutation({
    mutationFn: async () => {
      const r = await api<{ id: number }>('/agente/chips', { metodo: 'POST', corpo: { nome } });
      if (usoDiario) await api(`/agente/chips/${r.id}`, { metodo: 'PATCH', corpo: { usoDiario: true } });
      return r;
    },
    onSuccess: (r) => {
      setQr({ id: r.id, nome: nome.trim(), usoDiario: !!usoDiario });
      setNome('');
      setUsoDiario(null);
      setNovo(false);
      cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
    },
  });
  const d = q.data;
  const noLimite = !!d && d.limite != null && d.usados >= d.limite;

  return (
    <Panel
      titulo="Números de WhatsApp"
      acoes={
        admin && d?.conectado && !novo && !noLimite ? (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setNovo(true)}>
            Conectar número
          </Button>
        ) : undefined
      }
    >
      <ErroDaApi erro={q.error} />
      {d && !d.conectado && (
        <Mensagem tipo="aviso">
          {master
            ? 'Falta a Z-API da plataforma (ZAPI_PARCEIRO_TOKEN) ou o WhatsApp não está no plano desta conta.'
            : 'O WhatsApp não está no seu plano. Fale com o suporte do Prospect Team para incluir.'}
        </Mensagem>
      )}
      {d?.conectado && !d.chips.length && !novo && (
        <div className="vazio-acao">
          <p style={{ margin: 0 }}>
            Conecte o WhatsApp que vai prospectar: dê um nome e leia o QR Code com o celular, como no WhatsApp
            Web. Leva um minuto.
          </p>
          {admin ? (
            <Button variant="primary" icon="message-circle" onClick={() => setNovo(true)}>
              Conectar número
            </Button>
          ) : (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Peça a um administrador da sua conta para conectar.
            </p>
          )}
        </div>
      )}
      {d && d.chips.length > 0 && (
        <ul className="chips-lista">
          {d.chips.map((c) => (
            <LinhaChip key={c.id} c={c} admin={admin} master={master} conectar={setQr} />
          ))}
        </ul>
      )}
      {novo && (
        <form
          className="form caixa"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <div className="campo" style={{ maxWidth: 360 }}>
            <label htmlFor="chip-nome">Nome do número</label>
            <input
              id="chip-nome"
              className="filtro"
              maxLength={60}
              placeholder="Ex.: Comercial Ana"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: o formulário abre por um clique em "Conectar número".
              autoFocus
            />
            <span className="campo__dica">Só para você saber qual é qual. Em seguida aparece o QR Code.</span>
          </div>
          <fieldset className="campo chip-pergunta">
            <legend>Este número já é usado no dia a dia?</legend>
            <label className="chip-pergunta__opcao">
              <input
                type="radio"
                name="chip-uso"
                checked={usoDiario === true}
                onChange={() => setUsoDiario(true)}
              />
              <span>
                <b>Sim, já converso com clientes por ele</b>
                <span className="quieto">
                  As conversas que já existem ficam só no celular: não viram lead e a IA não responde. Depois
                  você escolhe o que fazer com quem escrever pela primeira vez.
                </span>
              </span>
            </label>
            <label className="chip-pergunta__opcao">
              <input
                type="radio"
                name="chip-uso"
                checked={usoDiario === false}
                onChange={() => setUsoDiario(false)}
              />
              <span>
                <b>Não, é um número só para prospectar</b>
                <span className="quieto">Toda conversa entra no CRM pela regra da conta.</span>
              </span>
            </label>
          </fieldset>
          <ErroDaApi erro={criar.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={criar.isPending || nome.trim().length < 2 || usoDiario === null}
            >
              {criar.isPending ? 'Gerando o QR Code…' : 'Continuar'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setNovo(false);
                setUsoDiario(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {d?.conectado && d.limite != null && (
        <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
          {fmtNumero(d.usados)} de {fmtNumero(d.limite)} {d.limite === 1 ? 'número' : 'números'} do seu plano
          {noLimite && ' · para conectar mais, fale com o suporte do Prospect Team'}.
        </p>
      )}
      <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
        Mensagens que alguém da equipe manda não contam no limite. Ritmo contra bloqueio: só dentro do horário
        do agente; entre uma mensagem fria e outra, o intervalo mais uma variação aleatória de até 60%;
        resposta a quem escreveu sai antes das frias, com “digitando…” e em mensagens curtas; o lead conversa
        sempre pelo mesmo número; número novo começa devagar (aquecimento de 30 dias).{' '}
        <LinkAjuda artigo="whatsapp-numeros">Saiba mais</LinkAjuda>
      </p>
      {qr && <ConectarNumero chip={qr} usoDiario={qr.usoDiario} aoFechar={() => setQr(null)} />}
    </Panel>
  );
}
