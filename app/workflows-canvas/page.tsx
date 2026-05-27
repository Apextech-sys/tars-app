"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
import {
  currentWorkflowNameAtom,
  edgesAtom,
  hasSidebarBeenShownAtom,
  isTransitioningFromHomepageAtom,
  nodesAtom,
  type WorkflowNode,
} from "@/lib/workflow-store";

function createDefaultTriggerNode() {
  return {
    id: nanoid(),
    type: "trigger" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "",
      description: "",
      type: "trigger" as const,
      config: { triggerType: "Manual" },
      status: "idle" as const,
    },
  };
}

const WorkflowCanvas = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const nodes = useAtomValue(nodesAtom);
  const edges = useAtomValue(edgesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setCurrentWorkflowName = useSetAtom(currentWorkflowNameAtom);
  const setHasSidebarBeenShown = useSetAtom(hasSidebarBeenShownAtom);
  const setIsTransitioningFromHomepage = useSetAtom(isTransitioningFromHomepageAtom);
  const hasCreatedWorkflowRef = useRef(false);
  const currentWorkflowName = useAtomValue(currentWorkflowNameAtom);

  useEffect(() => {
    setHasSidebarBeenShown(false);
  }, [setHasSidebarBeenShown]);

  useEffect(() => {
    document.title = `${currentWorkflowName} - TARS Workflow Builder`;
  }, [currentWorkflowName]);

  const ensureSession = useCallback(async () => {
    if (!session) {
      await authClient.signIn.anonymous();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [session]);

  const handleAddNode = useCallback(() => {
    const newNode: WorkflowNode = createDefaultTriggerNode();
    setNodes([newNode]);
  }, [setNodes]);

  useEffect(() => {
    const addNodePlaceholder: WorkflowNode = {
      id: "add-node-placeholder",
      type: "add",
      position: { x: 0, y: 0 },
      data: {
        label: "",
        type: "add",
        onClick: handleAddNode,
      },
      draggable: false,
      selectable: false,
    };
    setNodes([addNodePlaceholder]);
    setEdges([]);
    setCurrentWorkflowName("New Workflow");
    hasCreatedWorkflowRef.current = false;
  }, [setNodes, setEdges, setCurrentWorkflowName, handleAddNode]);

  useEffect(() => {
    const createWorkflowAndRedirect = async () => {
      const realNodes = nodes.filter((node) => node.type !== "add");
      if (realNodes.length === 0 || hasCreatedWorkflowRef.current) return;
      hasCreatedWorkflowRef.current = true;

      try {
        await ensureSession();
        const newWorkflow = await api.workflow.create({
          name: "Untitled Workflow",
          description: "",
          nodes: realNodes,
          edges,
        });
        sessionStorage.setItem("animate-sidebar", "true");
        setIsTransitioningFromHomepage(true);
        router.replace(`/workflows/${newWorkflow.id}`);
      } catch (error) {
        console.error("Failed to create workflow:", error);
        toast.error("Failed to create workflow");
      }
    };
    createWorkflowAndRedirect();
  }, [nodes, edges, router, ensureSession, setIsTransitioningFromHomepage]);

  return null;
};

export default WorkflowCanvas;
