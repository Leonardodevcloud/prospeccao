import {
  LISTA_MODULOS,
  MODULOS,
  type Modulo,
  PLANOS,
  type Plano,
  PRECO_USUARIO_ADICIONAL,
  planoEfetivo,
} from '@prospeccao/shared/planos';
import { Badge, Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type PlanoConta } from '../api';
import { fmtData, fmtNumero, fmtReais } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

export const ROTULO_PLANO: Record<Plano, string> = {
  start: 'Start',
  time: 'Time',
  escala: 'Escala',
  personalizado: 'Personalizado',
};

/** Barra de uso: "3 de 4" (sem limite: só o número). */
export function UsoComLimite(props: {
  rotulo: string;
  usado: number;
  limite: number | null;
  detalhe?: string;
}) {
  const pct = props.limite ? Math.min(100, Math.round((props.usado / Math.max(1, props.limite)) * 100)) : 0;
  const tom = !props.limite ? '' : pct >= 100 ? 'cheio' : pct >= 90 ? 'quase' : '';
  return (
    <div className="uso-plano" data-tom={tom || undefined}>
      <div className="uso-plano__topo">
        <span>{props.rotulo}</span>
        <b className="mono">
          {fmtNumero(props.usado)}
          {props.limite != null ? (
            <span className="quieto"> de {fmtNumero(props.limite)}</span>
          ) : (
            ' · sem limite'
          )}
        </b>
      </div>
      {props.limite != null && (
        <span className="barra-uso" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {props.detalhe && <span className="quieto uso-plano__detalhe">{props.detalhe}</span>}
    </div>
  );
}

/** O que a conta contratou e quanto já usou no mês (tela do cliente e painel master). */
export function ResumoPlano(props: { p: PlanoConta; contato?: boolean }) {
  const { p } = props;
  if (!p.plano)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Conta sem plano: sem limite de usuários e de leads, com todos os módulos.
      </p>
    );
  return (
    <div className="pilha" style={{ gap: 12 }}>
      <div className="plano-cabeca">
        <div>
          <span className="plano-cabeca__nome">Plano {ROTULO_PLANO[p.plano]}</span>
          {p.planoDesde && <span className="quieto"> · desde {fmtData(p.planoDesde)}</span>}
        </div>
        {p.mensalidade != null && (
          <span className="plano-cabeca__preco">
            {fmtReais(p.mensalidade)}
            <span className="quieto">/mês</span>
          </span>
        )}
      </div>
      <div className="plano-usos">
        <UsoComLimite rotulo="Usuários ativos" usado={p.uso.usuarios} limite={p.usuarios} />
        <UsoComLimite
          rotulo="Leads enriquecidos neste mês"
          usado={p.uso.leadsMes}
          limite={p.leadsMes}
          detalhe={
            p.uso.leadsEsperando
              ? `${fmtNumero(p.uso.leadsEsperando)} esperando o limite (entram sozinhos no próximo mês ou com plano maior)`
              : undefined
          }
        />
      </div>
      <ul className="plano-modulos">
        {LISTA_MODULOS.map((m) => {
          const tem = p.modulos.includes(m);
          return (
            <li key={m} className="plano-modulos__item" data-ativo={tem || undefined}>
              <Badge tone={tem ? 'brand' : 'outline'}>{tem ? 'Contratado' : 'Não contratado'}</Badge>
              <span>
                <b>{MODULOS[m].nome}</b>
                <span className="quieto"> · {MODULOS[m].descricao}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {props.contato && (
        <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
          Para mudar de plano, aumentar usuários ou leads, ou contratar um módulo, fale com a gente.
        </p>
      )}
    </div>
  );
}

const numeroOuNulo = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\D/g, '')));

/**
 * Painel master: escolhe o plano da conta e, se quiser, troca os números só para ela (mais ou
 * menos usuários e leads), liga os módulos e combina a mensalidade.
 */
export function FormPlano(props: { contaId: number; p: PlanoConta }) {
  const cliente = useQueryClient();
  const inicial = () => ({
    plano: (props.p.plano ?? '') as Plano | '',
    usuarios: props.p.limiteUsuariosProprio != null ? String(props.p.limiteUsuariosProprio) : '',
    leads: props.p.limiteLeadsProprio != null ? String(props.p.limiteLeadsProprio) : '',
    modulos: props.p.plano ? [...props.p.modulos] : ([] as Modulo[]),
    manual: props.p.mensalidadeManual != null ? String(props.p.mensalidadeManual).replace('.', ',') : '',
  });
  const [f, setF] = useState(inicial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recarrega quando o servidor devolve o plano salvo
  useEffect(() => setF(inicial()), [props.p]);
  const salvar = useMutation({
    mutationFn: () =>
      api<PlanoConta>(`/master/contas/${props.contaId}/plano`, {
        metodo: 'PUT',
        corpo: {
          plano: f.plano || null,
          limiteUsuarios: numeroOuNulo(f.usuarios),
          limiteLeadsMes: numeroOuNulo(f.leads),
          modulos: f.modulos,
          mensalidadeManual: f.manual.trim() ? Number(f.manual.replace(/\./g, '').replace(',', '.')) : null,
        },
      }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master'] }),
  });
  const base = f.plano ? PLANOS[f.plano] : null;
  const previa = planoEfetivo({
    plano: f.plano || null,
    limiteUsuarios: numeroOuNulo(f.usuarios),
    limiteLeadsMes: numeroOuNulo(f.leads),
    modulos: f.modulos,
    mensalidadeManual: null,
  });
  const alternar = (m: Modulo, ligado: boolean) =>
    setF((x) => {
      let mods = ligado ? [...new Set([...x.modulos, m])] : x.modulos.filter((y) => y !== m);
      // O agente conversa pelo WhatsApp: liga junto; sem WhatsApp, o agente sai.
      if (m === 'agente_ia' && ligado && !mods.includes('whatsapp')) mods = [...mods, 'whatsapp'];
      if (m === 'whatsapp' && !ligado) mods = mods.filter((y) => y !== 'agente_ia');
      return { ...x, modulos: mods };
    });

  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <fieldset className="planos-escolha" aria-label="Plano">
        {(['start', 'time', 'escala', 'personalizado'] as Plano[]).map((id) => (
          <label key={id} className="plano-opcao" data-ativo={f.plano === id || undefined}>
            <input
              type="radio"
              name="plano"
              checked={f.plano === id}
              onChange={() => setF({ ...f, plano: id })}
            />
            <b>{ROTULO_PLANO[id]}</b>
            {id === 'personalizado' ? (
              <span className="quieto">Números e preço combinados</span>
            ) : (
              <>
                <span className="plano-opcao__preco">{fmtReais(PLANOS[id].preco)}/mês</span>
                <span className="quieto">
                  {PLANOS[id].usuarios} usuários · {fmtNumero(PLANOS[id].leadsMes)} leads/mês
                </span>
              </>
            )}
          </label>
        ))}
        <label className="plano-opcao" data-ativo={f.plano === '' || undefined}>
          <input
            type="radio"
            name="plano"
            checked={f.plano === ''}
            onChange={() => setF({ ...f, plano: '' })}
          />
          <b>Sem plano</b>
          <span className="quieto">Sem limites e todos os módulos (uso interno)</span>
        </label>
      </fieldset>

      {f.plano && (
        <>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="pl-usuarios">Usuários</label>
              <input
                id="pl-usuarios"
                className="filtro"
                inputMode="numeric"
                placeholder={
                  base && f.plano !== 'personalizado' ? `${base.usuarios} (do plano)` : 'Obrigatório'
                }
                value={f.usuarios}
                onChange={(e) => setF({ ...f, usuarios: e.target.value.replace(/\D/g, '') })}
              />
              <span className="campo__dica">
                Em branco: o número do plano. Acima dele, cada usuário soma{' '}
                {fmtReais(PRECO_USUARIO_ADICIONAL)}.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="pl-leads">Leads enriquecidos por mês</label>
              <input
                id="pl-leads"
                className="filtro"
                inputMode="numeric"
                placeholder={
                  base && f.plano !== 'personalizado'
                    ? `${fmtNumero(base.leadsMes)} (do plano)`
                    : 'Obrigatório'
                }
                value={f.leads}
                onChange={(e) => setF({ ...f, leads: e.target.value.replace(/\D/g, '') })}
              />
              <span className="campo__dica">Em branco: o número do plano. Pode aumentar ou diminuir.</span>
            </div>
          </div>

          <fieldset className="campo">
            <legend>Módulos</legend>
            <div className="pilha" style={{ gap: 8 }}>
              {LISTA_MODULOS.map((m) => (
                <label key={m} className="opcao">
                  <input
                    type="checkbox"
                    checked={f.modulos.includes(m)}
                    onChange={(e) => alternar(m, e.target.checked)}
                  />
                  <span>
                    <b>{MODULOS[m].nome}</b> · {fmtReais(MODULOS[m].preco)}/mês
                    <span className="quieto"> · {MODULOS[m].descricao}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="plano-conta">
            {previa.itens.map((i) => (
              <div key={i.rotulo} className="plano-conta__linha">
                <span>{i.rotulo}</span>
                <span className="mono">{fmtReais(i.valor)}</span>
              </div>
            ))}
            {f.plano !== 'personalizado' && (
              <div className="plano-conta__linha plano-conta__total">
                <span>Total calculado</span>
                <span className="mono">{fmtReais(previa.mensalidadeCalculada)}</span>
              </div>
            )}
          </div>
          <div className="campo" style={{ maxWidth: 280 }}>
            <label htmlFor="pl-manual">Mensalidade combinada (R$)</label>
            <input
              id="pl-manual"
              className="filtro"
              inputMode="decimal"
              placeholder={f.plano === 'personalizado' ? 'Valor fechado' : 'Em branco: a calculada'}
              value={f.manual}
              onChange={(e) => setF({ ...f, manual: e.target.value.replace(/[^\d.,]/g, '') })}
            />
            <span className="campo__dica">Para desconto ou valor fechado. Só o master vê o cálculo.</span>
          </div>
        </>
      )}
      <ErroDaApi erro={salvar.error} />
      {salvar.isSuccess && <Mensagem tipo="ok">Plano salvo. Vale na hora para a conta.</Mensagem>}
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar plano'}
        </Button>
      </div>
    </form>
  );
}
