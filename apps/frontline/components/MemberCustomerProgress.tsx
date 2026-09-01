import type { BackendUser } from "@/lib/backend";
import { DepartmentCustomerProgress } from "./DepartmentCustomerProgress";

export function MemberCustomerProgress({ user }: { user: BackendUser }) {
  return <DepartmentCustomerProgress
    groups={user.groupId ? [{ id: user.groupId, name: user.groupName ?? "本小组" }] : []}
    member={user}
  />;
}
