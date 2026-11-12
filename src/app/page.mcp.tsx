"use client";
// WalkMyCode for Claude's page (the MCP target, docs/MCP.md) is this one page,
// served from the root by the local MCP server: the start screen ("Ask Claude:
// open WalkMyCode on <folder>") until Claude opens a folder, then the Explore
// room, which Claude drives through the bridge. The rooms are the app's own;
// the host (McpHost) connects the bridge, loads the workspace from the server,
// plays Claude's narration and says when another tab took over. The Learn
// room is not part of this page.
import { useEffect } from "react";
import dynamic from "next/dynamic";
import McpHost from "@/components/mcp/McpHost";
import McpStart from "@/components/mcp/McpStart";
import TopBar from "@/components/TopBar";
import { interceptRoomLinks, RoomLink, useRoom } from "@/lib/adapters/nav";

const loading = () => (
  <p className="note" style={{ padding: 20 }}>
    Loading…
  </p>
);
const Explore = dynamic(() => import("./map/page"), { ssr: false, loading });

export default function McpPage() {
  const room = useRoom();
  useEffect(() => interceptRoomLinks(), []);
  return (
    <McpHost>
      {(host) =>
        room === "/map" ? (
          <Explore />
        ) : room === "/learn" ? (
          <>
            <TopBar title="Learn" />
            <div className="hall">
              <p className="note">The Learn room is part of the WalkMyCode app, not of the WalkMyCode MCP server. Ask your AI app to teach you instead: it can show you the code here while it does.</p>
              <RoomLink href="/map" className="ctl primary" style={{ alignSelf: "flex-start" }}>
                Back to the map
              </RoomLink>
            </div>
          </>
        ) : (
          <McpStart loading={host.loading} error={host.error} />
        )
      }
    </McpHost>
  );
}
