import { Tabs } from '@prospeccao/ui';
import { useSearchParams } from 'react-router';
import { LinkAjuda } from '../componentes/Ajuda';
import { Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSoLeitura } from '../componentes/Sessao';
import { useEstadoRua, useHoje } from '../rua/api';
import { EquipeRuaPainel } from '../rua/EquipeRua';
import { MeuRoteiro } from '../rua/MeuRoteiro';
import { Planejar } from '../rua/Planejar';

/**
 * Vendas na rua: planejar o dia (computador), o roteiro de hoje (celular) e as visitas da equipe.
 * No celular abre direto no roteiro de hoje.
 */

type Aba = 'planejar' | 'hoje' | 'equipe';

const ehCelular = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

export function NaRua() {
  const [busca, setBusca] = useSearchParams();
  const admin = useEhAdmin();
  const soLeitura = useSoLeitura();
  const hoje = useHoje();
  const estado = useEstadoRua();
  const temHoje = !!hoje.data?.paradas.length;
  const pedida = busca.get('ver') as Aba | null;
  const padrao: Aba = soLeitura ? 'equipe' : ehCelular() || (temHoje && !admin) ? 'hoje' : 'planejar';
  const aba: Aba = pedida && ['planejar', 'hoje', 'equipe'].includes(pedida) ? pedida : padrao;
  const ir = (a: string) => {
    const p = new URLSearchParams(busca);
    p.set('ver', a);
    setBusca(p, { replace: true });
  };

  const itens = [
    ...(soLeitura ? [] : [{ id: 'planejar', rotulo: 'Planejar o dia' }]),
    ...(soLeitura
      ? []
      : [{ id: 'hoje', rotulo: 'Meu roteiro de hoje', contagem: hoje.data?.paradas.length || undefined }]),
    { id: 'equipe', rotulo: admin || soLeitura ? 'Visitas da equipe' : 'Minhas visitas' },
  ];

  return (
    <div className="rua-pagina" data-aba={aba}>
      <div className="topo rua-cabecalho">
        <div>
          <h1>Vendas na rua</h1>
          <p>
            Roteiro de visitas pelos leads da campanha, com o caminho, o check-in e o registro de cada visita.{' '}
            <LinkAjuda artigo="vendas-na-rua" />
          </p>
        </div>
      </div>
      <Tabs itens={itens} ativo={aba} onChange={ir} rotulo="Vendas na rua" />
      {aba === 'planejar' && estado.data && !estado.data.rotas && (
        <Mensagem tipo="aviso">
          O cálculo pelas ruas ainda não está ligado: os tempos do roteiro são estimados pela distância. Quem
          administra a plataforma liga em poucos minutos (veja a ajuda).
        </Mensagem>
      )}
      {aba === 'planejar' && <Planejar />}
      {aba === 'hoje' && <MeuRoteiro podePlanejar={!soLeitura} aoPlanejar={() => ir('planejar')} />}
      {aba === 'equipe' && <EquipeRuaPainel admin={admin || soLeitura} />}
    </div>
  );
}
