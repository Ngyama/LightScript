import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { disableNativeContextMenu } from "./setupNativeContextMenu";

disableNativeContextMenu();

createRoot(document.getElementById("app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
