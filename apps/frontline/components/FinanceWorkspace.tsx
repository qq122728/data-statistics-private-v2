"use client";

import type { BackendUser } from "@/lib/backend";
import ResourceWorkspace from "@/components/ResourceWorkspace";

export default function FinanceWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  return <ResourceWorkspace user={user} onLogout={onLogout} audience="finance" />;
}
