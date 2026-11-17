"use client";
// Settings → Editor: one switch for each of the code editor's helpers (src/lib/editorSettings.ts
// holds the list and what is on; the editor reads it live, so an open file follows at once), and
// the editor's own keys beside them.
import { TARGET } from "@/lib/adapters/target";
import { useEditorSettings } from "@/ide/useEditorSettings";
import { EDITOR_KEYS, editorSwitchesFor, setEditorSetting } from "@/lib/editorSettings";
import { Box, Cols } from "./parts";

export default function EditorPane() {
  const now = useEditorSettings();
  return (
    <Cols>
      <div>
        <Box label="While you read and write code">
          <ul className="sv-switches">
            {editorSwitchesFor(TARGET).map((s) => (
              <li key={s.id}>
                <div>
                  <b id={`sw-${s.id}`}>{s.label}</b>
                  <p className="sv-hint" id={`sw-${s.id}-hint`}>
                    {s.hint}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="sv-switch"
                  aria-checked={now[s.id]}
                  aria-labelledby={`sw-${s.id}`}
                  aria-describedby={`sw-${s.id}-hint`}
                  onClick={() => setEditorSetting(s.id, !now[s.id])}
                >
                  <span aria-hidden>{now[s.id] ? "On" : "Off"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Box>
      </div>
      <div>
        <Box label="Keyboard, in the editor">
          <dl className="sv-keys-dl">
            {EDITOR_KEYS.map((k) => (
              <div key={k.keys}>
                <dt>
                  <kbd>{k.keys}</kbd>
                </dt>
                <dd>{k.what}</dd>
              </div>
            ))}
          </dl>
        </Box>
      </div>
    </Cols>
  );
}
