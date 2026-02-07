import "./styles/index.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element.");
}

createRoot(root).render(<App />);
