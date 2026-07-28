import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { disableNativeContextMenu } from "./setupNativeContextMenu";
import { applyTheme, getStoredTheme } from "./theme/appTheme";

applyTheme(getStoredTheme());
disableNativeContextMenu();

createRoot(document.getElementById("app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
