"use client";
// Details: the selected card, service, arrow or link, with its evidence. While the map is coloured by
// Hotspots, the hottest files come first (src/components/Hotspots.tsx).
// Drawn again only when the selection or the arrow shown changes.
import { useMemo } from "react";
import type { ImpactProps } from "@/components/ImpactSection";
import Inspector from "@/components/Inspector";
import { HotspotsDetails } from "@/components/Hotspots";
import { EdgeDetails, LinkDetails, ServiceDetails } from "@/components/EvidenceList";
import { useShell } from "../WorkspaceProvider";

export default function DetailsPanel() {
  const { repo, map, detail, selected, openAt, selectNode, jumpTo, tourLinks, changeView, explainService, traceSvc, onLinks, explainNode, traceNode, tourNode, impact, showImpact, tourImpact, explainImpact } = useShell();
  const files = repo.files;
  return useMemo(() => {
    const impactProps: ImpactProps = { files, ask: impact, onShow: showImpact, onTour: tourImpact, onRisks: explainImpact };
    const service = selected ? map.services.find((x) => x.id === selected) : undefined;
    return (
      <div className="dock-panel scroll">
        <HotspotsDetails />
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
          <Inspector map={map} selected={selected} onOpen={openAt} onSelect={selectNode} onExplain={explainNode} onTrace={traceNode} onTour={tourNode} impact={impactProps} />
        )}
      </div>
    );
  }, [map, files, detail, selected, openAt, selectNode, jumpTo, tourLinks, changeView, explainService, traceSvc, onLinks, explainNode, traceNode, tourNode, impact, showImpact, tourImpact, explainImpact]);
}
