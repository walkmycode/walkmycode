"use client";
// The note before the fallback folder input (src/lib/folderPrompt.ts): the
// browser is about to ask "Upload all files…?", what to answer, and why nothing
// is uploaded. "Choose folder" opens the input from this click, which is what
// lets the browser open it. Loaded only when it opens.
import { useId, useState } from "react";
import Sheet from "@/components/Sheet";
import { DROP_TIP } from "@/lib/folderPrompt";
import { CloseIcon } from "./icons";

interface Props {
  /** A folder can be dropped on the page instead (no browser question then). */
  canDrop: boolean;
  /** Opens the folder input; `never` is the "Don't show this again" box. */
  onChoose: (never: boolean) => void;
  onClose: () => void;
}

export default function FolderPromptSheet({ canDrop, onChoose, onClose }: Props) {
  const titleId = useId();
  const [never, setNever] = useState(false);
  return (
    <Sheet labelledBy={titleId} onClose={onClose} className="folder-prompt">
      <button type="button" className="iconbtn sheet-close" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>
      <h2 id={titleId} className="sheet-title">
        Before you choose
      </h2>
      <p className="sheet-lead">
        Your browser will ask you to confirm next: choose <b>Upload</b>.
      </p>
      <p>Nothing is uploaded: WalkMyCode reads the folder inside this browser, and only the lines you ask about go to your AI.</p>
      {canDrop && <p className="fp-tip">{DROP_TIP}</p>}
      <label className="fp-never">
        <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
        Don&apos;t show this again
      </label>
      <div className="sheet-bar">
        <p />
        <button type="button" className="hbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="hbtn primary" onClick={() => onChoose(never)} data-autofocus>
          Choose folder
        </button>
      </div>
    </Sheet>
  );
}
