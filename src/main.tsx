import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
import { PopupApp } from "@/PopupApp";
import "@/styles/app.css";

// The notification popup window is created with `index.html?window=popup`.
const isPopup =
  new URLSearchParams(window.location.search).get("window") === "popup";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPopup ? <PopupApp /> : <App />}</React.StrictMode>,
);
