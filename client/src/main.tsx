import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Depois do index.css de propósito: o sistema da vitrine precisa vencer os
// utilitários do Tailwind sem recorrer a `!important`.
import "./vitrine.css";

createRoot(document.getElementById("root")!).render(<App />);
