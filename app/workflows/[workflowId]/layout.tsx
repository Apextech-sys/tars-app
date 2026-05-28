import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";

interface WorkflowLayoutProps {
  children: ReactNode;
  params: Promise<{ workflowId: string }>;
}

export async function generateMetadata({
  params,
}: WorkflowLayoutProps): Promise<Metadata> {
  const { workflowId } = await params;

  // Try to fetch the workflow to get its name
  let title = "Workflow";
  let isPublic = false;

  try {
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
      columns: {
        name: true,
        visibility: true,
      },
    });

    if (workflow) {
      isPublic = workflow.visibility === "public";
      // Only expose workflow name in metadata if it's public
      // This prevents private workflow name enumeration
      if (isPublic) {
        title = workflow.name;
      }
    }
  } catch {
    // Ignore errors, use defaults
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://tars.apextech.group";

  return {
    title: `${title} | TARS`,
    description: `Workflow: ${title}`,
    openGraph: {
      title: `${title} | TARS`,
      description: `Workflow: ${title}`,
      type: "website",
      url: `${baseUrl}/workflows/${workflowId}`,
      siteName: "TARS",
    },
  };
}

export default function WorkflowLayout({ children }: WorkflowLayoutProps) {
  return children;
}
