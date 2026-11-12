"use client";
// A place for the Code room inside Explore. Not offered yet (the registry
// marks it unavailable); the Learn room has the full IDE today.
import { RoomLink } from "@/lib/adapters/nav";

export default function CodeRoomPanel() {
  return (
    <div className="dock-panel" style={{ display: "grid", placeItems: "center", gap: 8, padding: 16 }}>
      <p className="note">The Code room is coming soon.</p>
      <RoomLink href="/learn" className="ctl compact">
        Open the Learn room
      </RoomLink>
    </div>
  );
}
