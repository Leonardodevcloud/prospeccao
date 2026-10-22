import { Badge, Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type Chip } from '../api';
import { fmtHoraSo, fmtNumero, fmtQuando } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEhAdmin } from './Sessao';

interface TelaChips {
  chips: Chip[];
  /** Instância das credenciais (vale quando não há chip cadastrado). */
  padrao: string | null;
  conectado: boolean;
}

function situacao(c: Chip): { tom: 'brand' | 'danger' | 'neutral' | 'outline'; texto: string } {
  if (!c.ativo) return { tom: 'neutral', texto: 'Pausado' };
  if (c.pausadoAte) return { tom: 'danger', texto: `Pausado por falhas até ${fmtHoraSo(c.pausadoAte)}` };
  if (!c.estado) return { tom: 'outline', texto: 'Não conferido' };
  return c.estado.startsWith('ok')
    ? { tom: 'brand', texto: 'Conectado' }
    : { tom: 'danger', texto: 'Desconectado' };
}

function LinhaChip(props: { c: Chip; admin: boolean }) {
  const { c } = props;
  const cliente = useQueryClient();
  const [limite, setLimite] = useState(String(c.limiteDia));
  const [apagar, setApagar] = useState(false);
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
  const editar = useMutation({
    mutationFn: (d: { ativo?: boolean; limiteDia?: number; aquecer?: boolean }) =>
      api(`/agente/chips/${c.id}`, { metodo: 'PATCH', corpo: d }),
    onSuccess: atualizar,
  });
  const testar = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; resultado: string }>(`/agente/chips/${c.id}/testar`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const remover = useMutation({
    mutationFn: () => api(`/agente/chips/${c.id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const s = situacao(c);
  // Limite de hoje: o do chip, ou o do aquecimento se o número ainda é novo.
  const limiteHoje = c.tetoAquecimento != null ? Math.min(c.limiteDia, c.tetoAquecimento) : c.limiteDia;
  const usoPct = Math.min(100, Math.round((c.enviadosHoje / Math.max(1, limiteHoje)) * 100));
  return (
    <li className="chip-linha" data-inativo={!c.ativo || undefined}>
      <div className="chip-linha__quem">
        <b>{c.nome}</b>
        <span className="quieto mono">{c.instancia}</span>
      </div>
      <div className="chip-linha__uso">
        <span className="quieto">
          {fmtNumero(c.enviadosHoje)} de {fmtNumero(limiteHoje)} hoje
          {c.respostasHoje ? ` · ${fmtNumero(c.respostasHoje)} respostas` : ''} · {fmtNumero(c.leads)} leads
        </span>
        <span className="barra-uso" aria-hidden="true">
          <span style={{ width: `${usoPct}%` }} />
        </span>
      </div>
      <div className="chip-linha__estado">
        <Badge tone={s.tom}>{s.texto}</Badge>
        {c.tetoAquecimento != null && (
          <Badge tone="warning">
            Aquecendo · dia {c.diasDeUso + 1}, até {c.tetoAquecimento}/dia
          </Badge>
        )}
        {c.estado && !c.estado.startsWith('ok') && (
          <span className="quieto" title={c.estado}>
            {c.estado.slice(0, 60)}
          </span>
        )}
        {c.estadoEm && <span className="quieto">conferido {fmtQuando(c.estadoEm)}</span>}
      </div>
      {props.admin && (
        <div className="chip-linha__acoes">
          <label className="pp-sr" htmlFor={`chip-limite-${c.id}`}>
            Limite por dia do {c.nome}
          </label>
          <input
            id={`chip-limite-${c.id}`}
            className="filtro chip-linha__limite"
            inputMode="numeric"
            title="Mensagens automáticas por dia neste chip"
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
                ? 'Desliga o aquecimento: vale só o limite do chip (para número que já é usado há tempo)'
                : 'Liga o aquecimento: número novo manda pouco e vai subindo em 30 dias'
            }
            onClick={() => editar.mutate({ aquecer: !c.aquecer })}
          >
            {c.aquecer ? 'Sem aquecimento' : 'Aquecer'}
          </Button>
          {apagar ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={remover.isPending}
                onClick={() => remover.mutate()}
              >
                Apagar “{c.nome}”
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
              aria-label={`Apagar ${c.nome}`}
              onClick={() => setApagar(true)}
            />
          )}
        </div>
      )}
      {c.pausadoAte && c.pausaMotivo && <span className="chip-pausa">{c.pausaMotivo}</span>}
      {testar.data && <Mensagem tipo={testar.data.ok ? 'ok' : 'aviso'}>{testar.data.resultado}</Mensagem>}
      <ErroDaApi erro={editar.error ?? testar.error ?? remover.error} />
    </li>
  );
}

/**
 * Chips de WhatsApp da conta: cada um é uma instância da Evolution, com o seu limite de mensagens
 * automáticas por dia. O lead novo vai para o chip menos usado hoje e conversa sempre pelo mesmo.
 */
export function Chips() {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ nome: '', instancia: '', limiteDia: '40', novo: true });
  const q = useQuery({
    queryKey: ['agente', 'chips'],
    queryFn: () => api<TelaChips>('/agente/chips'),
    refetchInterval: 60_000,
  });
  const criar = useMutation({
    mutationFn: () =>
      api('/agente/chips', {
        metodo: 'POST',
        corpo: {
          nome: f.nome,
          instancia: f.instancia,
          limiteDia: Number(f.limiteDia) || 40,
          aquecer: f.novo,
        },
      }),
    onSuccess: () => {
      setF({ nome: '', instancia: '', limiteDia: '40', novo: true });
      setNovo(false);
      cliente.invalidateQueries({ queryKey: ['agente', 'chips'] });
    },
  });
  const d = q.data;

  return (
    <Panel
      titulo="Chips de WhatsApp"
      acoes={
        admin && !novo ? (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setNovo(true)}>
            Adicionar chip
          </Button>
        ) : undefined
      }
    >
      <ErroDaApi erro={q.error} />
      {d && !d.conectado && (
        <Mensagem tipo="aviso">
          A Evolution desta conta não está configurada (endereço e chave no painel master): os chips não
          enviam.
        </Mensagem>
      )}
      {d && !d.chips.length && (
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          {d.padrao ? (
            <>
              Hoje a conta usa um chip só, a instância <b className="mono">{d.padrao}</b>, com o limite do dia
              acima. Cadastre os chips (inclusive este) para dividir o volume: cada um com o seu limite, e o
              lead sempre no mesmo número.
            </>
          ) : (
            'Nenhum chip ainda.'
          )}
        </p>
      )}
      {d && d.chips.length > 0 && (
        <ul className="chips-lista">
          {d.chips.map((c) => (
            <LinhaChip key={c.id} c={c} admin={admin} />
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
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="chip-nome">Nome</label>
              <input
                id="chip-nome"
                className="filtro"
                maxLength={60}
                placeholder="Ex.: Comercial 2"
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="chip-instancia">Instância na Evolution</label>
              <input
                id="chip-instancia"
                className="filtro mono"
                maxLength={100}
                placeholder="comercial2"
                value={f.instancia}
                onChange={(e) => setF({ ...f, instancia: e.target.value.trim() })}
              />
              <span className="campo__dica">O nome exato da instância, como aparece na Evolution.</span>
            </div>
          </div>
          <div className="campo" style={{ maxWidth: 220 }}>
            <label htmlFor="chip-limite">Mensagens automáticas por dia</label>
            <input
              id="chip-limite"
              className="filtro"
              inputMode="numeric"
              value={f.limiteDia}
              onChange={(e) => setF({ ...f, limiteDia: e.target.value.replace(/\D/g, '') })}
            />
            <span className="campo__dica">Mensagens frias (respostas a quem escreveu não contam).</span>
          </div>
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.novo}
              onChange={(e) => setF({ ...f, novo: e.target.checked })}
            />
            Número novo: aquecer aos poucos (começa com 10 por dia e dobra a cada semana; depois de 30 dias
            vale o limite acima)
          </label>
          <ErroDaApi erro={criar.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={criar.isPending || !f.nome.trim() || !f.instancia}
            >
              Cadastrar chip
            </Button>
            <Button variant="ghost" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
        <Icon name="link" size={12} /> Em cada instância da Evolution, use o mesmo webhook desta conta
        (abaixo): o sistema sabe por qual chip a mensagem chegou. Mensagens da equipe não contam no limite.
      </p>
      <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
        Ritmo contra bloqueio: só dentro do horário do agente; entre uma mensagem fria e outra, o intervalo
        mais uma variação aleatória de até 60%; resposta a quem escreveu sai antes das frias, com “digitando…”
        e em mensagens curtas; o lead conversa sempre pelo mesmo número.
      </p>
    </Panel>
  );
}
