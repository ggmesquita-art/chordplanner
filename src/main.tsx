import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { UpdateToast } from "./ui/UpdateToast";
import { registerServiceWorker } from "./pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <UpdateToast />
    </ErrorBoundary>
  </StrictMode>,
);

// No app de desktop (esquema app://) o processo principal já serve tudo do disco: sem service worker.
const desktop = location.protocol === "app:";
void registerServiceWorker({ enabled: import.meta.env.PROD && !desktop });

if (desktop && new URLSearchParams(location.search).has("mirror-samples")) {
  void import("./desktop/mirrorSamples").then((m) => m.mirrorAllSamples());
}
