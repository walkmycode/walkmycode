"use client";
// Claude drives the Explore room (WalkMyCode for Claude, docs/MCP.md §3): while
// the map is on screen, each of Claude's page commands (focus a card, open a
// file, light lines or a path, play a tour, switch the view, light what an
// answer cites) runs on the room's own actions and is acknowledged with what
// was done, or refused with why (applyCommand, src/lib/bridge/commands.ts).
// Renders nothing.
import { useEffect, useRef } from "react";
import { applyCommand, type PageUi } from "@/lib/bridge/commands";
import { bridge } from "@/lib/bridge/page";
import type { CommandName } from "@/lib/bridge/protocol";
import { useShell } from "@/shell/WorkspaceProvider";

const DRIVEN: CommandName[] = ["focus_node", "open_file", "highlight_lines", "trace_path", "start_tour", "tour_step", "show_view", "answer"];

export default function BridgeDriver() {
  const s = useShell();
  const shell = useRef(s);
  useEffect(() => {
    shell.current = s;
  });

  useEffect(() => {
    const ui: PageUi = {
      get map() {
        return shell.current.map;
      },
      get files() {
        return shell.current.repo.files;
      },
      jumpTo: (id) => shell.current.jumpTo(id),
      openAt: (path, start, end) => shell.current.openAt(path, start, end),
      setLit: (l) => shell.current.setLit(l),
      setTour: (t) => shell.current.setTour(t),
      setStep: (i) => shell.current.setStep(i),
      tour: () => shell.current.tour,
      changeView: (v) => shell.current.changeView(v),
      reveal: (p, why) => shell.current.shell.reveal(p, why),
      working: () =>
        bridge()
          .snapshot()
          .pending.filter((p) => p.state === "taken" && p.id)
          .map((p) => p.id!),
    };
    const b = bridge();
    const offs = DRIVEN.map((name) => b.handle(name, (c) => applyCommand(ui, c)));
    return () => {
      for (const off of offs) off();
    };
  }, []);

  return null;
}
