import { Component } from "react";

// Catches render-time errors in any child component and shows a fallback UI
// instead of unmounting the whole app to a blank screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "60px 20px", textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
          <h2 style={{ color: "#14213D", fontFamily: "Newsreader, Georgia, serif" }}>Something went wrong</h2>
          <p style={{ color: "#6B6E72", marginTop: 8 }}>
            An unexpected error occurred. Try reloading the page — your data is safe.
          </p>
          <pre style={{ fontSize: 12, color: "#B3261E", marginTop: 16, textAlign: "left", overflow: "auto", background: "#FBEAE9", padding: 12, borderRadius: 8 }}>
            {this.state.error?.message || "Unknown error"}
          </pre>
          <button
            className="btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
