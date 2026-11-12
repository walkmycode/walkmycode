"use client";
// A dock tab: dockview's own tab (focusable, drag, middle-click close) with
// the panel's glyph, no close button on pinned panels (Map, Code, Guide), and
// an editor's full path as its tooltip.
import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";
import { PANELS, isEditorId } from "./panels";

export default function LanternTab(props: IDockviewPanelHeaderProps) {
  const id = props.api.id;
  const def = PANELS[id];
  const path = isEditorId(id) ? (props.params as { path?: string })?.path : undefined;
  return <DockviewDefaultTab {...props} hideClose={def?.pinned ?? false} data-icon={def?.icon ?? (path ? "‹›" : undefined)} title={path ?? def?.title} />;
}
