import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { App } from "./App";
import { SharedSyncBoot } from "./components/SharedSyncBoot";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <SharedSyncBoot />
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
