import { createRoot } from "react-dom/client";
import { PlannerApp, RouteArtApp } from "../src";
import "../src/styles.css";

const root = document.getElementById("root") as HTMLElement;
root.style.height = "100dvh";
document.body.style.margin = "0";
// /gpx-route-art/#planner shows the loop planner, anything else the route-art tool
createRoot(root).render(location.hash === "#planner" ? <PlannerApp /> : <RouteArtApp />);
