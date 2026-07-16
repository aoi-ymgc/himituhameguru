import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import App from "./App";
import "./styles.css";

export const socket = io({ autoConnect: true, transports: ["websocket", "polling"] });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
