import { PARADA_QUADROS_MIN } from '@prospeccao/shared/quadros';
import { Icon } from '@prospeccao/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { abrirTour } from './tour/abrir';

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
    id: 'tour',
    area: 'Começo',
    titulo: 'Tour do sistema',
    resumo: 'Uma volta guiada pelo Argos pelas telas principais, em poucos minutos.',
    termos: 'tour vídeo tutorial apresentação boas-vindas volta guiada como funciona começo',
    corpo: (
      <>
        <p>
          No primeiro acesso, o sistema convida para o <b>Tour do sistema</b>: o Argos mostra, nas telas de
          verdade, o principal de cada parte e onde fica cada coisa. Só entra o que a sua conta contratou.
        </p>
        <p>
          <button type="button" className="ajuda-tour" onClick={() => abrirTour()}>
            Assistir o tour
          </button>
        </p>
        <ul>
          <li>Cada tela espera a fala terminar; a legenda mostra a frase da vez, para assistir sem som.</li>
          <li>Os capítulos embaixo pulam para qualquer parte, e a barra mostra onde você está.</li>
          <li>Pausar e continuar seguem de onde parou. Feche quando quiser e volte aqui para ver de novo.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'menu-e-celular',
    area: 'Começo',
    titulo: 'O menu e o uso no celular',
    resumo: 'Onde fica cada tela, como abrir os grupos do menu e como usar o sistema pelo celular.',
    onde: { rotulo: 'Meu dia', para: '/hoje' },
    termos: 'menu celular mobile aplicativo grupos mais barra navegação',
    corpo: (
      <>
        <p>
          No computador, o menu do lado esquerdo junta as telas em grupos. Clique no nome do grupo para abrir
          ou fechar. O grupo da tela em que você está abre sozinho, e o sistema lembra quais você deixou
          abertos.
        </p>
        <ul>
          <li>
            <b>Meu dia</b>: o que fazer hoje.
          </li>
          <li>
            <b>Prospecção</b>: Leads, Campanhas, Nichos e Atividade.
          </li>
          <li>
            <b>Vendas</b>: Funil, Conversas, Reuniões e Na rua.
          </li>
          <li>
            <b>Automação</b>: E-mail, Agente de IA e Instagram.
          </li>
          <li>
            <b>Argos</b>: o assistente e o mapa do conhecimento.
          </li>
          <li>
            <b>Gestão</b>: Relatórios, Equipe, Integrações, Marca e domínio, Meu plano e Auditoria.
          </li>
        </ul>
        <p>
          Com o grupo fechado, o número ao lado dele soma o que está esperando você lá dentro (por exemplo,
          conversas não lidas). Ajuda, avisos e sair ficam nos ícones do rodapé do menu.
        </p>
        <p>
          <b>No celular</b>, o menu vira uma barra embaixo da tela com <b>Meu dia</b>, <b>Leads</b>,{' '}
          <b>Funil</b> e <b>Conversas</b>. O botão <b>Mais</b> abre todas as outras telas, a ajuda, a sua
          conta e o sair. Em cima ficam os avisos e a sua foto (que abre a sua conta).
        </p>
        <Passos>
          <li>As listas (leads, equipe, clientes…) aparecem como cartões, um embaixo do outro.</li>
          <li>No funil, deslize para o lado para passar de uma etapa para a outra.</li>
          <li>
            Os filtros do funil ficam no botão <b>Filtros</b>; o número mostra quantos estão ligados.
          </li>
          <li>Em Conversas, toque numa conversa para abrir e use a seta para voltar à lista.</li>
        </Passos>
        <p>
          Dica: no navegador do celular, use “Adicionar à tela de início” para abrir o sistema como um
          aplicativo.
        </p>
      </>
    ),
  },
  {
    id: 'acesso-seguro',
    area: 'Começo',
    titulo: 'Acesso e proteção dos dados',
    resumo: 'Senha, verificação em duas etapas, aparelhos conectados e como o sistema protege os dados.',
    termos:
      'senha esqueci a senha travado bloqueado muitas tentativas duas etapas código aplicativo autenticador sessões aparelhos conectados sair de todos convite link segurança proteção dados lgpd vazamento',
    corpo: (
      <>
        <p>
          Cada pessoa entra com o próprio e-mail e senha. Em <b>Minha conta</b> (no seu nome, no canto da
          tela) você troca a senha, liga a <b>verificação em duas etapas</b> (o código do aplicativo
          autenticador no celular) e vê <b>onde está conectado</b>, podendo sair dos outros aparelhos.
        </p>
        <h3>Senha errada várias vezes</h3>
        <p>
          A cada 5 tentativas erradas seguidas (de senha ou do código das duas etapas), o acesso da pessoa
          fica travado por 15 minutos; se continuar errando, a espera aumenta. Para destravar na hora, use{' '}
          <b>Esqueci a senha</b>: ao criar a senha nova, o acesso volta. O código do aplicativo vale uma vez
          só.
        </p>
        <h3>Links de convite e de senha nova</h3>
        <ul>
          <li>
            O convite vale por 7 dias e o link de senha esquecida, por 1 hora; os dois funcionam uma vez só.
            Gerar um link novo cancela a senha antiga e tira a pessoa de todos os aparelhos.
          </li>
          <li>
            O administrador da unidade gera links só para a equipe da unidade. O link do gestor e da diretoria
            sai pela tela da organização.
          </li>
          <li>Trocar a senha também tira a pessoa dos outros aparelhos.</li>
        </ul>
        <h3>Como os dados ficam protegidos</h3>
        <ul>
          <li>Tudo trafega com criptografia (https), e o acesso só funciona pelo endereço do sistema.</li>
          <li>
            Cada empresa cliente só enxerga os próprios leads, conversas e marcações (como “número errado”).
          </li>
          <li>
            Senhas, chaves de serviços e o segredo das duas etapas ficam guardados cifrados; os links de
            convite e de senha nova ficam guardados de um jeito que nem quem lê o banco consegue usar.
          </li>
          <li>O acesso de diretoria (só leitura) vê tudo, mas não exporta planilhas nem vê chaves.</li>
        </ul>
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
    id: 'quadros',
    area: 'Vendas',
    titulo: 'Quadros com gatilhos da IA',
    resumo:
      'Quadros com as colunas que você quiser (achou caro, sem estoque, vai pensar); a IA lê as conversas e põe cada lead na coluna certa, com o trecho que mostra isso.',
    onde: { rotulo: 'Quadros', para: '/quadros' },
    termos:
      'quadro quadros kanban coluna colunas gatilho gatilhos IA objeção objeções achou caro sem estoque vai pensar concorrente orçamento sugestão confirmar descartar mover arrastar',
    corpo: (
      <>
        <p>
          O <b>Funil</b> mostra as etapas da venda. Os <b>Quadros</b> mostram outras coisas que você quer
          acompanhar: as objeções (“achou caro”, “sem estoque”), o atendimento (“pediu orçamento”, “orçamento
          enviado”, “fechou”) ou o que fizer sentido para a sua loja. Cada lead fica em uma coluna de cada
          quadro.
        </p>
        <h3>Montar o quadro (administrador)</h3>
        <ul>
          <li>
            Em <b>Vendas › Quadros</b>, clique em <b>Criar o primeiro quadro</b> (ou <b>Novo quadro</b>). Dá
            para começar de um modelo e mudar tudo.
          </li>
          <li>
            Cada coluna pode ter um <b>gatilho</b>: a situação que põe o lead nela, escrita como você
            explicaria para um vendedor novo (“o cliente disse que achou caro ou pediu desconto”). Coluna sem
            gatilho é só para mover à mão.
          </li>
          <li>
            Escolha o que a IA faz quando acha um gatilho: <b>sugere e alguém confirma</b> (o dono do lead
            recebe um aviso) ou <b>já move</b>. Também dá para desligar a IA no quadro e usar só à mão.
          </li>
          <li>Até 10 quadros por conta e 12 colunas por quadro. Tirar uma coluna tira os leads dela.</li>
        </ul>
        <h3>Como a IA lê</h3>
        <ul>
          <li>
            Ela lê as conversas do WhatsApp e do Instagram quando param por {PARADA_QUADROS_MIN} minutos, para
            não ler no meio da conversa, e só quando chegou mensagem nova. Uma leitura vale para todos os
            quadros.
          </li>
          <li>
            Só move quando o que foi dito nas mensagens novas mostra o gatilho, e mostra no cartão o trecho da
            conversa, palavra por palavra, e o porquê. Na dúvida, não move.
          </li>
          <li>
            Ela lê só as conversas do último dia: criar um quadro não relê as conversas antigas. Para pôr
            leads antigos, use o <b>+</b> da coluna.
          </li>
          <li>
            Usa a IA da conta (conta no consumo do mês). Com a IA desligada ou no limite do mês, a leitura
            para e o quadro continua funcionando à mão.
          </li>
        </ul>
        <h3>No dia a dia</h3>
        <ul>
          <li>
            A sugestão da IA aparece tracejada na coluna sugerida. <b>Confirmar</b> põe o lead lá;{' '}
            <b>Descartar</b> deixa onde estava.
          </li>
          <li>
            Arraste o cartão para outra coluna para mover à mão, ou use o <b>+</b> da coluna para pôr um lead
            do funil. Clique no cartão para abrir a ficha; <b>Conversa</b> abre o WhatsApp do lead.
          </li>
          <li>
            Cada pessoa vê os cartões dos leads que ela vê no funil (quem trabalha só com a própria base vê só
            os seus). Tudo o que entra ou muda de coluna fica anotado no histórico do lead.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'ligacoes',
    area: 'Vendas',
    titulo: 'Ligações pelo CRM',
    resumo:
      'Ligue e receba ligações pelo navegador com o número da empresa, monte listas de ligação e veja o relatório; a IA resume e sugere o próximo passo.',
    onde: { rotulo: 'Ligações', para: '/ligacoes' },
    termos:
      'ligar ligação ligacao telefone telefonia chamada celular fixo número numero gravação gravar transcrição resumo clima sentimento caixa postal não atendeu número errado não ligar minutos franquia aviso LGPD discar lista de ligação discador paralelo power dialer receber recebida perdida siga-me celular retornar relatório melhor horário menu de voz URA central telefônica digite tecla loja setor grupo ligação de whatsapp chamada whatsapp z-api',
    corpo: (
      <>
        <p>
          Com o módulo <b>Ligações</b>, o time liga para o lead pelo próprio CRM, no navegador (fone e
          microfone, sem aparelho), com o número da empresa. Quem fala é sempre o comercial: a IA só ouve
          depois, para transcrever e resumir.
        </p>
        <h3>Ligar</h3>
        <Passos>
          <li>
            Abra o lead (no funil, em Leads ou em Conversas) e clique em <b>Ligar</b>. Na primeira vez, o
            navegador pede o microfone: clique em Permitir.
          </li>
          <li>
            O painel da ligação aparece no canto da tela: chamando, tocando e, quando atendem, o tempo da
            ligação. Dá para continuar mexendo no CRM durante a ligação.
          </li>
          <li>
            Use <b>Mudo</b>, o <b>Teclado</b> (para os menus de voz, “digite 1”) e <b>Desligar</b>. As
            anotações que você fizer vão para a nota da ligação.
          </li>
        </Passos>
        <h3>Vários números no lead</h3>
        <p>
          Na ficha, o quadro <b>Ligações</b> mostra todos os números do lead (do enriquecimento, do WhatsApp,
          do Google, da Receita e das pessoas da negociação) na ordem em que o CRM tenta: o confirmado ou com
          WhatsApp primeiro, celular antes de fixo. Quem não atendeu agora há pouco vai para o fim da fila, e
          número errado sai da lista. Para ligar para um número específico, use o botão ao lado dele.
        </p>
        <h3>Depois de desligar: “Como foi?”</h3>
        <ul>
          <li>
            Marque o resultado: conversou, não atendeu, caixa postal, ocupado, número errado ou não ligar
            mais.
          </li>
          <li>
            Em alguns segundos chega o <b>resumo da IA</b>: o que foi dito, o <b>clima</b> da conversa (bom,
            neutro ou ruim), como o lead estava e o próximo passo.
          </li>
          <li>
            A IA sugere o que fazer no lead: mover de etapa, <b>marcar a reunião</b> que foi combinada (com a
            sala de vídeo e o convite) e cadastrar as pessoas citadas (quem decide, por exemplo). Confira,
            desmarque o que não quiser e clique em <b>Salvar</b>.
          </li>
          <li>
            Não atendeu? Escolha quando ligar de novo: vira tarefa na sua agenda, e na próxima o CRM tenta o
            número seguinte.
          </li>
        </ul>
        <p>
          Tudo fica no histórico do lead: a gravação (com velocidade), o resumo e a transcrição com o tempo de
          cada fala. A tela <b>Vendas › Ligações</b> mostra as ligações de todo mundo, com filtros por pessoa,
          resultado e período.
        </p>
        <h3>Lista de ligação</h3>
        <p>
          Em <b>Vendas › Ligações › Lista de ligação</b>, escolha os leads (por etapa e responsável; desmarque
          os que não quiser) e clique em <b>Começar a ligar</b>. O CRM liga para um, você conversa, salva o
          “Como foi?” e, depois da pausa que você escolheu, ele liga para o próximo sozinho.
        </p>
        <ul>
          <li>
            <b>Um de cada vez</b>: uma ligação por vez.
          </li>
          <li>
            <b>Paralelo (2 ou 3)</b>: o CRM chama 2 ou 3 leads ao mesmo tempo e o primeiro que atende vai para
            você. Se outro atender enquanto você fala, ele ouve “estou terminando outra ligação e te retorno
            em instantes” e volta para o começo da lista, para você ligar logo em seguida.
          </li>
          <li>
            Quem não atende volta no fim da lista com o outro número do lead (se marcar essa opção, até 3
            tentativas). Os que não atenderam já ficam marcados como “não atendeu”, sem precisar do “Como
            foi?”.
          </li>
          <li>
            Use <b>Pausar</b> para parar (as ligações que estão tocando são desligadas e voltam para a fila),{' '}
            <b>Pular</b> para tirar um lead e <b>Encerrar lista</b> quando terminar. A lista só liga de
            segunda a sexta das 8h às 20h e sábado das 8h às 14h, e pula quem pediu para não receber ligação.
          </li>
        </ul>
        <Nota>Deixe a aba do CRM aberta enquanto a lista anda: é o navegador que faz as ligações.</Nota>
        <h3>Receber ligações</h3>
        <p>
          Quando alguém liga para o número da empresa, aparece um aviso na tela de quem está no CRM, com o
          nome do lead, a etapa e a próxima reunião, se tiver. Clique em <b>Atender</b> e fale pelo navegador,
          como numa ligação feita.
        </p>
        <ul>
          <li>
            Se o número é de um lead, toca primeiro só para o dono dele. Depois do tempo combinado (ou se ele
            clicar em <b>Passar para o time</b>), toca para todo mundo; quem atender primeiro leva.
          </li>
          <li>
            Número que não é de nenhum lead toca para o time. Depois da ligação, use <b>Criar lead</b> no
            “Como foi?”: a ligação e o resumo vão para a ficha nova.
          </li>
          <li>
            Ninguém atendeu no CRM: com o <b>siga-me</b> ligado, toca no celular do dono do lead (o cadastrado
            em Equipe; atendida no celular, a ligação não é gravada). Se ninguém atender, vira{' '}
            <b>ligação perdida</b>: o dono recebe um aviso e uma tarefa de retorno na agenda.
          </li>
        </ul>
        <p>
          As abas <b>Recebidas</b> e <b>Perdidas</b> mostram essas ligações. O administrador liga e desliga o
          receber pelo CRM, o tempo de cada etapa e o siga-me em <b>Gestão › Telefonia</b>.
        </p>
        <h3>Ligação pelo WhatsApp</h3>
        <p>
          Com o WhatsApp da conta ligado à telefonia (o suporte do Prospect Team configura a ponte com a
          Z-API), as ligações de WhatsApp para o número da loja chegam no CRM como as do telefone: aparece{' '}
          <b>Ligação de WhatsApp</b> na tela, com o mesmo menu de voz, os grupos, a gravação e o resumo da IA.
        </p>
        <ul>
          <li>
            Para ligar pelo WhatsApp, use o botão com o <b>balão</b> ao lado do número de celular, na ficha do
            lead (o de telefone continua ligando pela linha telefônica).
          </li>
          <li>Pelo WhatsApp, dá para até 3 ligações ao mesmo tempo no mesmo número (limite da Z-API).</li>
          <li>Ligação comum e a lista de ligação nunca saem pelo número de WhatsApp.</li>
        </ul>
        <h3>Menu de voz (uma loja ou setor por tecla)</h3>
        <p>
          Com várias lojas ou setores no mesmo número, ligue o <b>Menu de voz</b> em <b>Gestão › Telefonia</b>
          . Quem liga ouve a primeira frase que você escrever e as opções (“Para a Loja Centro, digite 1. Para
          a Loja Norte, digite 2.”) e escolhe pela tecla do telefone. Aí toca ao mesmo tempo para todos
          daquele grupo; quem atender primeiro leva. A pessoa ouve “Um momento, estamos chamando a Loja
          Centro” e o sinal de chamada até alguém atender.
        </p>
        <ul>
          <li>
            As opções são os <b>grupos de atendimento</b> de <b>Equipe</b>, na ordem em que aparecem lá (só os
            que têm alguém, até 9). Com um grupo só, o menu não pergunta nada e toca direto para ele.
          </li>
          <li>
            Se a pessoa não apertar nada (o menu repete uma vez) ou apertar uma tecla que não existe, toca
            para todo o time, como sem menu.
          </li>
          <li>
            O dono do lead toca primeiro se for do grupo escolhido. Se não for, toca só para o grupo, e o
            siga-me e o aviso de perdida também ficam com o grupo.
          </li>
          <li>Quem não é do grupo escolhido não vê a ligação nem consegue atender.</li>
          <li>Ninguém atendeu: vira ligação perdida e o aviso vai para quem é do grupo.</li>
        </ul>
        <h3>Relatório</h3>
        <p>
          A aba <b>Relatório</b> mostra quantas ligações foram feitas e atendidas, quantas viraram conversa (e
          quantas passaram de 2 minutos), as reuniões marcadas depois de uma ligação, o resumo por pessoa e um
          mapa de <b>quando o lead mais atende</b>, por dia da semana e hora, para montar as listas na hora
          certa.
        </p>
        <h3>Gravação e aviso (LGPD)</h3>
        <p>
          A ligação é gravada no navegador de quem liga e a pessoa do outro lado é avisada no começo: o
          sistema toca o aviso com voz ou, se preferir, o comercial lê a frase que aparece na tela. O
          administrador muda o texto, liga e desliga a gravação e escolhe por quanto tempo guardar em{' '}
          <b>Gestão › Telefonia</b>.
        </p>
        <Nota>
          Não feche a aba durante a ligação: a gravação sobe para o CRM quando a ligação termina (leva
          segundos).
        </Nota>
        <h3>Números e minutos</h3>
        <p>
          Os números da empresa são cadastrados pelo Prospect Team (escolha o DDD ou traga o número que já
          usa). Com mais de um número, o CRM liga com o do mesmo DDD do lead. O módulo vem com uma franquia de
          minutos por mês para a empresa toda; cada ligação atendida conta arredondada para cima, as que não
          atendem não contam. Em Gestão › Telefonia você acompanha o uso; os administradores recebem um aviso
          quando o mês passa de 80% e de 100% da franquia. Quem assina pelo sistema compra um pacote de
          minutos quando a franquia acaba (as ligações param até comprar; o que sobrar do pacote não vence;
          veja <Link to="/ajuda/assinatura">Teste grátis, assinatura e pagamento</Link>). Contrato combinado
          com a gente: as ligações continuam e o excedente vem na fatura.
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
        <p>
          Se o resumo e os próximos passos não ficarem prontos (a IA da conta desligada ou fora do ar na
          hora), a tela da reunião diz o motivo e mostra <b>Gerar o resumo agora</b>, para quem conduziu ou um
          administrador: a IA lê de novo a transcrição que já está pronta, sem transcrever outra vez.
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
          <li>
            <b>Seus fundos</b>: em <b>Ver todos os fundos</b> (antes de entrar) ou no painel Fundo, clique em{' '}
            <b>Enviar imagem</b> e escolha uma foto sua (até 5; o sistema ajusta o tamanho). Quem é do time
            encontra os fundos dele em qualquer computador; o convidado, só no navegador em que enviou. Para
            tirar, passe o mouse e clique no ×.
          </li>
          <li>Com logo ou foto no fundo, você vê a sua imagem sem o espelho, do jeito que os outros veem.</li>
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
    resumo:
      'QR Code, limite por dia, aquecimento, número de cada comercial e a proteção do número (porteiro).',
    onde: { rotulo: 'Agente › Atendimento', para: '/agente' },
    termos:
      'qr code chip conectar desconectar limite aquecimento bloqueio dono comercial porteiro proteção banimento ban banido mensagem repetida variar texto contatos novos pausa denunciar spam',
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
        <h3>Proteção do número (porteiro)</h3>
        <p>
          Quando a equipe toda usa o mesmo número (e ainda mais por uma API que não é a oficial do WhatsApp),
          o que mais derruba o número é: o mesmo texto para muita gente em pouco tempo, muitos contatos novos
          seguidos e continuar abordando quem pede para parar. Em{' '}
          <b>Agente › Atendimento › Proteção do número</b>, o administrador liga a proteção e escolhe os
          limites:
        </p>
        <ul>
          <li>
            <b>Mesmo texto para muita gente</b>: a mensagem que já foi, igual ou quase igual (trocar só o “bom
            dia” ou o nome não engana), para vários contatos dentro do tempo escolhido é segurada. Na conversa
            aparece o aviso com <b>Variar com a IA</b>: a IA reescreve com outras palavras e os mesmos preços,
            prazos e links, e você confere antes de mandar. No modo <b>Avisar</b>, dá para{' '}
            <b>Mandar mesmo assim</b> (fica registrado). Mensagem curta (“bom dia”, “ok, obrigado”) não conta.
          </li>
          <li>
            <b>Contatos novos</b> (a primeira mensagem para quem nunca conversou): até tantos por número por
            dia, somando a equipe e as mensagens automáticas, e uma espera entre um e outro. Número em
            aquecimento usa o teto menor do aquecimento.
          </li>
          <li>
            <b>Sinal de risco</b>: com 3 contatos pedindo para parar ou falando em denunciar, ou quase ninguém
            respondendo os contatos novos do dia, o número fica 6 horas sem abordar contatos novos (equipe e
            automáticos) e os administradores recebem um alerta. O administrador pode <b>Liberar agora</b>.
          </li>
          <li>Responder quem já conversa nunca é segurado (só a conferência de texto repetido vale).</li>
        </ul>
        <p>
          O painel mostra quantos contatos novos cada número já abordou hoje e o que a proteção segurou nos
          últimos 7 dias, com quem e para qual lead.
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
    id: 'instagram',
    area: 'WhatsApp e IA',
    titulo: 'Instagram: conteúdo, comente e receba, direct, formulários e vendas para a Meta',
    resumo:
      'Quem comenta a palavra recebe o seu direct; quem responde ou preenche o formulário do anúncio vira lead.',
    onde: { rotulo: 'Instagram', para: '/instagram' },
    termos:
      'instagram comente receba direct dm comentário palavra formulário anúncio meta facebook cadastro lead ads conversões pixel conjunto de dados gerenciador de eventos devolver vendas',
    corpo: (
      <>
        <p>
          Em <b>Automação › Instagram</b> o CRM recebe os leads que chegam pelo Instagram da empresa. Lead do
          Instagram não passa pelo enriquecimento: entra direto no funil, com a etiqueta “instagram”.
        </p>
        <p>
          Vem a partir do plano <b>Time</b>. A IA respondendo pelo direct precisa também do módulo{' '}
          <b>WhatsApp + Agente de IA</b>; sem ele, o time responde em Conversas.
        </p>
        <h3>1. Conectar (uma vez, pelo administrador)</h3>
        <Passos>
          <li>
            O Instagram precisa ser <b>conta profissional</b> (comercial ou criador) e estar ligado à{' '}
            <b>página do Facebook</b> da empresa.
          </li>
          <li>
            Na aba <b>Conexão</b>, clique em <b>Conectar Instagram</b>, entre com o Facebook de quem
            administra a página e escolha a conta.
          </li>
          <li>
            No app do Instagram: Configurações › Mensagens e respostas a stories › Ferramentas conectadas ›
            ligue <b>“Permitir acesso às mensagens”</b>. Sem isso, o direct não sai.
          </li>
        </Passos>
        <h3>2. Conteúdo: o que cada post trouxe</h3>
        <p>
          A aba <b>Conteúdo</b> mostra as publicações do período com os números do Instagram (alcance,
          curtidas, comentários, salvos e compartilhamentos) ao lado do que só o CRM sabe: quantos leads,
          reuniões e vendas cada post trouxe. A coluna <b>leads por mil de alcance</b> diz qual conteúdo
          converte, não só qual aparece.
        </p>
        <ul>
          <li>
            <b>Achados</b>: o formato que mais traz lead por alcance, o post do período e o que teve muito
            alcance e nenhum lead.
          </li>
          <li>
            Clique num post para ver o caminho do alcance até a venda e <b>todos os comentários</b>. Os que
            perguntam preço, pedem informação ou contato ficam em “Com interesse”, para responder, mandar
            direct ou criar o lead com um clique.
          </li>
          <li>
            Os números vêm do Instagram de 6 em 6 horas (ou no botão Atualizar) e podem levar até 48 horas
            para fechar num post novo. Stories ficam de fora: o Instagram só guarda os números deles por 24
            horas.
          </li>
        </ul>
        <Nota>
          Quem conectou o Instagram antes desta tela precisa clicar em <b>Reconectar</b> (aba Conexão) uma vez
          e aceitar a permissão das estatísticas.
        </Nota>
        <h3>3. Comente e receba</h3>
        <p>
          Clique em <b>Nova regra</b>, escolha a publicação (ou “a próxima que eu postar”, ou “qualquer
          publicação”) e as palavras, por exemplo PROSPECÇÃO. Quem comentar a palavra recebe a sua mensagem no
          direct na hora. A palavra vale sem acento e sem diferença de maiúscula.
        </p>
        <ul>
          <li>
            <b>Resposta no comentário</b> (opcional): aparece para todos, como “Te mandei no direct!”. Com
            mais de uma variação, o sistema sorteia.
          </li>
          <li>
            <b>Botão com link</b> (opcional): o material que você prometeu no post.
          </li>
          <li>
            <b>{'{nome}'}</b> na mensagem vira o primeiro nome de quem comentou, quando o Instagram mostra.
          </li>
        </ul>
        <Nota>
          Regras da Meta: só <b>uma</b> mensagem para cada comentário e até 7 dias depois dele (na live, só
          enquanto ela está no ar). A conversa continua quando a pessoa responde. Para testar, comente a
          palavra com outra conta sua.
        </Nota>
        <p>
          <b>Quando a pessoa responde, ela vira lead</b> no funil, na etapa e com o responsável que você
          escolheu na regra. Se ela mandar o telefone, o WhatsApp já fica salvo no lead. Com “O Agente de IA
          continua a conversa” marcado, a IA responde pelo direct (seguindo o que você ensinou em Agente de
          IA).
        </p>
        <p>
          Na lista, cada publicação mostra quantos comentaram, receberam o direct, responderam, viraram lead e
          marcaram reunião. Clique na publicação para ver cada pessoa; quem não respondeu dá para virar lead à
          mão com <b>Criar lead</b>.
        </p>
        <h3>4. Direct em Conversas</h3>
        <p>
          O Instagram é mais um canal em <b>Conversas</b> (dá para filtrar só ele). Embaixo, escolha
          <b> Instagram</b> para responder pelo direct. O Instagram só deixa responder até{' '}
          <b>24 horas depois da última mensagem da pessoa</b>; depois disso, siga pelo WhatsApp. Se alguém da
          equipe responder pelo app do Instagram, a mensagem também aparece aqui e a IA para de responder esse
          lead.
        </p>
        <p>
          Direct de quem não comentou em nenhuma regra: na aba Conexão você escolhe se vira lead ou fica só no
          Instagram.
        </p>
        <h3>5. Formulários dos anúncios</h3>
        <p>
          Anúncio com o objetivo <b>Cadastros</b> (formulário instantâneo), no Instagram ou no Facebook: cada
          cadastro cai no funil em segundos, com nome, telefone, e-mail e o anúncio de onde veio. Na aba{' '}
          <b>Formulários</b>, clique em <b>Buscar formulários na Meta</b> e, em <b>Configurar</b>, escolha o
          que cada pergunta vira no lead (o sistema já sugere), onde ele entra, as etiquetas e, se quiser, um
          WhatsApp de boas-vindas que sai na hora.
        </p>
        <h3>6. Devolver as vendas para a Meta</h3>
        <p>
          Sozinha, a Meta só sabe quem <b>preencheu</b> o formulário. Ligando esta opção, o CRM avisa a Meta
          cada vez que um desses cadastros anda no funil: <b>respondeu</b>, <b>reunião marcada</b>,{' '}
          <b>proposta enviada</b> e <b>virou cliente</b>. Com isso ela aprende quem compra de verdade e passa
          a mostrar o anúncio para gente parecida, o que tende a baixar o custo por cliente.
        </p>
        <Passos>
          <li>
            No <b>Gerenciador de Eventos</b> da Meta, abra <b>Fontes de dados</b> e escolha o conjunto de
            dados (o pixel da conta de anúncios). Copie o número que aparece embaixo do nome.
          </li>
          <li>
            Ainda nele, em <b>Configurações › API de Conversões</b>, clique em <b>Gerar token de acesso</b> e
            copie.
          </li>
          <li>
            Na aba <b>Formulários</b> do CRM, no quadro <b>Devolver as vendas para a Meta</b>, clique em{' '}
            <b>Ligar</b>, cole os dois e salve.
          </li>
          <li>
            Para conferir: na aba <b>Testar eventos</b> do Gerenciador, copie o código que começa com TEST,
            cole em <b>Testar agora</b> e clique em <b>Mandar teste</b>. O aviso aparece lá em segundos.
          </li>
        </Passos>
        <ul>
          <li>
            Cada etapa vai <b>uma vez</b> por lead e na ordem. Se o lead pulou etapas (foi direto para
            cliente), as que faltavam vão juntas.
          </li>
          <li>
            O CRM confere a cada minuto. Se a Meta recusar (token vencido, por exemplo), o quadro mostra o
            erro e os avisos ficam na fila até você salvar um token novo.
          </li>
          <li>
            Na Meta, os avisos aparecem no conjunto de dados como eventos do CRM. Depois de algumas semanas
            com vendas, dá para escolher no anúncio a otimização por <b>leads de conversão</b>.
          </li>
        </ul>
        <Nota>
          Vão só os cadastros dos <b>formulários de anúncio</b> (são eles que a Meta reconhece). Leads de
          comentário e de direct não vieram de anúncio e ficam de fora. Perdido e descartado não são enviados.
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
        <p>
          Tudo fica na aba <b>Marca</b>, com a prévia ao lado mostrando cada lugar antes de salvar.
        </p>
        <ul>
          <li>
            <b>Nome da marca</b>: vai no menu, na aba do navegador, nos e-mails e nas reuniões.
          </li>
          <li>
            <b>Duas logos</b>: a <b>para fundo escuro</b> (a versão branca, usada no menu na cor secundária,
            no login e na abertura do app) e a <b>para fundo claro</b> (menu claro, e-mails, relatório em
            PDF). PNG com fundo transparente fica melhor.
          </li>
          <li>
            <b>Três ícones</b> (quadrados, o sistema ajusta o tamanho): o da <b>aba do navegador</b>, o{' '}
            <b>ícone da marca</b> (sala de reunião e selos pequenos) e o do <b>app instalado</b> no celular,
            que aparece num círculo na cor secundária. Sem o da aba ou o do app, usamos o ícone da marca.
          </li>
          <li>
            <b>Quatro cores</b>, cada uma dizendo onde aparece: <b>primária</b> (botões), <b>secundária</b>{' '}
            (menu, login e abertura do app), <b>destaque</b> (links, gráficos e a rota no mapa) e <b>clara</b>{' '}
            (etiquetas e fundos de chips). A tela confere a leitura: cor que deixa o texto ilegível não é
            aceita. Em branco, fica a cor do sistema.
          </li>
          <li>
            <b>Menu lateral na cor secundária</b>: liga o menu escuro, com a logo para fundo escuro.
          </li>
          <li>
            <b>Imagem de divulgação</b>: aparece ao lado do login e na prévia quando alguém manda um link do
            sistema no WhatsApp (convite, reunião). Sem ela, usamos a cor secundária com a logo.
          </li>
        </ul>
        <p>
          A prévia tem as abas Painel, Login, Celular, Aba, Reunião, WhatsApp e E-mail.{' '}
          <b>Voltar ao padrão</b> tira tudo.
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
    id: 'integracoes',
    area: 'Gestão',
    titulo: 'Integrações: API, formulários do site e avisos',
    resumo:
      'Ligue o CRM ao site, ao ERP, à loja virtual e ao Make/Zapier: chaves da API, formulários direto no funil e avisos (webhooks).',
    onde: { rotulo: 'Integrações', para: '/integracoes' },
    termos:
      'api integração integracao chave token webhook aviso formulário formulario site elementor wordpress contact form rd station typeform google forms make zapier erp bling loja virtual n8n openapi postman desenvolvedor',
    corpo: (
      <>
        <p>
          Em <b>Gestão › Integrações</b> (só o administrador, a partir do plano Time) você liga o CRM aos
          outros sistemas da empresa, sem depender de ninguém. São três caminhos:
        </p>
        <h3>Formulários do site (sem programar)</h3>
        <Passos>
          <li>
            Clique em <b>Novo formulário</b> e dê um nome (um para cada formulário do site, para saber de onde
            veio cada lead).
          </li>
          <li>
            Copie o endereço e cole no construtor do formulário: Elementor (Ações após o envio › Webhook),
            Contact Form 7, RD Station, Typeform, Google Forms ou um formulário HTML comum. A tela mostra o
            passo a passo de cada um.
          </li>
          <li>
            Mande um envio de teste pelo próprio site. Os campos aparecem com a sugestão de para onde vai cada
            um (nome, WhatsApp, e-mail, empresa, cidade, CNPJ, origem da campanha ou anotação). Confira e
            salve.
          </li>
          <li>
            Escolha a etapa, quem cuida (ou o rodízio), as etiquetas e, se quiser, a mensagem de boas-vindas
            no WhatsApp.
          </li>
        </Passos>
        <p>
          Quem já é lead (mesmo telefone ou e-mail) não vira lead repetido: o envio entra como nota no lead
          que já existe. Campo novo no formulário aparece marcado; até você escolher, vai para a anotação.
          Robôs são barrados por um campo escondido e pelo limite de envios por minuto.
        </p>
        <h3>Chaves da API (para o ERP, a loja virtual, o BI)</h3>
        <ul>
          <li>
            Crie uma chave para cada sistema, com só o que ele precisa: criar leads, ler leads, mudar etapa e
            responsável, registrar atividades, ler funis e usuários, gerenciar avisos.
          </li>
          <li>
            A chave aparece <b>uma vez só</b>: copie e cole no sistema. Perdeu? Revogue e crie outra. Dá para
            pôr validade (30, 90 dias, 1 ano) e limitar a alguns endereços IP.
          </li>
          <li>
            O que chega pela API não duplica: mesmo telefone, e-mail ou CNPJ junta no lead que já existe. Tudo
            o que a API muda fica na Auditoria com o nome da chave.
          </li>
          <li>
            Limites: 600 chamadas por minuto por chave e 20 mil por dia para a empresa. A documentação
            completa, com exemplos, fica em prospectteam.com.br/api.
          </li>
        </ul>
        <h3>Avisos (webhooks)</h3>
        <p>
          O CRM avisa o outro sistema na hora em que algo acontece: lead criado, etapa mudou, responsável
          mudou, lead ganho ou perdido, mensagem recebida, reunião marcada e ligação encerrada (com o resumo).
          Exemplo: lead ganho cria o cliente no ERP.
        </p>
        <ul>
          <li>
            Clique em <b>Novo aviso</b>, informe o endereço (https) e escolha os eventos. Guarde o segredo:
            com ele o sistema confere que o aviso veio mesmo do CRM.
          </li>
          <li>
            Use <b>Enviar teste</b> para conferir. Cada entrega aparece no histórico com a resposta; se o
            outro sistema estiver fora do ar, o CRM tenta de novo 6 vezes (até 24 horas depois) e dá para{' '}
            <b>Reenviar</b>.
          </li>
          <li>Falhando por 3 dias seguidos, o aviso é pausado e os administradores recebem um alerta.</li>
        </ul>
        <Nota>
          Make e Zapier: use uma chave com a permissão “Gerenciar avisos”; eles se inscrevem sozinhos nos
          eventos.
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
          Todos os planos têm a base: campanhas por nicho e cidade, enriquecimento com possíveis decisores e
          contatos, nota A, B e C, funil, ficha do lead, tarefas, Meu dia e os relatórios do funil e das
          campanhas. O que muda de um plano para o outro:
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
          Para liberar, mude a assinatura em <b>Meu plano › Assinar</b> (ou fale com a gente, se o contrato
          foi combinado com o nosso time): a mudança vale na hora, sem perder nada do que já está no sistema.
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
    id: 'assinatura',
    area: 'Gestão',
    titulo: 'Teste grátis, assinatura e pagamento',
    resumo:
      'Os 7 dias de teste, assinar pelo sistema, pagar cada mês com Pix, boleto ou cartão, mudar de plano, minutos de ligação e o que acontece quando vence.',
    onde: { rotulo: 'Meu plano', para: '/plano' },
    termos:
      'teste grátis 7 dias assinar direto sem teste site contrato combinado plano personalizado sob medida autônomo cpf senha assinar assinatura pagar pagamento pix boleto cartão cobrança mensalidade vencimento venceu atrasado renovar renovação cancelar só leitura exportar contatos arquivada asaas nota fiscal diferença proporcional pacote minutos ligação',
    corpo: (
      <>
        <p>
          O <b>teste grátis</b> dura 7 dias, sem cartão. Vale o plano Time para 2 pessoas e 100 leads
          enriquecidos. O WhatsApp com o Agente de IA e as Ligações ficam para quando assinar. A faixa no topo
          mostra quantos dias faltam e quantos leads já foram usados; avisamos por e-mail dois dias antes, na
          véspera e no dia em que termina.
        </p>
        <h3>Assinar</h3>
        <p>
          Quem administra a conta abre <b>Meu plano › Assinar</b> (ou o botão <b>Assinar</b> da faixa),
          escolhe o plano, quantos usuários e os módulos, e vê o preço do mês na hora. Depois preenche o CNPJ
          (ou CPF), a razão social e o e-mail do financeiro, que recebe as cobranças e a nota fiscal.
        </p>
        <h3>Assinar direto, sem o teste</h3>
        <p>
          No site, em Planos, o botão <b>Assinar</b> de cada plano faz o mesmo cadastro do teste (nome,
          empresa, e-mail, WhatsApp e senha). Depois de confirmar o e-mail, o sistema já abre{' '}
          <b>Meu plano › Assinar</b> com o plano escolhido: é só ajustar usuários e módulos e pagar. Até o
          pagamento cair, a conta funciona como teste; pagou, o plano vale na hora.
        </p>
        <h3>Plano personalizado</h3>
        <p>
          Não vai usar tudo de um plano? O plano personalizado sai a partir do preço do Start, só com as
          funções que vocês vão usar, quantas pessoas e quantos leads por mês. Ele é montado com o nosso time
          (pelo WhatsApp ou pelo formulário do site): a gente configura o plano e o valor e lança a primeira
          cobrança, que aparece em <b>Meu plano › Pagar</b> (Pix, boleto ou cartão). Os meses seguintes chegam
          do mesmo jeito.
        </p>
        <h3>Cadastro</h3>
        <p>
          O cadastro do teste (e do Assinar) pede nome, WhatsApp, e-mail, CNPJ ou CPF e senha. A empresa é
          opcional: quem trabalha por conta própria deixa em branco, usa o CPF e a conta fica no próprio nome.
          O documento já preenche os dados da cobrança. A senha precisa de 6 caracteres ou mais, uma letra
          maiúscula e um caractere especial (a tela marca cada regra enquanto você digita, e o olho mostra o
          que foi digitado).
        </p>
        <h3>Contrato combinado com o nosso time</h3>
        <p>
          Quem fechou o contrato com o nosso time não escolhe o plano pelo sistema: para mudar plano, usuários
          ou módulos, fale com a gente. Se combinamos de cobrar pelo sistema, as mensalidades chegam do mesmo
          jeito (em <b>Meu plano › Pagar</b> e no e-mail do financeiro), com as mesmas regras de vencimento
          abaixo.
        </p>
        <h3>Pagar: um mês por vez</h3>
        <p>
          Não há cobrança automática no cartão: cada mês é uma cobrança, e a forma é escolhida na hora de
          pagar.
        </p>
        <ul>
          <li>
            <b>Pix</b>: o QR Code aparece na tela. Pagou, libera na hora, sozinho.
          </li>
          <li>
            <b>Boleto ou cartão</b>: pelo botão que abre a página segura de pagamento. O boleto libera quando
            o banco confirma (até 2 dias úteis).
          </li>
        </ul>
        <p>
          Pagou, o plano vale por um mês. <b>7 dias antes de vencer</b>, a mensalidade seguinte aparece em Meu
          plano e no e-mail do financeiro, e quem administra a conta vê no topo do sistema quantos dias
          faltam. Pagando antes do vencimento, o mês novo começa onde o anterior termina (não perde nenhum
          dia). Se já pagou e a tela não mudou, clique em <b>Já paguei</b>.
        </p>
        <h3>Quando vence sem pagar</h3>
        <ul>
          <li>
            Nos <b>3 dias</b> seguintes, tudo continua funcionando, com o aviso no topo.
          </li>
          <li>
            Depois, a conta fica <b>só leitura</b>: dá para ver tudo e <b>exportar os leads e os contatos</b>,
            mas não dá para mexer (criar, mudar, mandar ou ligar). Pagando, volta na hora, do jeito que
            estava.
          </li>
          <li>
            Quem já foi cliente nunca perde os dados: a conta fica só leitura até o pagamento. Só o teste que
            vence sem nenhuma assinatura é arquivado depois de 15 dias (os dados ficam guardados por 90 dias).
          </li>
        </ul>
        <h3>Mudar de plano</h3>
        <ul>
          <li>
            <b>Para mais</b> (plano maior, mais usuários ou um módulo): paga só a diferença dos dias que
            faltam no mês e o plano novo vale assim que pagar. Diferença pequena (menos de R$ 5) vale na hora,
            sem custo.
          </li>
          <li>
            <b>Para menos</b>: fica marcado e vale na próxima mensalidade, já com o valor novo. Até lá, o
            plano de hoje continua.
          </li>
        </ul>
        <p>
          <b>Não renovar</b> desliga a próxima mensalidade: o plano vale até o fim do mês pago e depois a
          conta fica só leitura. Dá para voltar a renovar a qualquer momento.
        </p>
        <h3>Minutos de ligação</h3>
        <p>
          O módulo Ligações vem com uma franquia de minutos por mês. Quando ela acaba, as ligações param até
          comprar um <b>pacote de minutos</b> (em Meu plano, em Gestão › Telefonia ou na tela de Ligações):
          com Pix, entra na hora. O que sobrar do pacote <b>não vence</b> e fica para os meses seguintes.
          Avisamos quando o mês passa de 80%.
        </p>
        <Nota>
          Só quem administra a conta vê os valores e pode assinar, pagar, mudar ou comprar minutos. Um teste
          por empresa: o mesmo e-mail, WhatsApp ou CNPJ não começa outro teste.
        </Nota>
      </>
    ),
  },
  {
    id: 'equipe',
    area: 'Gestão',
    titulo: 'Equipe e o que cada um vê',
    resumo: 'Convites, papéis, quem configura e quem usa, unidade toda ou só a própria base.',
    onde: { rotulo: 'Equipe', para: '/equipe' },
    termos:
      'convidar usuário papel admin administrador sdr closer vendedor permissão permissões configuração configurar quem configura unidade alcance própria base rodízio carteira fila sem dono puxar grupo loja departamento atendimento',
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
        <h3>Quem configura e quem usa</h3>
        <p>
          A configuração é do <b>administrador</b> da conta (o gestor que contratou o CRM). Para o resto da
          equipe (SDR e closer), essas telas e partes nem aparecem: o menu e as telas mostram só o trabalho do
          dia a dia.
        </p>
        <ul>
          <li>
            <b>Só o administrador configura</b>: Equipe (convites, papéis, quem vê só a própria base, como os
            leads são divididos, grupos de atendimento), pipelines, etapas e cadência do Funil, montar os{' '}
            <b>Quadros</b> e os gatilhos, Agente de IA (números de WhatsApp, proteção do número, configuração
            e base de conhecimento da IA), Telefonia (gravação, receber ligações, menu de voz), Nichos,
            conexão e “comente e receba” do Instagram, E-mail, Integrações, Marca, Meu plano e Auditoria.
          </li>
          <li>
            <b>A equipe usa</b>: Meu dia, Leads, Funil, Quadros (mover os leads e confirmar o que a IA
            sugeriu), Conversas, Ligações, Reuniões, Na rua, as mensagens para revisar e os leads que a IA
            passou (Agente de IA), o conteúdo e os formulários do Instagram e os Relatórios.
          </li>
          <li>
            <b>Diretoria (só leitura)</b>: vê tudo da organização e não altera nada.
          </li>
        </ul>
        <p>
          Mesmo que alguém da equipe abra o endereço de uma tela de configuração, o sistema não deixa alterar:
          a trava vale no servidor, não só na tela.
        </p>
        <h3>Carteira de clientes (fila de sem dono)</h3>
        <p>
          Em <b>Como os leads são divididos</b>, escolha <b>Carteira: fica numa fila que todo o time vê</b>. O
          lead novo (inclusive quem escreve pela primeira vez no WhatsApp) fica sem dono e aparece em{' '}
          <b>Conversas › Sem dono</b> para todo o time.
        </p>
        <ul>
          <li>
            <b>Puxar para minha carteira</b> (na conversa) ou responder primeiro: o lead passa a ser seu. Quem
            chegar depois já não o vê.
          </li>
          <li>
            Mensagem de lead da carteira de alguém avisa só essa pessoa; a de lead sem dono avisa o time todo.
          </li>
          <li>
            Para cada vendedor ver só a própria carteira (e a fila), marque <b>Só a própria base</b> no
            cadastro dele. O administrador passa um lead para outra pessoa na ficha.
          </li>
        </ul>
        <h3>Grupos de atendimento</h3>
        <p>
          Em <b>Equipe › Grupos de atendimento</b>, crie as lojas ou departamentos e marque quem atende cada
          um (uma pessoa pode estar em mais de um). Eles são as opções do <b>menu de voz</b> das ligações
          recebidas (“para a Loja Centro, digite 1”), que toca para todos do grupo escolhido ao mesmo tempo. A
          tecla de cada grupo segue a ordem da lista. Para ligar o menu, veja{' '}
          <Link to="/ajuda/ligacoes">Ligações</Link>.
        </p>
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
          <li>Campanhas, possíveis decisores encontrados e quais fontes erram mais.</li>
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
    resumo: 'O seu assistente no sistema: tira dúvidas, mostra o comercial, anota tarefas e abre telas.',
    onde: { rotulo: 'Argos', para: '/argos' },
    termos:
      'assistente voz perguntar dúvida como faço tarefa agenda reunião abrir tela mapa galáxia memória lembrar esquecer inventar números conferência',
    corpo: (
      <>
        <p>
          O <b>Argos</b> é o seu assistente dentro do Prospect Team, por voz ou por texto. O histórico das
          conversas é só seu. Ele vê os mesmos dados que você: quem só vê a própria base recebe respostas só
          sobre ela.
        </p>
        <h3>O que dá para pedir</h3>
        <ul>
          <li>
            <b>Tirar dúvidas sobre o sistema</b>: “como eu conecto o WhatsApp?”, “onde fica a sequência de
            e-mail?”. Ele explica pelo passo a passo desta Central de Ajuda e pode abrir o artigo.
          </li>
          <li>
            <b>Ver como está o comercial</b>: “como está o meu funil?”, “quem da equipe mais avançou na
            semana?”, “quais propostas estão paradas?”.
          </li>
          <li>
            <b>Anotar na sua agenda</b>: “marca uma reunião com o Dr. Renato amanhã às 10”, “me lembra de
            ligar para a Clínica Sorriso na sexta”. Ele cria a tarefa ou a reunião na sua agenda (não liga nem
            manda mensagem por você).
          </li>
          <li>
            <b>Abrir telas</b>: “abre o funil”, “abre a ficha da Clínica Sorriso”.
          </li>
        </ul>
        <p>Ele só trata do sistema e do seu comercial. Outros assuntos, ele avisa que não pode ajudar.</p>
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
      'master painel plataforma contador de empresas visitas do site acessos visitantes google origem utm cliques até onde rolam cobrar pelo sistema cobrança mensalidade asaas como o cliente paga contrato combinado domínio dominio vercel white label marca administrador administradores novo master outro master excluir cliente desativar reativar mudar email senha acesso financeiro mrr receita margem custo módulos contratado franquia configuração serviços chave railway testar demonstração demo apresentar dados fictícios',
    corpo: (
      <>
        <p>
          Quem administra a plataforma entra direto no painel: Visão geral, Vendas, Clientes, Financeiro,
          Configurações, Saúde e consumo, Operação e Base CNPJ. A sua própria conta e o CRM de demonstração
          não entram nos números de clientes.
        </p>
        <h3>Financeiro</h3>
        <ul>
          <li>
            <b>Números do mês</b>: receita mensal (e por ano), clientes pagantes, ticket médio, custo, margem
            e quanto da receita vem de módulos e extras.
          </li>
          <li>
            <b>Receita por plano</b>, <b>módulos e extras</b> (WhatsApp + IA, números e usuários a mais) e{' '}
            <b>custo por serviço</b> (IA, WhatsApp, reuniões e gravações, buscas, e-mail, ligações e custos
            fixos).
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
          Custo é estimativa: o uso real vezes os custos unitários (botão Custos unitários) e os Planos dos
          serviços (em Saúde e consumo): o que o plano já inclui está no custo fixo, dividido entre os
          clientes ativos, e cada cliente só leva a parte dele no que passar do plano e o minuto da operadora
          das ligações dele. Ajuste os valores pelas suas faturas para a margem ficar certa. Com valor
          combinado, os itens da mensalidade aparecem na proporção.
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
        <h3>Visitas do site</h3>
        <p>
          Em <b>Visitas do site</b> você vê quantas pessoas abriram o prospectteam.com.br por dia, de onde
          vieram (Google, Instagram, LinkedIn, direto…), os botões mais clicados, até onde rolam a página
          inicial (quantos passam por cada seção), se usam celular ou computador, as cidades e quantos viraram
          cadastro e pagamento. Escolha 7, 30 ou 90 dias; o número ao lado compara com o período anterior.
        </p>
        <ul>
          <li>
            A contagem é feita sem cookie e sem guardar o IP: cada visitante vira um código que muda todo dia
            (por isso "visitantes" soma os visitantes de cada dia). Robôs e pré-visualizações não contam.
          </li>
          <li>
            Link aberto pelo WhatsApp ou pelo app do Instagram costuma aparecer como "Direto". Para separar,
            use o link com a origem, por exemplo{' '}
            <b>prospectteam.com.br/?utm_source=instagram&amp;utm_campaign=bio</b>: aparece em "De onde vêm" e
            em "Campanhas".
          </li>
          <li>
            "Até onde chegam" mostra onde a página perde gente: se poucos chegam em Planos, o que vem antes
            está longo demais.
          </li>
        </ul>
        <h3>Contador de empresas do site</h3>
        <p>
          Logo depois da abertura, o site pergunta "Quantas empresas do seu nicho existem na sua cidade?": a
          pessoa escolhe um dos nichos prontos, o estado e a cidade e vê só o número de empresas ativas na
          base da Receita, com o botão para testar. O número vem da importação da Base CNPJ, que conta os
          nichos prontos no Brasil todo (não só nos estados das campanhas). Antes da primeira importação
          terminar, o contador já aparece, e quem clica em Contar recebe o aviso de que a contagem está sendo
          atualizada e o convite para o teste; para ligar o número, rode uma importação em <b>Base CNPJ</b>.
          Se a api não responder, o site mostra a chamada para a demonstração no lugar. Quem usa o contador
          aparece em Visitas do site › Botões mais clicados.
        </p>
        <h3>Base CNPJ: só empresas ativas</h3>
        <p>
          A importação guarda só as empresas <b>ativas</b> dos nichos (fechada, suspensa ou inapta não vira
          lead). No fim, o que fechou desde a última importação sai da base junto com a razão social e os
          sócios, e o banco é compactado para devolver o espaço; nesses minutos, uma busca de campanha pode
          esperar um pouco.
        </p>
        <h3>Cobrar pelo sistema</h3>
        <p>
          Em Clientes › <b>Plano e módulos</b>, o bloco <b>Como o cliente paga</b> mostra se o cliente paga
          por fora (contrato combinado à mão), se é cobrado pelo sistema ou se assina sozinho (pelo site ou
          depois do teste).
        </p>
        <ul>
          <li>
            <b>Cobrar pelo sistema</b>: com o plano e a mensalidade salvos acima, preencha o CNPJ (ou CPF), a
            razão social, o e-mail do financeiro e o dia do primeiro vencimento. A cobrança sai 7 dias antes
            de cada vencimento, com o valor do plano daqui (mudou o plano ou a mensalidade combinada, a
            cobrança em aberto volta com o valor novo). O cliente paga com Pix, boleto ou cartão e pagar não
            troca o plano combinado.
          </li>
          <li>
            Valem as mesmas regras de quem assina sozinho: venceu sem pagar, mais 3 dias normais e depois só
            leitura até o pagamento cair. O cliente cobrado pelo sistema nunca é arquivado.
          </li>
          <li>
            <b>Parar de cobrar</b>: as cobranças em aberto são canceladas e o cliente volta a ser combinado à
            mão (sem vencimento nem só leitura).
          </li>
          <li>
            <b>Plano personalizado para quem veio do site</b> (em teste, ainda sem pagar): ajuste o plano e o
            valor acima, salve e use Cobrar pelo sistema com o vencimento de hoje. A primeira cobrança sai na
            hora, o cliente recebe o aviso no sistema e paga em Meu plano › Pagar; a cobrança que ele tinha
            pedido sozinho (se houver) é cancelada.
          </li>
          <li>Quem já paga sozinho cuida do plano e das cobranças em Meu plano; o painel só mostra.</li>
        </ul>
        <h3>Configurações da plataforma</h3>
        <p>
          A lista dos serviços que a plataforma usa para todos os clientes (WhatsApp, e-mail, IA, reuniões,
          gravações, transcrição, voz do Argos, rotas, Google Maps e buscas), se estão funcionando e o que
          falta. <b>Testar</b> faz uma chamada mínima ao serviço; <b>Como fazer</b> diz qual variável colocar
          e em qual serviço do Railway. Ao lado ficam a tabela de preços, os custos unitários, os custos fixos
          do mês (que vêm de <Link to="/ajuda/saude-consumo">Saúde e consumo</Link>) e o contato do site. Os
          números do mês não contam o CRM de demonstração.
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
  {
    id: 'saude-consumo',
    area: 'Painel da plataforma',
    soMaster: true,
    titulo: 'Saúde e consumo dos serviços',
    resumo:
      'Se cada serviço externo está respondendo agora, quanto do plano de cada um já foi usado no mês e quanto a plataforma está gastando.',
    onde: { rotulo: 'Saúde e consumo', para: '/plataforma/saude' },
    termos:
      'saúde saude consumo api apis custo custos fixo fixos excedente plano livekit nvoip operadora telefone serper pacote pré-pago pre-pago saldo vencimento resend z-api groq r2 places ia erro erros falhando tempo real ao vivo previsão limite créditos minutos margem infraestrutura railway',
    corpo: (
      <>
        <p>
          Em <b>Sistema › Saúde e consumo</b> você vê os serviços externos que a plataforma paga (IA,
          WhatsApp, LiveKit, transcrição, e-mail, buscas, Google Maps, rotas, cobrança, Instagram e
          gravações). A conta de demonstração fica de fora de tudo.
        </p>
        <h3>Agora</h3>
        <p>
          Atualiza sozinha a cada 15 segundos. Cada serviço mostra as chamadas por minuto da última hora, os
          erros, o tempo de resposta e o último problema (por exemplo, “sem créditos”). Em cima: quantos
          serviços estão respondendo, os erros da última hora, as reuniões e ligações acontecendo agora e o
          gasto do mês. Embaixo ficam o banco de dados e os workers.
        </p>
        <ul>
          <li>
            <b>Vermelho</b>: 5 erros seguidos ou mais de 20% de erro nos últimos 10 minutos. Você recebe um
            aviso no sino, que fecha sozinho quando o serviço volta.
          </li>
          <li>
            <b>Cinza</b>: o serviço não foi chamado na última hora (normal à noite ou sem campanha rodando).
          </li>
        </ul>
        <h3>Consumo do mês</h3>
        <p>
          O que cada plano inclui e quanto já foi usado, com a <b>previsão</b> (onde o mês fecha se continuar
          no ritmo de hoje; é a linha tracejada na barra). Quando um limite vai acabar antes do fim do mês,
          aparece um aviso no topo com o dia aproximado e o que acontece depois (cobra o excedente ou para).
        </p>
        <ul>
          <li>
            <b>LiveKit</b>: minutos de participante (reuniões e quem liga pelo navegador) e minutos de ligação
            (o lado do lead, feitas e recebidas). As gravações são feitas pelo navegador e não gastam o
            LiveKit.
          </li>
          <li>
            <b>Telefone</b>: o minuto da operadora (Nvoip ou a que você usar), só das ligações feitas e
            atendidas, contado como ela cobra (até 3 segundos não cobra, depois 30 segundos e então de 6 em
            6), separado em celular e fixo.
          </li>
          <li>
            <b>Serper</b>: os créditos que ainda restam dos pacotes comprados, quanto foi usado no mês (cerca
            de 3 buscas por lead enriquecido), quando acabam no ritmo de agora e se algum pacote vai vencer
            com sobra.
          </li>
          <li>
            IA, Google Maps, e-mail, transcrição, gravações guardadas, números de WhatsApp e rotas (por dia).
          </li>
        </ul>
        <Nota>
          Os números são medidos pelo próprio sistema (cada chamada, cada minuto de sala e de ligação). Para
          conferir com a fatura, use o painel de cada serviço (no LiveKit, Settings › Usage).
        </Nota>
        <h3>Custos e planos dos serviços</h3>
        <Passos>
          <li>
            Na aba <b>Custos</b>, clique em <b>Planos dos serviços</b> e informe o que você contratou: o plano
            do LiveKit (quanto custa, o que inclui e o preço do minuto a mais), a operadora do telefone
            (franquia e preço do minuto para celular e fixo), os pacotes do Serper e o plano do Resend.
          </li>
          <li>
            O <b>Serper</b> é pré-pago, sem mensalidade: cada pacote é pago uma vez e os créditos valem 6
            meses (o que sobrar depois disso se perde). Em <b>Serper</b>, clique em <b>Adicionar pacote</b> a
            cada compra e informe a data, os créditos e quanto pagou. Os 2.500 grátis do cadastro entram como
            um pacote de US$ 0. Cada pacote salvo mostra quanto já usou, quanto resta e até quando vale.
          </li>
          <li>
            Em <b>Outros custos fixos</b>, coloque o que você paga todo mês, use ou não use: servidores
            (Railway), Vercel, domínios… Não precisa repetir os planos acima: eles já entram.
          </li>
          <li>
            Salve. O <b>fixo do mês</b> é a soma dos planos e dos outros fixos; o <b>variável</b> é só o que
            passa do que os planos incluem, mais o que é cobrado por uso (minuto da operadora, IA, Google
            Maps, números de WhatsApp, os créditos do Serper usados no mês e os que venceram sem uso). Os dois
            têm o valor até hoje e a previsão do mês.
          </li>
        </Passos>
        <p>
          O fixo é dividido entre os clientes ativos no custo de cada um (Financeiro e Clientes); no lugar do
          antigo “Infraestrutura por mês”. Cada busca do Serper entra no custo do cliente que a fez, ao preço
          do crédito do pacote pago mais recente. O dólar usado é o de Custos unitários.
        </p>
        <Nota>
          O Serper não informa o saldo pelo sistema: o saldo mostrado é a conta dos pacotes informados menos
          as buscas registradas. Confira de vez em quando no painel do Serper.
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
