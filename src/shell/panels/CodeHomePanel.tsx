"use client";
// The pinned first tab of the code group. It anchors the group, so the place
// editors open in never disappears, and says what to do when nothing is open.
export default function CodeHomePanel() {
  return (
    <div className="dock-panel code" style={{ display: "grid", placeItems: "center" }}>
      <p className="note">Pick a card or a file to read its code.</p>
    </div>
  );
}
