"use client";
// Details: the selected card, service, arrow or link, with its evidence.
// Drawn again only when the selection or the arrow shown changes.
import { useMemo } from "react";
import Inspector from "@/components/Inspector";
import { EdgeDetails, LinkDetails, ServiceDetails } from "@/components/EvidenceList";
import { useShell } from "../WorkspaceProvider";

export default function DetailsPanel() {
  const { map, detail, selected, openAt, selectNode, jumpTo, tourLinks, changeView, explainService, traceSvc, onLinks, explainNode, traceNode, tourNode } = useShell();
  return useMemo(() => {
    const service = selected ? map.services.find((x) => x.id === selected) : undefined;
    return (
      <div className="dock-panel scroll">
        {detail?.kind === "edge" ? (
          <EdgeDetails map={map} edge={detail.edge} onOpen={openAt} onSelect={selectNode} />
        ) : detail?.kind === "links" ? (
          <LinkDetails map={map} links={detail.links} onOpen={openAt} onSelect={jumpTo} onTour={tourLinks} />
        ) : service ? (
          <ServiceDetails
            map={map}
            service={service}
            onOpen={openAt}
            onOpenService={(id) => changeView({ kind: "service", id })}
            onExplain={explainService}
            onTrace={traceSvc}
            onLinks={onLinks}
          />
        ) : (
          <Inspector map={map} selected={selected} onOpen={openAt} onSelect={selectNode} onExplain={explainNode} onTrace={traceNode} onTour={tourNode} />
        )}
      </div>
    );
  }, [map, detail, selected, openAt, selectNode, jumpTo, tourLinks, changeView, explainService, traceSvc, onLinks, explainNode, traceNode, tourNode]);
}
