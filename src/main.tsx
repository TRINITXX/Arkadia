import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
import { PopupApp } from "@/PopupApp";
import { NotifApp } from "@/components/NotifApp";
import "@/styles/app.css";

// Secondary windows are created with `index.html?window=<kind>`:
// `popup` = the terminal-mirror popup, `notif` = the compact notification.
const windowKind = new URLSearchParams(window.location.search).get("window");

function Root() {
  if (windowKind === "popup") return <PopupApp />;
  if (windowKind === "notif") return <NotifApp />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
