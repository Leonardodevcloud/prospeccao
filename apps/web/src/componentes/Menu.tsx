import type { Recurso } from '@prospeccao/shared/planos';
import { Icon } from '@prospeccao/ui';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';

/**
 * Menu do sistema. No computador: poucos itens, com grupos que abrem e fecham (o grupo da tela
 * aberta abre sozinho; os outros lembram como a pessoa deixou). No celular: uma barra fina em cima,
 * os atalhos do dia a dia embaixo (no polegar) e o resto em "Mais".
 */

export interface ItemMenu {
  para: string;
  rotulo: string;
  icone: string;
  /** Ativo só no endereço exato (sem as telas de dentro). */
  fim?: boolean;
  admin?: boolean;
  master?: boolean;
  /** Só aparece em conta com plano (cliente). */
  comPlano?: boolean;
  /** Só aparece se a conta tem algum destes módulos no plano. */
  modulos?: ('whatsapp' | 'agente_ia' | 'email')[];
  /** Só para o gestor e a leitura da organização. */
  organizacao?: boolean;
  /** Recurso do plano: sem ele, o item aparece com cadeado e a tela explica como liberar. */
  recurso?: Recurso;
}

export interface GrupoMenu {
  grupo: string;
  rotulo: string;
  icone: string;
  itens: ItemMenu[];
}

export type EntradaMenu = ItemMenu | GrupoMenu;
const ehGrupo = (e: EntradaMenu): e is GrupoMenu => 'grupo' in e;

/** O CRM, na ordem do trabalho: o dia, achar os leads, vender, automatizar, o Argos e a gestão. */
export const MENU_CRM: EntradaMenu[] = [
  { para: '/hoje', rotulo: 'Meu dia', icone: 'calendar' },
  {
    grupo: 'organizacao',
    rotulo: 'Organização',
    icone: 'building-2',
    itens: [
      {
        para: '/organizacao',
        rotulo: 'Painel da organização',
        icone: 'layout-dashboard',
        organizacao: true,
        fim: true,
      },
      { para: '/organizacao/gestao', rotulo: 'Unidades e pessoas', icone: 'building-2', organizacao: true },
    ],
  },
  {
    grupo: 'prospeccao',
    rotulo: 'Prospecção',
    icone: 'users',
    itens: [
      { para: '/', rotulo: 'Leads', icone: 'users', fim: true },
      { para: '/campanhas', rotulo: 'Campanhas', icone: 'layers' },
      { para: '/nichos', rotulo: 'Nichos', icone: 'store', admin: true },
      { para: '/atividade', rotulo: 'Atividade', icone: 'clock', admin: true, recurso: 'relatorios' },
    ],
  },
  {
    grupo: 'vendas',
    rotulo: 'Vendas',
    icone: 'kanban',
    itens: [
      { para: '/funil', rotulo: 'Funil', icone: 'kanban' },
      { para: '/conversas', rotulo: 'Conversas', icone: 'message-circle' },
      { para: '/reunioes', rotulo: 'Reuniões', icone: 'video' },
      { para: '/rua', rotulo: 'Na rua', icone: 'route', recurso: 'rua' },
    ],
  },
  {
    grupo: 'automacao',
    rotulo: 'Automação',
    icone: 'send',
    itens: [
      { para: '/email', rotulo: 'E-mail', icone: 'mail', modulos: ['email'] },
      { para: '/agente', rotulo: 'Agente de IA', icone: 'bot', modulos: ['whatsapp', 'agente_ia'] },
    ],
  },
  {
    grupo: 'argos',
    rotulo: 'Argos',
    icone: 'orbit',
    itens: [
      { para: '/argos', rotulo: 'Assistente', icone: 'orbit', fim: true, recurso: 'argos' },
      { para: '/argos/mapa', rotulo: 'Mapa do conhecimento', icone: 'globe', recurso: 'argos' },
    ],
  },
  {
    grupo: 'gestao',
    rotulo: 'Gestão',
    icone: 'trending-up',
    itens: [
      { para: '/relatorios', rotulo: 'Relatórios', icone: 'trending-up' },
      { para: '/equipe', rotulo: 'Equipe', icone: 'id-card' },
      { para: '/marca', rotulo: 'Marca e domínio', icone: 'image', admin: true, recurso: 'marca' },
      { para: '/plano', rotulo: 'Meu plano', icone: 'badge-check', comPlano: true },
      { para: '/auditoria', rotulo: 'Auditoria', icone: 'list-filter', admin: true, recurso: 'seguranca' },
    ],
  },
  { para: '/plataforma', rotulo: 'Painel da plataforma', icone: 'layout-dashboard', master: true, fim: true },
];

