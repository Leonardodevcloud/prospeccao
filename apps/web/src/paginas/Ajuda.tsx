import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type ArtigoAjuda, ARTIGOS as TODOS } from '../componentes/Ajuda';
import { useSessao } from '../componentes/Sessao';

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Central de ajuda: lista por área à esquerda, artigo à direita (no celular, um de cada vez). */
export function Ajuda() {
  const { artigo: id } = useParams();
  const [busca, setBusca] = useState('');
  // Os artigos do painel da plataforma só para quem administra a plataforma.
  const master = !!useSessao().data?.master;
  const ARTIGOS = useMemo(() => TODOS.filter((a) => !a.soMaster || master), [master]);
  const artigo = ARTIGOS.find((a) => a.id === id) ?? null;

  const grupos = useMemo(() => {
    const t = semAcento(busca.trim());
    const achados = t
      ? ARTIGOS.filter((a) => semAcento(`${a.titulo} ${a.resumo} ${a.termos ?? ''}`).includes(t))
      : ARTIGOS;
    const porArea = new Map<string, ArtigoAjuda[]>();
    for (const a of achados) porArea.set(a.area, [...(porArea.get(a.area) ?? []), a]);
    return [...porArea.entries()];
  }, [busca, ARTIGOS]);

  return (
    <div className="ajuda" data-aberto={artigo ? true : undefined}>
      <div className="topo">
        <div>
          <h1>Ajuda</h1>
          <p>Como cada parte do sistema funciona, em poucas palavras.</p>
        </div>
      </div>
      <div className="ajuda__corpo">
        <nav className="ajuda__lista" aria-label="Artigos de ajuda">
          <label className="pp-sr" htmlFor="ajuda-busca">
            Buscar na ajuda
          </label>
          <input
            id="ajuda-busca"
            className="filtro"
            type="search"
            placeholder="Buscar: QR Code, nota, Sem lead…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {grupos.length === 0 && (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Nada encontrado. Tente outra palavra.
            </p>
          )}
          {grupos.map(([area, itens]) => (
            <div key={area} className="ajuda__grupo">
              <span className="nav__secao">{area}</span>
              {itens.map((a) => (
                <Link
                  key={a.id}
                  to={`/ajuda/${a.id}`}
                  className="ajuda__item"
                  aria-current={a.id === artigo?.id ? 'page' : undefined}
                >
                  <b>{a.titulo}</b>
                  <span className="quieto">{a.resumo}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <article className="ajuda__artigo caixa">
          {artigo ? (
            <>
              <Link to="/ajuda" className="ajuda__voltar">
                <span aria-hidden="true">←</span> Todos os artigos
              </Link>
              <span className="nav__secao" style={{ margin: 0 }}>
                {artigo.area}
              </span>
              <h2>{artigo.titulo}</h2>
              <p className="ajuda__resumo">{artigo.resumo}</p>
              {artigo.onde && (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  Onde fica: <Link to={artigo.onde.para}>{artigo.onde.rotulo}</Link>
                </p>
              )}
              <div className="ajuda__texto">{artigo.corpo}</div>
            </>
          ) : (
            <div className="ajuda__inicio">
              <h2>Por onde começar</h2>
              <p>
                Se a conta é nova, siga os <Link to="/ajuda/primeiros-passos">primeiros passos</Link>. Para
                conectar um WhatsApp que já conversa com clientes, veja{' '}
                <Link to="/ajuda/whatsapp-uso-diario">número que já é usado no dia a dia</Link>.
              </p>
              <p className="quieto" style={{ margin: 0 }}>
                Não achou? Fale com o suporte do Prospect Team.
              </p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
