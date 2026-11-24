import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import Island from "./island/Island";
import "./island.css";

/** The island window is transparent, so a crashed page would be invisible. Show the error instead. */
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="island-wrap">
        <div className="island island-error" role="alert">DeskForge island error: {this.state.error}</div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <Boundary>
    <Island />
  </Boundary>,
);
