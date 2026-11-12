import { Component } from "react";

/**
 * Small render-error boundary for isolated interface surfaces.
 *
 * A tab body or a single HUD widget may throw while rendering malformed
 * directory data. Without a boundary React unmounts the whole tree and the
 * player loses the entire interface. This component keeps the failure local:
 * the surrounding sidebar, left HUD, chat and canvas stay interactive while
 * the affected surface shows a retryable error message.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[pf2e] UI render error", error, info);
    if (typeof this.props.onError === "function") {
      this.props.onError(error, info);
    }
  }

  handleRetry() {
    this.setState({ hasError: false });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const fallback =
      typeof this.props.fallback === "string" && this.props.fallback !== ""
        ? this.props.fallback
        : "Ошибка рендера";
    const retryLabel =
      typeof this.props.retryLabel === "string" && this.props.retryLabel !== ""
        ? this.props.retryLabel
        : null;

    return (
      <div className="ui-error-boundary" role="alert">
        <span className="ui-error-boundary__title">{fallback}</span>
        {retryLabel ? (
          <button
            type="button"
            className="ui-button ui-error-boundary__retry"
            onClick={this.handleRetry}
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }
}
