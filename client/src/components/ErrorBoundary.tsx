import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Último anteparo entre um erro de render e a tela branca.
 *
 * Sem isto, qualquer exceção durante o render do React desmonta a árvore
 * inteira e o que sobra é uma página em branco — sem mensagem, sem botão, sem
 * pista. Num tablet de plantão de vendas, com o cliente ao lado, isso é o pior
 * desfecho possível: não há F12 para descobrir o que houve e não há caminho de
 * volta que não seja fechar e reabrir o navegador.
 *
 * A cena 3D já tinha proteção equivalente para erro de shader do Cesium
 * (`scene.renderError`, que descarta o mini mapa e segue). A aplicação em
 * volta não tinha nenhuma — e é ela que desenha os painéis, o espelho de
 * vendas e a barra solar.
 *
 * Precisa ser classe: `componentDidCatch` e `getDerivedStateFromError` não têm
 * equivalente em hooks até hoje.
 */

interface Props {
  children: ReactNode;
  /** Nome do trecho protegido, para a mensagem e para o log. */
  area?: string;
}

interface State {
  erro: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    /**
     * O console é o único destino disponível hoje.
     *
     * Quando houver coleta de erros (Sentry e afins), é AQUI que ela entra —
     * este é o único ponto por onde toda falha de render passa.
     */
    console.error(`[erro de render${this.props.area ? ` · ${this.props.area}` : ""}]`, erro, info.componentStack);
  }

  private recomeçar = () => {
    /**
     * Limpar o estado e re-renderizar, sem recarregar a página.
     *
     * Recarregar jogaria fora o projeto já baixado do banco e a marca já
     * aplicada — o visitante veria tudo piscar do zero para consertar algo que
     * não é dele. Se o erro for determinístico ele volta, e aí a mensagem
     * continua na tela; se foi um estado transitório, some.
     */
    this.setState({ erro: null });
  };

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    /**
     * Estilo inline, de propósito.
     *
     * Esta tela precisa desenhar mesmo que a folha de estilo não tenha
     * carregado ou que o erro tenha vindo de dentro do sistema de temas — que
     * são exatamente os cenários em que ela é acionada. Depender de classes
     * seria depender do que pode estar quebrado.
     */
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#0a0a0a",
          color: "#e8e8e8",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Algo quebrou nesta tela
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(232,232,232,0.6)", margin: "0 0 20px" }}>
            O erro foi contido aqui — o restante do sistema segue funcionando.
            Tente novamente; se persistir, recarregue a página.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={this.recomeçar}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: "#e8e8e8",
                borderRadius: 4,
                padding: "8px 16px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Tentar de novo
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent",
                color: "rgba(232,232,232,0.6)",
                borderRadius: 4,
                padding: "8px 16px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Recarregar
            </button>
          </div>
          {/*
            A mensagem técnica fica visível: num tablet não há console, e sem
            ela quem opera o plantão não tem o que relatar a quem vai consertar.
          */}
          <p
            style={{
              marginTop: 20,
              fontSize: 11,
              lineHeight: 1.5,
              color: "rgba(232,232,232,0.3)",
              wordBreak: "break-word",
            }}
          >
            {erro.message || String(erro)}
          </p>
        </div>
      </div>
    );
  }
}
