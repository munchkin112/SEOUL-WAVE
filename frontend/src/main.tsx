import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import "./style.css";

const root = document.getElementById("root");
if (root === null) throw new Error("화면을 표시할 root 요소가 없습니다.");
createRoot(root).render(<AuthGate>{(onLogout) => <App onLogout={onLogout} />}</AuthGate>);