/** Painel da plataforma (só o master): o negócio, não a prospecção de uma conta. */
export const MENU_PLATAFORMA: EntradaMenu[] = [
  { para: '/plataforma', rotulo: 'Visão geral', icone: 'layout-dashboard', fim: true },
  { para: '/plataforma/vendas', rotulo: 'Vendas', icone: 'kanban' },
  {
    grupo: 'clientes',
    rotulo: 'Clientes',
    icone: 'building-2',
    itens: [
      { para: '/plataforma/clientes', rotulo: 'Clientes', icone: 'building-2' },
      { para: '/plataforma/financeiro', rotulo: 'Financeiro', icone: 'trending-up' },
    ],
  },
  {
    grupo: 'sistema',
    rotulo: 'Sistema',
    icone: 'settings',
    itens: [
      { para: '/plataforma/configuracoes', rotulo: 'Configurações', icone: 'settings' },
      { para: '/plataforma/operacao', rotulo: 'Operação', icone: 'activity' },
      { para: '/base-cnpj', rotulo: 'Base CNPJ', icone: 'landmark' },
    ],
  },
];

/** Atalhos da barra de baixo no celular (os que a pessoa vê; faltando, completa com os próximos). */
const ATALHOS_CRM = ['/hoje', '/', '/funil', '/conversas'];
const ATALHOS_PLATAFORMA = [
  '/plataforma',
  '/plataforma/vendas',
  '/plataforma/clientes',
  '/plataforma/financeiro',
];

/** Número ao lado do item (não lidas, atrasados…) e o ponto pulsando da Atividade. */
export interface Selo {
  n?: number;
  /** Na cor da marca (mensagem nova) em vez de neutro. */
  marca?: boolean;
  titulo?: string;
  vivo?: boolean;
}

export interface ContextoMenu {
  entradas: EntradaMenu[];
  plataforma: boolean;
  /** O item aparece para esta pessoa? */
  visivel: (i: ItemMenu) => boolean;
  /** O plano libera o recurso? (sem ele, cadeado). */
  temRecurso: (r: Recurso) => boolean;
  selo: (para: string) => Selo | null;
}

const ativoEm = (i: ItemMenu, caminho: string) =>
  i.fim ? caminho === i.para : caminho === i.para || caminho.startsWith(`${i.para}/`);

/** As entradas que a pessoa vê (grupos sem nenhum item somem; grupo de um item só vira item). */
function filtrar(ctx: ContextoMenu): EntradaMenu[] {
  const r: EntradaMenu[] = [];
  for (const e of ctx.entradas) {
    if (!ehGrupo(e)) {
      if (ctx.visivel(e)) r.push(e);
      continue;
    }
    const itens = e.itens.filter(ctx.visivel);
    if (itens.length === 1) r.push(itens[0]!);
    else if (itens.length) r.push({ ...e, itens });
  }
  return r;
}

const itensDe = (entradas: EntradaMenu[]): ItemMenu[] =>
  entradas.flatMap((e) => (ehGrupo(e) ? e.itens : [e]));

function SeloDoItem(props: { selo: Selo | null }) {
  const s = props.selo;
  if (!s) return null;
  return (
    <>
      {!!s.n && s.n > 0 && (
        <span className={`nav__conta${s.marca ? ' nav__conta--marca' : ''}`} title={s.titulo}>
          {s.n > 99 ? '99+' : s.n}
        </span>
      )}
      {s.vivo && <span className="vivo nav__vivo" role="img" aria-label="trabalhando agora" />}
    </>
  );
}

