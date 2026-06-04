"use client";

import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { GlobalModals } from "@/components/global-modals";
import { OverlayProvider } from "@/components/overlays/overlay-provider";
import { PersistentCanvas } from "@/components/workflow/persistent-canvas";

/**
 * Layout for /workflows-canvas and /workflows-canvas/[workflowId].
 *
 * Hosts the @xyflow visual-builder canvas (the user-workflow World). Provides
 * the ReactFlow context + overlay system the canvas needs and renders the
 * PersistentCanvas so it appears on these routes only. Relocated from
 * /workflows, which is now TARS's durable-workflow control room.
 */
export default function WorkflowsCanvasLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ReactFlowProvider>
      <OverlayProvider>
        <PersistentCanvas />
        <div className="pointer-events-none relative z-10">{children}</div>
        <GlobalModals />
      </OverlayProvider>
    </ReactFlowProvider>
  );
}
