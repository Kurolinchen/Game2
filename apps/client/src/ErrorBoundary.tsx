import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  message: string;
  stack: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false, message: "", stack: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { failed: true, message: error.message, stack: error.stack ?? "" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Tactics Lite UI crashed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error-shell">
        <section
          className="panel fatal-error-card"
          data-error-message={this.state.message}
          data-error-stack={this.state.stack}
        >
          <span className="fatal-error-icon">!</span>
          <span className="eyebrow">Interface recovery</span>
          <h1>The tactical display stopped responding.</h1>
          <p>
            Your room may still be active. Reloading will use the saved reconnect
            token and attempt to restore your seat for up to 60 seconds.
          </p>
          <div>
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Reload and reconnect
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                window.sessionStorage.removeItem("tactics-lite-reconnect");
                window.location.assign(window.location.pathname);
              }}
            >
              Return to lobby
            </button>
          </div>
        </section>
      </main>
    );
  }
}
