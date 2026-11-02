import { Component, type ReactNode } from "react";
export class AccountErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="account-card">
        <p>页面暂时无法显示，请重试或切换标签页。</p>
        <button onClick={() => this.setState({ failed: false })}>重试</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
