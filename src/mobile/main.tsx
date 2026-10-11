import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "@/mobile/MobileApp";
import { startRemote } from "@/mobile/remote";
import "@/styles/app.css";

startRemote();

// Offline copy of this page (public/sw.js): it still opens with Arkadia
// closed or the PC off, and says which. HTTPS only, so never on the dev page.
if (
  !import.meta.env.DEV &&
  window.isSecureContext &&
  "serviceWorker" in navigator
)
  void navigator.serviceWorker.register("/sw.js").catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
