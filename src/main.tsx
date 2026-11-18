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

void registerServiceWorker();
