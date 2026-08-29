import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";
import { initializeTheme } from "./ui/theme";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}

// Applied before the first paint so the page never flashes the wrong theme.
initializeTheme();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
