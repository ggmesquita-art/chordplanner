import { Component, type ErrorInfo, type ReactNode } from "react";
import { discardSession } from "../state/store";
import { exportJson } from "./fileActions";

type State = { error: Error | null; confirmDiscard: boolean; copyFailed: boolean };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, confirmDiscard: false, copyFailed: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro não tratado:", error, info.componentStack);
  }

  render() {
    const { error, confirmDiscard, copyFailed } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="modal-backdrop">
        <div className="modal" role="alert">
          <h3>Algo deu errado</h3>
          <p>O aplicativo encontrou um erro inesperado. As músicas salvas continuam guardadas no navegador.</p>
          <pre className="small">{error.message || String(error)}</pre>
          {copyFailed && <p className="small">Não foi possível gerar a cópia.</p>}
          <p className="muted small">“Descartar a sessão” NÃO apaga as músicas salvas; só o rascunho da sessão atual (alterações não salvas).</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Recarregar a página
            </button>
            <button
              className="btn"
              onClick={() => {
                try {
                  exportJson();
                  this.setState({ copyFailed: false });
                } catch {
                  this.setState({ copyFailed: true });
                }
              }}
            >
              Baixar cópia da música (JSON)
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (!confirmDiscard) return this.setState({ confirmDiscard: true });
                discardSession();
                location.reload();
              }}
            >
              {confirmDiscard ? "Confirmar: descartar a sessão atual" : "Descartar a sessão e recomeçar"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
