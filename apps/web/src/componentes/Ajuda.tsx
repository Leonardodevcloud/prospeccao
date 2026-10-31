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
  area: 'Começo' | 'Prospecção' | 'Vendas' | 'WhatsApp e IA' | 'Gestão' | 'Argos' | 'Painel da plataforma';
  /** Só quem administra a plataforma vê (o painel master). */
  soMaster?: boolean;
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
        <p>
          Na ficha do lead, em <b>Agenda</b>, você marca reuniões, ligações e tarefas. A reunião pode
          acontecer na sala de vídeo do próprio sistema: depois dela, o quadro <b>Reuniões gravadas</b> mostra
          a gravação e o resumo da IA (<Link to="/ajuda/reunioes">veja como funciona</Link>).
        </p>
      </>
    ),
  },
  {
    id: 'reunioes',
    area: 'Vendas',
    titulo: 'Reuniões por vídeo',
    resumo: 'Sala de vídeo com link para o lead, gravação, transcrição e resumo da IA.',
    onde: { rotulo: 'Reuniões', para: '/reunioes' },
    termos:
      'videochamada video chamada meet sala link gravar gravação transcrição resumo ata convite celular compartilhar tela levantar mão chat arquivo sala de espera fundo desfoque desfocar cenário fundo virtual logo',
    corpo: (
      <>
        <p>
          A reunião acontece dentro do sistema, sem limite de tempo e sem precisar instalar nada: o lead entra
          pelo navegador, no computador ou no celular. Quando acaba, a gravação, a transcrição e o resumo da
          IA aparecem na ficha do lead.
        </p>
        <h3>Marcar</h3>
        <Passos>
          <li>
            Na ficha do lead, em <b>Agenda › Marcar reunião</b>, deixe <b>Sala de vídeo do sistema</b> (ou use
            <b>Reuniões › Marcar reunião</b>).
          </li>
          <li>
            Escolha quanto tempo antes a sala abre para os convidados (10 minutos, por exemplo), se você quer
            aprovar quem entra, e se a reunião será gravada e transcrita.
          </li>
          <li>
            Mande o link: <b>Mandar convite no WhatsApp</b> envia a mensagem para o lead pelo WhatsApp do
            sistema, ou use <b>Copiar link</b> para mandar por onde quiser. O lembrete da agenda já leva o
            link.
          </li>
        </Passos>
        <p>
          Para uma conversa que precisa acontecer já, use <b>Reuniões › Reunião agora</b>: a sala abre na hora
          e é só mandar o link.
        </p>
        <h3>Quando o convidado consegue entrar</h3>
        <p>
          Antes do horário de abrir, o link mostra quanto falta e um botão para testar a câmera e o microfone.
          Na hora, a pessoa digita o nome, vê a própria imagem, escolhe câmera e microfone e entra. Se você
          escolheu <b>Eu aprovo cada pessoa que chegar</b>, ela fica na sala de espera até alguém do time
          deixar entrar.
        </p>
        <p>
          Quem é do time entra a qualquer momento, inclusive antes de abrir para os convidados, e pode abrir a
          sala de novo depois de encerrada.
        </p>
        <h3>Na sala</h3>
        <ul>
          <li>Ligar e desligar o microfone e a câmera (no computador: Ctrl+D e Ctrl+E).</li>
          <li>
            Compartilhar a tela, uma janela ou uma aba (no computador). A gravação mostra o que foi
            compartilhado.
          </li>
          <li>Levantar a mão para pedir a vez; quem conduz vê a fila na ordem em que as mãos subiram.</li>
          <li>Chat para todos, com envio de arquivos de até 10 MB. Tudo fica guardado com a reunião.</li>
          <li>
            Quem é do time pode silenciar alguém (ou todos), baixar a mão de alguém, tirar um convidado da
            sala e <b>Encerrar para todos</b>.
          </li>
          <li>
            Avisos na tela e com som quando alguém entra, sai, levanta a mão, manda mensagem ou pede para
            entrar. Se você estiver em outra aba, o título dela pisca com o aviso.
          </li>
          <li>
            Em <b>Mais opções</b>: trocar de câmera ou microfone, ligar ou desligar os sons de aviso, ver em
            grade ou destaque e tela cheia.
          </li>
        </ul>
        <p>
          No celular, a sala já usa a câmera da frente e o microfone do aparelho; o botão com as setas troca
          para a câmera de trás (e volta). A sala mostra quem está falando em destaque e as outras pessoas em
          fichas logo abaixo; toque numa ficha para fixar a pessoa. Se a internet oscilar, a imagem se ajusta
          sozinha para o som não cortar, e a sala avisa quando a conexão está fraca.
        </p>
        <p>
          A imagem de cada pessoa e a tela compartilhada aparecem sempre inteiras, em qualquer tamanho de
          janela: a grade se ajusta ao espaço e, quando a proporção da câmera não combina com o quadro (um
          celular em pé, por exemplo), aparecem faixas escuras nas laterais em vez de cortar a imagem. A
          gravação fica igual ao que se vê na tela.
        </p>
        <h3>Fundo da câmera</h3>
        <p>
          Na tela antes de entrar e no botão <b>Fundo</b> (o das estrelinhas) dentro da sala, cada pessoa
          escolhe como aparece: <b>sem efeito</b>, <b>desfoque leve ou forte</b> (esconde a casa ou o
          escritório) ou um <b>cenário</b> (sala de reunião, escritório, estante, recepção…). Quem está na
          reunião vê o fundo escolhido, e a gravação também. O sistema lembra a escolha para a próxima
          reunião.
        </p>
        <ul>
          <li>
            Quem é do time vê também os fundos <b>da empresa</b>: os cenários com a logo já colocada e as
            fotos que o gestor enviou. O gestor escolhe quais valem, qual já vem marcado e pode travar um
            fundo para todo mundo (Marca e domínio › Fundos das reuniões).
          </li>
          <li>Com a logo no fundo, você vê a sua imagem sem o espelho, do jeito que os outros veem.</li>
          <li>
            Separar a pessoa do fundo pesa um pouco no computador. Em aparelho mais fraco ou navegador antigo,
            o sistema avisa e a reunião segue sem efeito.
          </li>
        </ul>
        <h3>Gravação e consentimento</h3>
        <p>Em reunião gravada, quem entra vê o aviso e precisa concordar com a gravação antes de entrar.</p>
        <p>
          Quem grava é o computador de quem conduz a reunião, sem custo a mais. A gravação sai exatamente como
          a sua tela da reunião: os vídeos com os nomes, o chat, a tela compartilhada e as mãos levantadas.
          Para gravar:
        </p>
        <Passos>
          <li>
            Entre pelo computador, no <b>Chrome</b> ou no <b>Edge</b>, e clique em <b>Entrar e gravar</b>.
          </li>
          <li>
            O navegador pergunta se pode compartilhar esta aba: clique em <b>Compartilhar</b>. Aparece o selo
            vermelho <b>Gravando</b> no alto da sala.
          </li>
          <li>
            Ao sair, deixe a aba aberta até aparecer <b>Gravação enviada</b>. Se precisar fechar antes, o que
            faltou sobe sozinho na próxima vez que você abrir o sistema nesse computador.
          </li>
        </Passos>
        <p>
          Se a gravação não estiver ligada, a sala mostra o botão <b>Gravar esta reunião</b>. Só uma pessoa do
          time grava por vez; se ela sair, outra pessoa do time pode continuar. Com a internet fraca, a
          gravação continua e o envio espera, para não atrapalhar a reunião; se o computador apertar, a
          gravação fica um pouco menos fluida para a sua câmera ao vivo não perder qualidade. Enquanto você
          grava, dá para apresentar uma janela ou outra aba (a tela inteira não aparece na lista, porque
          repetiria a reunião dentro dela).
        </p>
        <h3>Depois da reunião</h3>
        <p>
          Em alguns minutos aparecem em <b>Reuniões › Realizadas</b> e na ficha do lead:
        </p>
        <ul>
          <li>a gravação, com os momentos importantes para pular direto (preço, objeção, decisão);</li>
          <li>o resumo da IA: o que o lead precisa, objeções, quem decide, prazos e o interesse;</li>
          <li>
            a transcrição com quem falou cada trecho, com busca; clique no horário para ver aquele momento;
          </li>
          <li>os próximos passos, que viram tarefas na agenda com um clique;</li>
          <li>quem participou, por quanto tempo e quanto cada um falou, além do chat e dos arquivos.</li>
        </ul>
        <p>
          Se a IA sugerir mudar o lead de etapa, o botão aparece no resumo. A reunião também entra no
          histórico do lead e o Argos passa a saber o que foi conversado.
        </p>
        <Nota>
          Só um administrador pode apagar a gravação e a transcrição de uma reunião. O resumo e o histórico
          ficam. Ao usar “Esquecer este contato” (LGPD), as reuniões dele também são apagadas.
        </Nota>
      </>
    ),
  },
  {
    id: 'vendas-na-rua',
    area: 'Vendas',
    titulo: 'Vendas na rua (roteiro de visitas)',
    resumo: 'Monte o dia de visitas pelos leads da campanha, siga no celular e registre cada visita.',
    onde: { rotulo: 'Na rua', para: '/rua' },
    termos:
      'visita visitas rota roteiro mapa campo rua externo vendedor externo check-in checkin waze google maps celular foto fachada km quilometragem gestor',
    corpo: (
      <>
        <p>
          Para quem vende visitando os clientes. O sistema escolhe, entre os leads de uma campanha, os
          melhores que cabem no dia, coloca na ordem que anda menos e diz a hora de chegada em cada um. No
          celular, o vendedor segue o roteiro, faz o check-in e registra como foi cada visita; o lead anda no
          funil sozinho.
        </p>
        <h3>Planejar o dia (no computador)</h3>
        <Passos>
          <li>
            Em <b>Vendas › Na rua › Planejar o dia</b>, escolha o dia e, se você é administrador, de quem é o
            roteiro.
          </li>
          <li>
            Em <b>Quais leads entram</b>, escolha a campanha, as notas (A, B, C) e a situação: nunca
            visitados, em negociação ou clientes.
          </li>
          <li>
            Diga de onde o vendedor sai (a base da empresa, a localização do celular ou outro endereço; o
            administrador pode guardar o endereço digitado como base da empresa), o horário, quanto tempo dura
            cada visita, o almoço e até quantos km da saída.
          </li>
          <li>
            Clique em <b>Sugerir roteiro do dia</b>. Os leads mais importantes entram primeiro (nota, quem já
            está em conversa e quem tem próximo passo vencido), até o dia acabar.
          </li>
          <li>
            Ajuste à mão se quiser: tire uma visita no <b>×</b>, mude a ordem com as setas ou clique num lead
            do mapa para incluir. <b>Otimizar a ordem</b> refaz o caminho para andar menos.
          </li>
          <li>
            Clique em <b>Mandar para o celular</b> do vendedor. Ele recebe o aviso e o roteiro aparece em{' '}
            <b>Na rua</b>.
          </li>
        </Passos>
        <p>
          Os pontinhos do mapa são os leads da campanha, na cor da nota. Os apagados não entram pelos filtros
          escolhidos ou já estão no roteiro de outra pessoa nesse dia. Lead que foi visitado nos últimos dias
          não é sugerido de novo.
        </p>
        <h3>No celular</h3>
        <Passos>
          <li>
            Abra <b>Na rua</b>: aparece a próxima visita, com o endereço, com quem falar e em que pé está a
            negociação.
          </li>
          <li>
            <b>Ir com o Waze</b> (ou Google Maps) abre o caminho. Ao chegar, toque em <b>Cheguei</b>: o
            sistema guarda a hora e confere se você está no endereço da empresa.
          </li>
          <li>
            Na visita, escolha <b>como foi</b> (falei com quem decide, pediu proposta, marcou reunião, não
            estava, sem interesse, fechou), escreva ou fale a anotação e, se quiser, tire a foto da fachada.
          </li>
          <li>
            O próximo passo vem sugerido (lido da sua anotação, quando a IA está ligada); troque se quiser.{' '}
            <b>Concluir e ir para a próxima</b> volta para o roteiro.
          </li>
        </Passos>
        <p>
          A visita entra no histórico do lead e o funil anda conforme o resultado: pediu proposta vai para
          Proposta; marcou reunião, para Reunião; fechou, para Ganho; sem interesse, para Perdido. O lead
          nunca volta de etapa. Não deu para ir? Use <b>Pular esta visita</b> (dá para voltar depois).
        </p>
        <h3>Acompanhar a equipe</h3>
        <p>
          Em <b>Visitas da equipe</b>, o gestor vê, por dia, semana ou mês: visitas feitas, quantas foram com
          quem decide, propostas e reuniões, e os km planejados. Cada vendedor aparece com o andamento e onde
          está agora (na visita tal desde que horas, a caminho da próxima, terminou), e as últimas visitas
          trazem a anotação e a foto.
        </p>
        <Nota>
          A localização do vendedor só é usada no momento do check-in, para conferir a chegada: o sistema não
          acompanha o celular durante o dia. Sem o cálculo pelas ruas ligado (chave do OpenRouteService), os
          tempos são estimados pela distância. A foto da fachada precisa do armazenamento de arquivos (o mesmo
          das gravações), e falar a anotação precisa da voz do Argos.
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
          difíceis (“quem é?”, quanto custa, atendimento fora da região, “você é um robô?”, pressão por
          desconto, cliente irritado, tentativa de tirar ela das regras). Você também cria os seus cenários.
          Use o <b>Simulador</b> para conversar com ela como se fosse um cliente.
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
        <p>
          Antes da primeira sequência, o administrador cadastra o domínio de e-mail da empresa (veja o artigo
          “Domínio de e-mail: como configurar”).
        </p>
      </>
    ),
  },
  {
    id: 'email-dominio',
    area: 'Vendas',
    titulo: 'Domínio de e-mail: como configurar',
    resumo:
      'Os e-mails saem com o domínio da sua empresa. Passo a passo do DNS, sem criar conta em outro serviço.',
    onde: { rotulo: 'E-mail › Configuração', para: '/email?aba=config' },
    termos:
      'email e-mail domínio dominio dns registro txt mx spf dkim dmarc remetente registro.br godaddy hostinger cloudflare locaweb verificar configurar envio',
    corpo: (
      <>
        <p>
          Os e-mails das sequências saem com o domínio da sua empresa (ex.:
          comercial@contato.suaempresa.com.br). Você não precisa criar conta em nenhum serviço de e-mail:
          basta copiar alguns registros para o DNS do seu domínio. Só o administrador da conta vê essa parte.
        </p>
        <h3>Antes de começar</h3>
        <ul>
          <li>
            Você precisa de um domínio próprio da empresa (ex.: suaempresa.com.br). Gmail, Hotmail, Outlook e
            parecidos não servem, porque o domínio não é seu.
          </li>
          <li>
            Saiba onde o domínio está registrado: Registro.br, GoDaddy, Hostinger, Locaweb, Cloudflare… É lá
            que ficam os registros de DNS. Se não souber, pergunte a quem cuida do site da empresa.
          </li>
          <li>
            Use um <b>subdomínio só para prospecção</b>, como <b>contato.</b>suaempresa.com.br. Assim o e-mail
            do dia a dia da empresa fica protegido se algum envio de prospecção for marcado como spam.
          </li>
        </ul>
        <h3>Passo a passo</h3>
        <ol>
          <li>
            Em <b>E-mail › Configuração › Domínio de e-mail</b>, digite o domínio (ex.:
            contato.suaempresa.com.br) e clique em <b>Cadastrar domínio</b>.
          </li>
          <li>
            A tela mostra 3 ou 4 registros (tipo, nome e valor), cada um com o botão de copiar. Abra o painel
            onde o domínio está, entre na parte de <b>DNS</b> ou <b>Zona DNS</b> e crie cada registro com o
            mesmo tipo, nome e valor.
          </li>
          <li>
            Volte ao sistema e clique em <b>Já configurei, conferir</b>. O DNS costuma levar de minutos a
            algumas horas para valer; se ainda não achar, espere um pouco e confira de novo.
          </li>
          <li>
            Quando aparecer <b>Verificado</b>, escolha o <b>remetente</b> (a parte antes do @, ex.: comercial)
            e clique em <b>Salvar remetente</b>.
          </li>
          <li>
            Na aba <b>Identidade visual</b>, coloque o nome que o lead vê, a assinatura e o logo. Depois mande
            um teste para você numa sequência antes de ligar.
          </li>
        </ol>
        <h3>Se não verificar</h3>
        <ul>
          <li>
            Muitos painéis completam o domínio sozinhos no campo do nome. Se a tela mostra o nome
            <b> send.contato.suaempresa.com.br</b> e o painel já acrescenta “.suaempresa.com.br”, digite só
            <b> send.contato</b>.
          </li>
          <li>Confira se o valor foi colado inteiro, sem espaço no começo ou no fim.</li>
          <li>
            Não apague os registros que já existem no DNS (do site e do e-mail do dia a dia). Só acrescente os
            novos.
          </li>
          <li>Passou um dia e continua “Não encontrado”: fale com o suporte do Prospect Team.</li>
        </ul>
        <Nota>
          As respostas dos leads voltam para o próprio sistema (aba Respostas e a ficha de cada empresa). Quem
          responde sai da sequência sozinho. No começo, mande poucos e-mails por dia: domínio novo precisa
          ganhar confiança aos poucos.
        </Nota>
      </>
    ),
  },
  {
    id: 'marca-dominio',
    area: 'Gestão',
    titulo: 'Marca e domínio próprio',
    resumo:
      'O sistema com o nome, a cor, o logo e o endereço da sua empresa (crm.suaempresa.com.br). Você mesmo configura.',
    onde: { rotulo: 'Marca e domínio', para: '/marca' },
    termos:
      'marca white label logo logotipo cor ícone icone favicon imagem divulgação fundo fundos reunião desfoque cenário foto domínio dominio próprio endereço subdomínio crm dns cname registro.br cloudflare hostinger godaddy whatsapp prévia link personalizar',
    corpo: (
      <>
        <p>
          No plano Escala, o sistema fica com a cara da sua empresa: o nome, a cor e o logo aparecem no menu,
          no login, na sala de reunião e nos relatórios, e a equipe e os clientes usam o endereço da empresa.
          O Prospect Team fica só num discreto “Tecnologia Prospect Team” no rodapé. Quem configura é o gestor
          da organização (ou o administrador, quando a empresa tem uma unidade só), e vale para todas as
          unidades.
        </p>
        <h3>Marca</h3>
        <ul>
          <li>
            <b>Nome</b> e <b>cor principal</b>: a cor vira a cor dos botões e destaques. Cores muito claras
            não são aceitas, porque o texto branco dos botões ficaria ilegível.
          </li>
          <li>
            <b>Logo</b>: PNG com fundo transparente fica melhor. Vai no menu, no login e na sala de reunião.
          </li>
          <li>
            <b>Ícone</b>: uma imagem quadrada (o sistema ajusta o tamanho). É o ícone da aba do navegador e do
            app instalado no celular.
          </li>
          <li>
            <b>Imagem de divulgação</b>: aparece ao lado do login e na prévia quando alguém manda um link do
            sistema no WhatsApp (convite, reunião). Sem ela, usamos a cor com o logo.
          </li>
        </ul>
        <p>
          O quadro <b>Como fica</b> mostra o resultado antes de salvar. <b>Voltar ao padrão</b> tira tudo.
        </p>
        <h3>Domínio próprio, passo a passo</h3>
        <Passos>
          <li>
            Escolha um <b>subdomínio</b> do site da empresa, como <b>crm.</b>suaempresa.com.br ou{' '}
            <b>sistema.</b>suaempresa.com.br, e clique em <b>Usar este endereço</b>. O site da empresa
            continua igual.
          </li>
          <li>
            A tela mostra um registro (tipo <b>CNAME</b>, nome e valor) com botões de copiar. Escolha onde o
            seu domínio está (Registro.br, Cloudflare, Hostinger, GoDaddy ou outro) e siga o passo a passo que
            aparece. Não tem acesso ao DNS? <b>Copiar instruções</b> gera um texto pronto para mandar a quem
            cuida do site.
          </li>
          <li>
            Pronto. O sistema confere sozinho a cada 5 minutos e o domínio passa a valer assim que o DNS
            chegar (de minutos a algumas horas). Se quiser, clique em <b>Conferir agora</b>.
          </li>
        </Passos>
        <p>
          Quando aparece <b>Ativo</b>, o login, os links de reunião, os convites e o “esqueci a senha” saem
          com o seu endereço, com cadeado (HTTPS) renovado sozinho. O endereço de antes continua funcionando.
          Na primeira vez no endereço novo, cada pessoa entra de novo com e-mail e senha.
        </p>
        <h3>Se não ativar</h3>
        <ul>
          <li>
            Muitos painéis completam o nome sozinhos com o domínio: se a tela mostra o nome <b>crm</b>, digite
            só <b>crm</b> (e não crm.suaempresa.com.br).
          </li>
          <li>
            No Cloudflare, deixe a nuvem <b>cinza</b> (Proxy desligado, “DNS only”). Com a nuvem laranja o
            endereço não ativa.
          </li>
          <li>
            Se aparecer também um registro <b>TXT</b>, o endereço já foi usado em outro site: crie os dois.
          </li>
          <li>Passou um dia e continua aguardando: fale com o suporte do Prospect Team.</li>
        </ul>
        <h3>Fundos das reuniões</h3>
        <p>
          Na aba <b>Fundos das reuniões</b>, os cenários já aparecem com a sua logo. Para cada um:
        </p>
        <ul>
          <li>
            <b>Liberar ou não</b> para a equipe (a caixinha no cartão) e <b>Usar como padrão ao entrar</b>:
            todo mundo do time já entra com ele.
          </li>
          <li>
            <b>Onde a logo fica</b> (na parede de vidro, na TV, no quadro, num canto de cima…) e o{' '}
            <b>estilo</b>: placa branca, adesivo na cor da marca (para logo com fundo transparente) ou a logo
            como está. Os lugares ficam fora de onde a pessoa aparece.
          </li>
          <li>
            <b>Enviar foto da empresa</b> (recepção, fachada, showroom, até 8): o sistema ajusta para
            1920×1080 e a logo entra num canto, se você quiser.
          </li>
          <li>
            <b>Travar o fundo padrão</b>: o time fica sempre com ele. <b>Desfoque e cenários sem logo</b>{' '}
            deixa cada pessoa usar também o desfoque e os cenários simples.
          </li>
          <li>
            <b>Ver na minha câmera</b> mostra como você aparece com o fundo antes de liberar. Mudou a logo em
            Marca, os fundos mudam juntos.
          </li>
        </ul>
        <Nota>
          A marca própria é para usar o sistema com a marca da sua empresa, com a sua equipe e os seus
          clientes. Não inclui revender o sistema para outras empresas.
        </Nota>
      </>
    ),
  },
  {
    id: 'meu-plano',
    area: 'Gestão',
    titulo: 'Planos, módulos e limites',
    resumo: 'O que cada plano libera, os módulos à parte, os números de WhatsApp e as franquias do mês.',
    onde: { rotulo: 'Meu plano', para: '/plano' },
    termos:
      'plano start time escala módulo preço mensalidade limite franquia número whatsapp extra agente ia conversas horas reunião cadeado bloqueado liberar upgrade',
    corpo: (
      <>
        <p>
          Todos os planos têm a base: campanhas por nicho e cidade, enriquecimento com decisor e contatos,
          nota A, B e C, funil, ficha do lead, tarefas, Meu dia e os relatórios do funil e das campanhas. O
          que muda de um plano para o outro:
        </p>
        <ul>
          <li>
            <b>Start</b>: a base, para até 2 pessoas e 2 mil leads por mês.
          </li>
          <li>
            <b>Time</b>: soma o trabalho em equipe (distribuição automática dos leads, metas e “só a própria
            base”), vários funis, a cadência automática de follow-up, os relatórios completos (desempenho,
            radar e atividade), reuniões por vídeo (30 horas por mês), vendas na rua, as notificações no
            celular e a prospecção por e-mail.
          </li>
          <li>
            <b>Escala</b>: tudo do Time, mais o Argos, várias unidades com o painel do gestor, marca própria,
            auditoria com duas etapas obrigatória e reuniões por vídeo sem limite de horas.
          </li>
        </ul>
        <h3>Módulos à parte (em qualquer plano)</h3>
        <ul>
          <li>
            <b>WhatsApp + Agente de IA</b>: o WhatsApp integrado com 3 números e a IA que aborda, responde e
            marca reunião, sem limite de conversas. Com todos os números em uso, “Conectar número” avisa que
            chegou ao limite.
          </li>
          <li>
            <b>Número de WhatsApp extra</b>: cada número além dos 3 do módulo.
          </li>
          <li>
            <b>Usuário adicional</b>: cada pessoa a mais que o plano inclui.
          </li>
        </ul>
        <h3>Quando algo não está no plano</h3>
        <p>
          O item aparece no menu com um cadeado e a tela explica o que ele faz e a partir de qual plano vem.
          Para liberar, fale com a gente: a mudança vale na hora, sem perder nada do que já está no sistema.
          Em <b>Meu plano</b> você vê o que está incluído e quanto já usou no mês: leads, usuários, números de
          WhatsApp, horas de reunião e conversas da IA. Tudo volta a zero no dia 1º.
        </p>
        <Nota>
          As horas de reunião somam o tempo de todas as reuniões abertas no mês, de todas as unidades. Com as
          horas esgotadas, a reunião que já está acontecendo continua; as novas esperam o dia 1º ou mais
          horas.
        </Nota>
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
    termos: 'assistente voz perguntar mapa galáxia memória lembrar esquecer inventar números conferência',
    corpo: (
      <>
        <p>
          Pergunte ao <b>Argos</b> sobre o seu comercial, por voz ou por texto. O histórico das conversas é só
          seu. Ele vê os mesmos dados que você: quem só vê a própria base recebe respostas só sobre ela.
        </p>
        <h3>De onde vêm as respostas</h3>
        <ul>
          <li>
            <b>Números do comercial</b>: ele consulta o banco na hora (funil, campanhas, conversas, tarefas,
            e-mails). Cada número da resposta é conferido com o resultado da consulta antes de chegar a você;
            se não bater, ele refaz, e se ainda assim não conferir, ele não fala o número e mostra só a tabela
            do banco.
          </li>
          <li>
            <b>O que a empresa vende</b>: a Configuração da IA de atendimento (só as partes conferidas) e a
            Base de conhecimento. O que não estiver cadastrado, ele diz que não está.
          </li>
          <li>
            <b>A sua memória</b>: o que você pediu para ele guardar.
          </li>
        </ul>
        <h3>Memória</h3>
        <p>
          Diga “lembra que minha meta é 30 reuniões por mês” ou “quando eu falar farmácias, é a campanha
          Farmácias de Maceió”, e ele usa isso nas próximas perguntas. Para tirar, diga “esquece…” ou apague
          em <b>O que o Argos lembra</b>, no painel de conversas. A memória é só sua: ninguém da equipe vê. Se
          a memória e o banco disserem coisas diferentes, vale o banco.
        </p>
        <p>
          O <b>Mapa do conhecimento</b> mostra o comercial como uma galáxia: cada etapa do funil é um
          aglomerado, cada empresa em negociação uma estrela, e as pessoas da equipe ficam no meio das
          empresas que conduzem.
        </p>
      </>
    ),
  },
  {
    id: 'painel-plataforma',
    area: 'Painel da plataforma',
    soMaster: true,
    titulo: 'Financeiro, clientes, configurações e CRM de demonstração',
    resumo:
      'Receita e custo de cada cliente, desativar ou excluir, e-mail e senha, os serviços da plataforma e o CRM com dados fictícios.',
    onde: { rotulo: 'Financeiro', para: '/plataforma/financeiro' },
    termos:
      'master painel plataforma domínio dominio vercel white label marca administrador administradores novo master outro master excluir cliente desativar reativar mudar email senha acesso financeiro mrr receita margem custo módulos contratado franquia configuração serviços chave railway testar demonstração demo apresentar dados fictícios',
    corpo: (
      <>
        <p>
          Quem administra a plataforma entra direto no painel: Visão geral, Vendas, Clientes, Financeiro,
          Configurações, Operação e Base CNPJ. A sua própria conta e o CRM de demonstração não entram nos
          números de clientes.
        </p>
        <h3>Financeiro</h3>
        <ul>
          <li>
            <b>Números do mês</b>: receita mensal (e por ano), clientes pagantes, ticket médio, custo, margem
            e quanto da receita vem de módulos e extras.
          </li>
          <li>
            <b>Receita por plano</b>, <b>módulos e extras</b> (WhatsApp + IA, números e usuários a mais) e{' '}
            <b>custo por serviço</b> (IA, WhatsApp, reuniões e gravações, buscas, e-mail e infraestrutura).
          </li>
          <li>
            <b>Tabela de clientes</b>: o que cada um contratou, quanto já usou das franquias (leads, horas de
            reunião, conversas da IA), as bolinhas de configuração, mensalidade, custo, margem e situação.
            Filtre por plano, ordene por menor margem e baixe a planilha.
          </li>
          <li>
            Clique no nome para ver <b>de onde vem a receita</b> e <b>para onde vai o custo</b>, as franquias,
            o que falta configurar e uma sugestão de venda quando o cliente está no limite do plano.
          </li>
        </ul>
        <Nota>
          Custo é estimativa: o uso real vezes os custos unitários (botão Custos unitários). Ajuste os valores
          pelas suas faturas para a margem ficar certa. Com valor combinado, os itens da mensalidade aparecem
          na proporção.
        </Nota>
        <h3>Gestão do cliente</h3>
        <p>No detalhe do cliente (Financeiro) ou em Clientes › Dados da conta e Usuários:</p>
        <ul>
          <li>
            <b>E-mail e senha</b>: muda o e-mail de login de alguém ou define uma senha nova (pelo menos 8
            caracteres, com letras e números). Quem estava conectado sai e entra com a nova. Passe a senha por
            um canal seguro; a pessoa pode trocar depois em Minha conta. Fica registrado na Auditoria da
            conta.
          </li>
          <li>
            <b>Desativar cliente</b>: ninguém dele entra, em nenhuma unidade, e os envios automáticos param.
            Os dados ficam guardados; <b>Reativar cliente</b> volta tudo como estava. No Financeiro, o filtro
            de situação mostra os desativados.
          </li>
          <li>
            <b>Excluir cliente</b>: só aparece com o cliente desativado e pede o nome dele digitado. Apaga as
            unidades, os usuários e tudo o que é deles (funil, conversas, campanhas, reuniões, visitas). Não
            tem volta. As empresas pesquisadas continuam na base da plataforma.
          </li>
        </ul>
        <h3>Configurações da plataforma</h3>
        <p>
          A lista dos serviços que a plataforma usa para todos os clientes (WhatsApp, e-mail, IA, reuniões,
          gravações, transcrição, voz do Argos, rotas, Google Maps e buscas), se estão funcionando e o que
          falta. <b>Testar</b> faz uma chamada mínima ao serviço; <b>Como fazer</b> diz qual variável colocar
          e em qual serviço do Railway. Ao lado ficam a tabela de preços, os custos unitários e o contato do
          site.
        </p>
        <h3>Administradores da plataforma</h3>
        <p>
          Em Configurações › <b>Administradores da plataforma</b>, <b>Novo administrador</b> cria o acesso
          master de outra pessoa: ela recebe um link para criar a senha e entra direto no painel, vendo e
          mudando tudo. Na lista dá para gerar um link de nova senha, mudar e-mail e senha, desativar (sai na
          hora) ou <b>tirar o acesso</b> (continua na equipe da sua conta, sem o painel). Ninguém mexe no
          próprio acesso, sempre sobra pelo menos um administrador ativo e o <b>acesso de emergência</b> (o
          e-mail configurado no servidor) não se desativa por aqui. Tudo fica na Auditoria.
        </p>
        <h3>Conta da plataforma</h3>
        <p>
          A conta onde ficam os administradores e as chaves da plataforma não é cliente: não aparece em
          Clientes nem no Financeiro, e quem administra trabalha só no painel (o CRM, pela demonstração ou
          entrando na conta de um cliente). Se sobrou algo de quando ela era usada como CRM, Configurações ›{' '}
          <b>Conta da plataforma</b> › <b>Zerar dados antigos</b> apaga campanhas, funil, conversas, reuniões
          e avisos, e mantém administradores, chaves, números, configurações e o histórico de custo.
        </p>
        <h3>Domínio próprio dos clientes</h3>
        <p>
          Os clientes do plano Escala configuram sozinhos o endereço próprio (Marca e domínio). Para isso
          funcionar, a plataforma precisa do acesso ao Vercel: em Configurações, o serviço{' '}
          <b>Domínio próprio dos clientes</b> mostra se está tudo certo e, em <b>Como fazer</b>, quais
          variáveis colocar no Railway. Nada de domínio é feito à mão: o sistema cadastra o endereço no
          projeto do painel, confere o DNS e gera o cadeado.
        </p>
        <h3>CRM de demonstração</h3>
        <Passos>
          <li>
            Clique em <b>Abrir a demonstração</b> (no menu ou em Configurações). Na primeira vez os dados são
            gerados na hora.
          </li>
          <li>
            Apresente à vontade: campanhas de clínicas, construtoras e pet shops em Salvador, funil, conversas
            no WhatsApp, reuniões gravadas com resumo e um roteiro de visitas.
          </li>
          <li>
            Depois, <b>Recriar os dados</b> volta tudo ao ponto de partida, e{' '}
            <b>Voltar ao painel da plataforma</b> sai da demonstração.
          </li>
        </Passos>
        <Nota>
          A demonstração é uma conta separada: não aparece em Clientes nem no Financeiro e as campanhas dela
          nunca buscam empresas de verdade. Nada que você fizer lá afeta um cliente.
        </Nota>
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
