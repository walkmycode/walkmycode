"use client";
// "How it works", from the home page's lock line: where code can go, provider by
// provider, the same table as Settings → Privacy. WalkMyCode Lite says what it does
// inside Claude instead. Loaded only when it opens.
import { useId } from "react";
import Sheet from "@/components/Sheet";
import { PrivacyTable } from "@/components/settings/PrivacyPane";
import { BUILT_BY_PARSER, NEVER_READ, YOUR_KEYS } from "@/lib/privacyRows";
import { CloseIcon } from "./icons";

export default function PrivacySheet({ lite, onClose }: { lite: boolean; onClose: () => void }) {
  const titleId = useId();
  return (
    <Sheet labelledBy={titleId} onClose={onClose} className="privacy">
      <button type="button" className="iconbtn sheet-close" onClick={onClose} aria-label="Close" data-autofocus>
        <CloseIcon />
      </button>
      <h2 id={titleId} className="sheet-title">
        How WalkMyCode handles your code
      </h2>
      <p className="sheet-lead">
        {lite
          ? "The map is drawn in this browser by a parser, not an AI. Only the lines a question needs leave it — to Claude, inside Claude."
          : "The map is drawn on this computer by a parser, not an AI. Only the lines a question needs leave it — to the provider you chose."}
      </p>
      <div className="pv-grid">
        <div className="pv-box">
          <div className="pv-lbl">Where your code can go</div>
          <PrivacyTable claude={lite} />
        </div>
        <div className="pv-side">
          <div className="pv-box">
            <div className="pv-lbl">Never read</div>
            <p>{NEVER_READ}</p>
          </div>
          <div className="pv-box">
            <div className="pv-lbl">Built by a parser</div>
            <p>{BUILT_BY_PARSER}</p>
          </div>
          {!lite && (
            <div className="pv-box">
              <div className="pv-lbl">Your keys</div>
              <p>{YOUR_KEYS}</p>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
