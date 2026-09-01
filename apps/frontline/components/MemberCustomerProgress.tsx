import type { BackendUser } from "@/lib/backend";
import { DepartmentCustomerProgress } from "./DepartmentCustomerProgress";

export function MemberCustomerProgress({ user, openLegacyImportRequest = 0 }: { user: BackendUser; openLegacyImportRequest?: number }) {
  return <DepartmentCustomerProgress
    groups={user.groupId ? [{ id: user.groupId, name: user.groupName ?? "本小组" }] : []}
    member={user}
    openLegacyImportRequest={openLegacyImportRequest}
  />;
}
