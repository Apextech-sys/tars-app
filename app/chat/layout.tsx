import type { ReactNode } from "react";

// Chat gets its own full-screen layout, isolated from the workflow canvas
export default function ChatLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
