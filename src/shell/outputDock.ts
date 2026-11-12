// Explore's side of the dockable output (src/ide/outputStore.ts): "Pop out"
// opens the Output panel under the editor it came from, where it moves, tabs,
// floats and resizes like any other panel; "Dock back" closes it, and its
// unmount puts the output back under the editor. Whether it is popped out is
// whether the panel is open, so a saved layout with it restores that too.
// dockview is only a type here, so the tests pass a fake.
import type { AddPanelOptions, DockviewApi } from "dockview-react";
import type { OutputHost } from "../ide/outputStore";
import { PANELS, isEditorId } from "./panels";

export const OUTPUT_ID = "output";

export type OutputDockApi = Pick<DockviewApi, "getPanel" | "addPanel" | "activePanel" | "panels">;

/** Where the panel goes: under the file being read, else under the code home, else wherever the dock puts it. */
export function outputPosition(api: OutputDockApi): AddPanelOptions["position"] | undefined {
  const active = api.activePanel?.id;
  const ref = active && isEditorId(active) ? active : (api.panels.find((p) => isEditorId(p.id))?.id ?? (api.getPanel("code:home") ? "code:home" : undefined));
  return ref ? { referencePanel: ref, direction: "below" } : undefined;
}

export function outputHost(api: OutputDockApi): OutputHost {
  return {
    popOut() {
      const open = api.getPanel(OUTPUT_ID);
      if (open) {
        open.api.setActive();
        return;
      }
      const def = PANELS[OUTPUT_ID];
      const position = outputPosition(api);
      api.addPanel({ id: OUTPUT_ID, component: def.key, title: def.title, renderer: def.renderer, initialHeight: 240, ...(position ? { position } : {}) } as AddPanelOptions);
    },
    dockBack() {
      api.getPanel(OUTPUT_ID)?.api.close();
    },
  };
}
