import { createRoot } from "react-dom/client";
import { RouteArtApp } from "../src";
import "../src/styles.css";

const root = document.getElementById("root") as HTMLElement;
root.style.height = "100dvh";
document.body.style.margin = "0";
createRoot(root).render(<RouteArtApp />);
