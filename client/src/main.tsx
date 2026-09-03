import { createRoot } from "react-dom/client";
import App from "./App";
import { installIdentitySessionHeader } from "./lib/identitySession";
import "./index.css";

// Before the first render, so no `/api/*` call can be made without the chance to
// carry the IdentityProvider session token (#110).
installIdentitySessionHeader();

createRoot(document.getElementById("root")!).render(<App />);
