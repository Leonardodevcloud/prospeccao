import { Button, EmptyState } from '@prospeccao/ui';
import { useRouteError } from 'react-router';

/**
 * Tela de erro no lugar da página quebrada: explica, mostra o detalhe técnico recolhido e oferece
 * recarregar. Costuma acontecer logo depois de um deploy, quando a tela nova chega antes da API nova.
 */
export function ErroDaTela() {
  const erro = useRouteError();
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <div className="pp-panel">
        <EmptyState
          icone="circle-x"
          titulo="Esta tela não carregou"
          texto="Pode ser uma atualização sendo publicada agora. Espere uns minutos e recarregue a página."
          acao={
            <Button variant="primary" size="sm" onClick={() => location.reload()}>
              Recarregar a página
            </Button>
          }
        />
      </div>
      <details style={{ marginTop: 12, fontSize: 12 }}>
        <summary className="quieto">Detalhe técnico</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{detalhe}</pre>
      </details>
    </div>
  );
}
