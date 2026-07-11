import { createRoot } from "react-dom/client";
import { TrashketballGame } from "../app/TrashketballGame";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Trashketball could not find its page mount point.");
}

createRoot(root).render(<TrashketballGame />);
