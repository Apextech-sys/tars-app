"use client";

import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { GlobalModals } from "@/components/global-modals";
import { OverlayProvider } from "@/components/overlays/overlay-provider";
import { PersistentCanvas } from "@/components/workflow/persistent-canvas";

/**
 * Layout for /workflows and /workflows/[workflowId].
 * Provides ReactFlow context + overlay system needed by the canvas.
 * Also renders PersistentCanvas so it appears on workflow routes only.
 */
export default function WorkflowsLayout({ children }: { children: ReactNode }) {
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