function Link(props: { item: ItemMenu; ctx: ContextoMenu; sub?: boolean }) {
  const { item, ctx } = props;
  return (
    <NavLink to={item.para} end={item.fim} className={`nav__link${props.sub ? ' nav__link--sub' : ''}`}>
      {!props.sub && <Icon name={item.icone} size={16} />}
      {item.rotulo}
      {item.recurso && !ctx.temRecurso(item.recurso) && (
        <span className="nav__cadeado" title="Fora do seu plano">
          <Icon name="lock" size={12} label="Fora do seu plano" />
        </span>
      )}
      <SeloDoItem selo={ctx.selo(item.para)} />
    </NavLink>
  );
}

const CHAVE_GRUPOS = 'menu:grupos';

function lerAbertos(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_GRUPOS) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Menu lateral (computador). */
export function MenuLateral(props: { ctx: ContextoMenu }) {
  const { ctx } = props;
  const { pathname } = useLocation();
  const entradas = filtrar(ctx);
  const doGrupoAtual = entradas.find((e) => ehGrupo(e) && e.itens.some((i) => ativoEm(i, pathname)));
  const [abertos, setAbertos] = useState<string[]>(lerAbertos);
  // Mudou de tela: o grupo dela abre (e fica aberto até a pessoa fechar).
  const grupoAtual = doGrupoAtual && ehGrupo(doGrupoAtual) ? doGrupoAtual.grupo : null;
  useEffect(() => {
    if (grupoAtual) setAbertos((a) => (a.includes(grupoAtual) ? a : [...a, grupoAtual]));
  }, [grupoAtual]);
  const alternar = (g: string) =>
    setAbertos((a) => {
      const novo = a.includes(g) ? a.filter((x) => x !== g) : [...a, g];
      try {
        localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(novo));
      } catch {
        // sem lembrar
      }
      return novo;
    });
  return (
    <>
      {entradas.map((e) => {
        if (!ehGrupo(e)) return <Link key={e.para} item={e} ctx={ctx} />;
        const aberto = abertos.includes(e.grupo);
        const ativo = e.itens.some((i) => ativoEm(i, pathname));
        // Fechado: soma os números de dentro (para não esconder mensagem nova).
        const soma = e.itens.reduce((s, i) => s + (ctx.selo(i.para)?.n ?? 0), 0);
        const marca = e.itens.some((i) => ctx.selo(i.para)?.marca && (ctx.selo(i.para)?.n ?? 0) > 0);
        const id = `menu-${e.grupo}`;
        return (
          <Fragment key={e.grupo}>
            <button
              type="button"
              className="nav__grupo"
              data-ativo={(ativo && !aberto) || undefined}
              aria-expanded={aberto}
              aria-controls={id}
              onClick={() => alternar(e.grupo)}
            >
              <Icon name={e.icone} size={16} />
              {e.rotulo}
              {!aberto && soma > 0 && (
                <span className={`nav__conta${marca ? ' nav__conta--marca' : ''}`}>
                  {soma > 99 ? '99+' : soma}
                </span>
              )}
              <span className="nav__seta" aria-hidden="true">
                <Icon name="chevron-down" size={14} />
              </span>
            </button>
            <div id={id} className="nav__sub" hidden={!aberto}>
              {e.itens.map((i) => (
                <Link key={i.para} item={i} ctx={ctx} sub />
              ))}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** Barra de baixo (celular): 4 atalhos + Mais. */
export function BarraDeBaixo(props: { ctx: ContextoMenu; maisAberto: boolean; aoMais: () => void }) {
  const { ctx } = props;
  const { pathname } = useLocation();
  const todos = itensDe(filtrar(ctx));
  const preferidos = (ctx.plataforma ? ATALHOS_PLATAFORMA : ATALHOS_CRM)
    .map((p) => todos.find((i) => i.para === p))
    .filter((i): i is ItemMenu => !!i);
  const atalhos = [...preferidos, ...todos.filter((i) => !preferidos.includes(i))].slice(0, 4);
  const emAtalho = atalhos.some((i) => ativoEm(i, pathname));
  const somaMais = todos
    .filter((i) => !atalhos.includes(i))
    .reduce((s, i) => s + (ctx.selo(i.para)?.n ?? 0), 0);
  return (
    <nav className="barra-baixo" aria-label="Atalhos">
      {atalhos.map((i) => {
        const s = ctx.selo(i.para);
        return (
          <NavLink key={i.para} to={i.para} end={i.fim} className="barra-baixo__item">
            <span className="barra-baixo__icone">
              <Icon name={i.icone} size={22} />
              {!!s?.n && s.n > 0 && (
                <span className={`barra-baixo__conta${s.marca ? ' barra-baixo__conta--marca' : ''}`}>
                  {s.n > 99 ? '99+' : s.n}
                </span>
              )}
            </span>
            {i.rotulo.replace('Painel da plataforma', 'Painel')}
          </NavLink>
        );
      })}
      <button
        type="button"
        className="barra-baixo__item"
        aria-expanded={props.maisAberto}
        aria-haspopup="dialog"
        data-ativo={props.maisAberto || !emAtalho || undefined}
        onClick={props.aoMais}
      >
        <span className="barra-baixo__icone">
          <Icon name="layout-grid" size={22} />
          {somaMais > 0 && <span className="barra-baixo__conta">{somaMais > 99 ? '99+' : somaMais}</span>}
        </span>
        Mais
      </button>
    </nav>
  );
}

/** "Mais" (celular): todas as telas por grupo, e Ajuda, Minha conta e Sair. */
export function FolhaMais(props: {
  ctx: ContextoMenu;
  aoFechar: () => void;
  /** Troca de unidade, demonstração… (o que o menu do computador tem em cima). */
  topo?: ReactNode;
  rodape: ReactNode;
}) {
  const { ctx, aoFechar } = props;
  const entradas = filtrar(ctx);
  const { pathname } = useLocation();
  const painel = useRef<HTMLDivElement>(null);
  const caminho = useRef(pathname);
  // Navegou: fecha.
  useEffect(() => {
    if (pathname !== caminho.current) aoFechar();
  }, [pathname, aoFechar]);
  useEffect(() => {
    painel.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aoFechar]);
  const soltos = entradas.filter((e): e is ItemMenu => !ehGrupo(e));
  const grupos = entradas.filter(ehGrupo);
  const celula = (i: ItemMenu) => {
    const s = ctx.selo(i.para);
    return (
      <NavLink key={i.para} to={i.para} end={i.fim} className="folha-mais__item">
        <span className="folha-mais__icone">
          <Icon name={i.icone} size={20} />
          {!!s?.n && s.n > 0 && <span className="barra-baixo__conta">{s.n > 99 ? '99+' : s.n}</span>}
        </span>
        <span className="folha-mais__rotulo">{i.rotulo}</span>
        {i.recurso && !ctx.temRecurso(i.recurso) && (
          <span className="folha-mais__cadeado">
            <Icon name="lock" size={10} label="Fora do seu plano" />
          </span>
        )}
      </NavLink>
    );
  };
  return (
    <div className="folha-mais">
      <div className="folha-mais__fundo" onClick={aoFechar} aria-hidden="true" />
      <div
        ref={painel}
        className="folha-mais__painel"
        role="dialog"
        aria-modal="true"
        aria-label="Todas as telas"
        tabIndex={-1}
      >
        <span className="folha-mais__puxador" aria-hidden="true" />
        {props.topo}
        {soltos.length > 0 && <div className="folha-mais__grade">{soltos.map(celula)}</div>}
        {grupos.map((g) => (
          <section key={g.grupo} className="folha-mais__grupo" aria-label={g.rotulo}>
            <h2 className="folha-mais__titulo">{g.rotulo}</h2>
            <div className="folha-mais__grade">{g.itens.map(celula)}</div>
          </section>
        ))}
        <div className="folha-mais__rodape">{props.rodape}</div>
      </div>
    </div>
  );
}
