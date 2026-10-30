import { Icon } from '@prospeccao/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Central de ajuda: um artigo por assunto, escrito para quem usa (não para quem programa).
 * Toda funcionalidade nova ou mudada atualiza o artigo da área aqui, e as telas apontam para ele
 * com <LinkAjuda artigo="…">.
 */
export interface ArtigoAjuda {
  id: string;
  area: 'Começo' | 'Prospecção' | 'Vendas' | 'WhatsApp e IA' | 'Gestão' | 'Argos';
  titulo: string;
  resumo: string;
  /** Tela onde isso fica no sistema. */
  onde?: { rotulo: string; para: string };
  /** Palavras que a busca também encontra. */
  termos?: string;
  corpo: ReactNode;
}

const Passos = (props: { children: ReactNode }) => <ol className="ajuda-passos">{props.children}</ol>;
const Nota = (props: { children: ReactNode }) => <p className="ajuda-nota">{props.children}</p>;

export const ARTIGOS: ArtigoAjuda[] = [
  {
    id: 'primeiros-passos',
    area: 'Começo',
    titulo: 'Primeiros passos',
    resumo: 'A ordem que deixa a conta pronta para prospectar e vender.',
    onde: { rotulo: 'Meu dia', para: '/hoje' },
    termos: 'começar configurar início checklist',
    corpo: (
      <>
        <p>
          Em <b>Meu dia</b> e em <b>Leads</b> aparece o quadro “Primeiros passos”. Ele se marca sozinho
          conforme você faz cada coisa, e dá para fechar quando não precisar mais (e abrir de novo depois).
        </p>
        <Passos>
          <li>
            <b>Conecte seu WhatsApp</b>: leia o QR Code com o celular do número que vai falar com os leads (
            <Link to="/ajuda/whatsapp-numeros">como conectar</Link>).
          </li>
          <li>
            <b>Crie um nicho</b>: o tipo de empresa que você procura, os termos de busca e o que fica de fora.
          </li>
          <li>
            <b>Rode a primeira campanha</b>: escolha o nicho e as cidades.
          </li>
          <li>
            <b>Mande os melhores leads para o funil</b>: filtre pela nota A e mande para “A abordar”.
          </li>
          <li>
            <b>Ensine a IA de atendimento</b> (se o seu plano tiver): o que a empresa faz, o que vende e o que
            nunca pode dizer.
          </li>
          <li>
            <b>Prepare a sequência de e-mail</b> (se o seu plano tiver) e teste antes de ligar.
          </li>
          <li>
            <b>Convide a equipe</b>: cada pessoa com o seu papel.
          </li>
        </Passos>
      </>
    ),
  },
  {
    id: 'nichos-campanhas',
    area: 'Prospecção',
    titulo: 'Nichos e campanhas',
    resumo: 'Como dizer quem você quer encontrar e buscar essas empresas nas cidades.',
    onde: { rotulo: 'Campanhas', para: '/campanhas' },
    termos: 'busca google maps receita cnpj cidades',
    corpo: (
      <>
        <h3>Nicho</h3>
        <p>
          O nicho descreve quem você quer encontrar: o tipo de empresa, os termos que serão buscados no Google
          e o que deve ficar de fora. Há nichos prontos para começar; você ajusta do seu jeito. Só
          administradores criam e editam nichos.
        </p>
        <h3>Campanha</h3>
        <p>
          Uma campanha junta um nicho e as cidades. Ao iniciar, o sistema busca as empresas na Receita e no
          Google Maps, cruza com o CNPJ, enriquece cada lead e dá uma nota. O progresso aparece na própria
          campanha.
        </p>
        <Nota>Dica: comece com poucas cidades, confira a qualidade dos leads e depois aumente.</Nota>
      </>
    ),
  },
  {
    id: 'leads',
    area: 'Prospecção',
    titulo: 'Leads e a nota',
    resumo: 'Como escolher quem abordar primeiro e mandar para o funil.',
    onde: { rotulo: 'Leads', para: '/' },
    termos: 'nota a b c filtrar enviar funil descartar',
    corpo: (
      <>
        <p>
          A lista de leads mostra, por padrão, só os <b>novos (não trabalhados)</b>, para a rodada nova não
          repetir quem já foi visto. Troque o filtro para ver os que já estão no funil.
        </p>
        <Passos>
          <li>Filtre pela nota A (as empresas que mais combinam com o nicho).</li>
          <li>Selecione os leads e mande para “A abordar”, ou descarte os que não servem.</li>
          <li>
            No fim, o sistema mostra quantos entraram, quantos já estavam no funil e quantos foram
            descartados.
          </li>
        </Passos>
        <p>
          Você também pode criar um lead à mão ou importar uma planilha. Em <b>Relatórios › A nota acerta?</b>{' '}
          dá para ver se as notas estão batendo com as vendas.
        </p>
      </>
    ),
  },
  {
    id: 'funil',
    area: 'Vendas',
    titulo: 'Funil',
    resumo: 'As etapas da venda e o que fazer em cada uma.',
    onde: { rotulo: 'Funil', para: '/funil' },
    termos: 'etapas kanban a abordar abordado respondeu reunião proposta ganho perdido cadência',
    corpo: (
      <>
        <p>As etapas são:</p>
        <ul>
          <li>
            <b>A abordar</b> → <b>Abordado</b> → <b>Respondeu</b> → <b>Reunião</b> → <b>Proposta</b>
          </li>
          <li>
            Fechamento: <b>Ganho</b>, <b>Perdido</b> ou <b>Descartado</b>.
          </li>
        </ul>
        <p>
          Em A abordar, Abordado, Respondeu e Proposta, a cadência já deixa uma mensagem pronta para mandar.
          As colunas de Ganho e Perdido mostram só os mais recentes, para não crescerem sem fim.
        </p>
        <Nota>
          Ao marcar como perdido ou descartado, diga o motivo: ele aparece em Relatórios › Por que perdemos ou
          descartamos.
        </Nota>
      </>
    ),
  },
  {
    id: 'conversas',
    area: 'Vendas',
    titulo: 'Conversas e “Sem lead”',
    resumo: 'Onde ficam as conversas do WhatsApp e o que acontece com quem não é lead.',
    onde: { rotulo: 'Conversas', para: '/conversas' },
    termos: 'whatsapp inbox sem lead não identificado número desconhecido',
    corpo: (
      <>
        <p>
          Em <b>Conversas</b> ficam as conversas de WhatsApp dos leads. Quando alguém que <b>não é lead</b>{' '}
          escreve, vale a regra da conta, escolhida na aba <b>Sem lead</b>:
        </p>
        <ul>
          <li>
            <b>Espera aqui</b>: a conversa fica em “Sem lead” até alguém criar o lead, vincular a um que
            existe ou descartar.
          </li>
          <li>
            <b>Vira lead sozinho</b>: entra no funil em “A abordar”, sem a IA.
          </li>
        </ul>
        <p>
          Em número de <b>uso diário</b> essa regra pode ser trocada por número, e as conversas que já
          existiam não entram (<Link to="/ajuda/whatsapp-uso-diario">veja como funciona</Link>).
        </p>
        <Nota>Quem só vê a própria base enxerga em “Sem lead” apenas o que chegou pelo próprio número.</Nota>
      </>
    ),
  },
  {
    id: 'whatsapp-numeros',
    area: 'WhatsApp e IA',
    titulo: 'Conectar números de WhatsApp',
    resumo: 'QR Code, limite por dia, aquecimento e número de cada comercial.',
    onde: { rotulo: 'Agente › Atendimento', para: '/agente' },
    termos: 'qr code chip conectar desconectar limite aquecimento bloqueio dono comercial',
    corpo: (
      <>
        <h3>Conectar</h3>
        <Passos>
          <li>
            Em <b>Agente › Atendimento › Números de WhatsApp</b>, clique em <b>Conectar número</b> e dê um
            nome (só para você saber qual é qual).
          </li>
          <li>
            Responda se o número <b>já é usado no dia a dia</b>. Se for, as conversas que já existem ficam
            fora do CRM (<Link to="/ajuda/whatsapp-uso-diario">entenda</Link>).
          </li>
          <li>
            No celular: WhatsApp › Dispositivos conectados › Conectar dispositivo, e aponte para o QR Code.
          </li>
        </Passos>
        <p>
          Prefira WhatsApp Business e deixe o celular com internet: o WhatsApp precisa dele ligado de vez em
          quando para manter a conexão. Para trocar de celular ou de número, use <b>Desconectar</b> e leia o
          QR Code de novo.
        </p>
        <h3>Limite e aquecimento</h3>
        <p>
          Cada número tem um limite de mensagens automáticas por dia. Mensagens que alguém da equipe manda não
          contam. Número novo começa devagar e vai subindo em 30 dias (aquecimento); em número que já é usado
          há tempo, dá para desligar o aquecimento.
        </p>
        <p>
          O lead novo vai para o número menos usado do dia e conversa sempre pelo mesmo. Se um número falhar
          seguidamente, ele pausa sozinho por um tempo.
        </p>
        <h3>Número de um comercial</h3>
        <p>
          Em <b>De quem é</b>, escolha a pessoa dona do número. Os leads novos que chegam por ele ficam com
          ela, e o que é dela sai pelo número dela.
        </p>
      </>
    ),
  },
  {
    id: 'whatsapp-uso-diario',
    area: 'WhatsApp e IA',
    titulo: 'Número que já é usado no dia a dia',
    resumo: 'Como conectar um WhatsApp que já conversa com clientes sem jogar essas conversas no CRM.',
    onde: { rotulo: 'Agente › Atendimento', para: '/agente' },
    termos: 'conversas antigas de antes clientes antigos pessoal ignorar trazer para o crm grupos',
    corpo: (
      <>
        <p>
          Muitas empresas conectam um número que já fala com clientes, fornecedores e conhecidos. Essas
          conversas são continuidade de contato, não leads. Por isso, ao marcar o número como{' '}
          <b>de uso diário</b>:
        </p>
        <ul>
          <li>
            <b>Assim que o número conecta</b>, o sistema lê as conversas que já existem no WhatsApp e separa
            esses contatos como “de antes”. Leva alguns minutos.
          </li>
          <li>
            Contato de antes <b>fica só no celular</b>: não vira lead, não aparece em “Sem lead” e a IA não
            responde.
          </li>
          <li>
            Se a equipe <b>puxar conversa pelo celular</b> com alguém que não é lead, essa pessoa também passa
            a ser “de antes”.
          </li>
          <li>
            <b>Grupos</b> nunca entram no CRM.
          </li>
          <li>
            Quem <b>já era lead</b> continua no CRM normalmente.
          </li>
        </ul>
        <h3>Quem escrever pela primeira vez</h3>
        <p>Você escolhe, por número:</p>
        <ul>
          <li>
            <b>Fica só no celular</b>: não entra e vira “de antes”. Bom para número pessoal.
          </li>
          <li>
            <b>Vai para “Sem lead”</b>: alguém decide em Conversas. A IA não responde.
          </li>
          <li>
            <b>Vira lead</b>: entra no funil em “A abordar”, sem a IA.
          </li>
          <li>
            <b>Como no resto da conta</b>: segue a regra da aba Sem lead.
          </li>
        </ul>
        <h3>Trazer alguém para o CRM</h3>
        <p>
          Em <b>Ver contatos de antes</b>, busque a pessoa e clique em <b>Trazer para o CRM</b>. A partir da
          próxima mensagem dela, a conversa segue o fluxo normal. <b>Ler de novo</b> relê as conversas do
          celular sem desfazer quem você já trouxe.
        </p>
        <Nota>
          Dá para ligar ou desligar o uso diário depois, na linha do número. Desligado, toda conversa nova
          volta a seguir a regra da conta.
        </Nota>
      </>
    ),
  },
  {
    id: 'ia-atendimento',
    area: 'WhatsApp e IA',
    titulo: 'IA de atendimento',
    resumo: 'Como ensinar a IA, provar que ela está pronta e ligar.',
    onde: { rotulo: 'Agente › Configuração da IA', para: '/agente?aba=configuracao' },
    termos: 'agente ia robô configurar perfil prova simulador base de conhecimento inventar',
    corpo: (
      <>
        <p>
          A IA só fala o que está na configuração e na base de conhecimento. Ela não inventa preço, prazo,
          número ou promessa: antes de cada mensagem sair, os fatos são conferidos com as fontes, e se algo
          não bater a mensagem não sai.
        </p>
        <h3>O que preencher (tudo obrigatório)</h3>
        <ul>
          <li>
            <b>Quem é ela</b>: como se apresenta e o jeito de escrever.
          </li>
          <li>
            <b>Empresa</b>: o que faz, para quem e por que escolher vocês.
          </li>
          <li>
            <b>Região</b>: onde atendem. Fora da lista, ela passa para o time.
          </li>
          <li>
            <b>Oferta</b>: o que pode oferecer, o que vocês não fazem e como falar de preço.
          </li>
          <li>
            <b>Objetivo</b>: aonde a conversa precisa chegar.
          </li>
          <li>
            <b>Objeções</b>: o que o cliente costuma dizer e a resposta aprovada (pelo menos 3).
          </li>
          <li>
            <b>Limites</b>: o que nunca pode dizer e quando chamar alguém do time.
          </li>
          <li>
            <b>Reunião</b>: como é a reunião que ela marca.
          </li>
        </ul>
        <p>
          A IA pode sugerir o texto de cada parte a partir do site da empresa, de um documento, de um texto
          colado ou de uma entrevista rápida, sempre mostrando o trecho de onde tirou. Você aceita, edita ou
          descarta: nada entra sem você.
        </p>
        <h3>Prova antes de ligar</h3>
        <p>
          A IA só pode ser ligada depois de passar na prova: conversas de teste com situações comuns e
          difíceis (“quem é?”, quanto custa, entrega fora da região, “você é um robô?”, pressão por desconto,
          cliente irritado, tentativa de tirar ela das regras). Você também cria os seus cenários. Use o{' '}
          <b>Simulador</b> para conversar com ela como se fosse um cliente.
        </p>
        <Nota>
          Em <b>O que falta ensinar</b> aparecem as perguntas que ela não soube responder: responda para ela
          aprender.
        </Nota>
      </>
    ),
  },
  {
    id: 'email',
    area: 'Vendas',
    titulo: 'Sequências de e-mail',
    resumo: 'Passos, modelos e teste antes de ligar.',
    onde: { rotulo: 'E-mail', para: '/email' },
    termos: 'email sequência modelos domínio identidade visual',
    corpo: (
      <>
        <p>
          Uma sequência é uma série de passos (e-mail e outros canais) que os leads recebem com intervalos.
          Configure a identidade visual, escreva os modelos (os do nicho da campanha aparecem primeiro) e
          monte os passos.
        </p>
        <Nota>Mande um teste para você antes de ligar a sequência.</Nota>
      </>
    ),
  },
  {
    id: 'equipe',
    area: 'Gestão',
    titulo: 'Equipe e o que cada um vê',
    resumo: 'Convites, papéis, unidade toda ou só a própria base.',
    onde: { rotulo: 'Equipe', para: '/equipe' },
    termos: 'convidar usuário papel admin sdr closer unidade alcance própria base rodízio',
    corpo: (
      <>
        <p>
          Em <b>Equipe</b>, convide as pessoas e escolha o papel de cada uma. Os leads novos se dividem entre
          quem estiver no rodízio.
        </p>
        <h3>O que cada pessoa vê</h3>
        <ul>
          <li>
            <b>A unidade toda</b>: todos os leads, conversas e números da unidade.
          </li>
          <li>
            <b>Só a própria base</b>: só os leads em que ela é a responsável, em todas as telas (funil,
            conversas, agenda, relatórios e Argos).
          </li>
        </ul>
        <p>O administrador sempre vê a unidade toda.</p>
      </>
    ),
  },
  {
    id: 'relatorios',
    area: 'Gestão',
    titulo: 'Relatórios',
    resumo: 'Funil do período, ritmo, perdas, campanhas e custos.',
    onde: { rotulo: 'Relatórios', para: '/relatorios' },
    termos: 'indicadores métricas desempenho custos',
    corpo: (
      <>
        <p>Escolha o período e acompanhe:</p>
        <ul>
          <li>Funil dos leads do período e ritmo de contatos por dia.</li>
          <li>Por que perdemos ou descartamos.</li>
          <li>Campanhas, decisores encontrados e quais fontes erram mais.</li>
          <li>A nota acerta? (nota dos leads comparada com o que virou venda).</li>
          <li>Custos do mês.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'argos',
    area: 'Argos',
    titulo: 'Argos e o Mapa do conhecimento',
    resumo: 'O assistente que responde sobre o seu comercial, por voz ou texto.',
    onde: { rotulo: 'Argos', para: '/argos' },
    termos: 'assistente voz perguntar mapa galáxia',
    corpo: (
      <>
        <p>
          Pergunte ao <b>Argos</b> sobre o seu comercial, por voz ou por texto. O histórico das conversas é só
          seu. Ele vê os mesmos dados que você: quem só vê a própria base recebe respostas só sobre ela.
        </p>
        <p>
          O <b>Mapa do conhecimento</b> mostra o comercial como uma galáxia: cada etapa do funil é um
          aglomerado, cada empresa em negociação uma estrela, e as pessoas da equipe ficam no meio das
          empresas que conduzem.
        </p>
      </>
    ),
  },
];

/** Link discreto para um artigo da central de ajuda (abre em outra aba para não perder o que está fazendo). */
export function LinkAjuda(props: { artigo: string; children?: ReactNode }) {
  return (
    <Link to={`/ajuda/${props.artigo}`} target="_blank" rel="noopener" className="link-ajuda">
      <Icon name="circle-help" size={14} />
      {props.children ?? 'Ajuda'}
    </Link>
  );
}
