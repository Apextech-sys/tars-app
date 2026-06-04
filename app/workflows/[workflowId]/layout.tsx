import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getWorkflowDefinition } from "@/lib/tars/workflow-registry";

interface WorkflowLayoutProps {
  children: ReactNode;
  params: Promise<{ workflowId: string }>;
}

export async function generateMetadata({
  params,
}: WorkflowLayoutProps): Promise<Metadata> {
  const { workflowId } = await params;
  const def = getWorkflowDefinition(workflowId);
  const title = def ? `${def.label} workflow` : "Workflow";
  return {
    title: `${title} | TARS`,
    description: def?.description ?? `Workflow: ${title}`,
  };
}

export default function WorkflowLayout({ children }: WorkflowLayoutProps) {
  return children;
}
