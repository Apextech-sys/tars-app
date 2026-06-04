"use client";

import { usePathname } from "next/navigation";
import { WorkflowCanvas } from "./workflow-canvas";

export function PersistentCanvas() {
  const pathname = usePathname();

  // Show canvas only on the relocated visual-builder routes (control-room
  // /workflows pages must not have the canvas drawn over them).
  const showCanvas = pathname.startsWith("/workflows-canvas/");

  if (!showCanvas) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-0">
      <WorkflowCanvas />
    </div>
  );
}
