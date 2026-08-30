export type ManagedDepartmentUser = {
  departmentId?: string | null;
  managedDepartments?: Array<{ departmentId: string }>;
};

/** 新版多部门授权优先；旧账号尚未回填时继续兼容 departmentId。 */
export function managedDepartmentIds(user: ManagedDepartmentUser): string[] {
  const ids = new Set((user.managedDepartments ?? []).map((item) => item.departmentId));
  if (user.departmentId) ids.add(user.departmentId);
  return [...ids];
}

export function canManageDepartment(user: ManagedDepartmentUser, departmentId: string): boolean {
  return managedDepartmentIds(user).includes(departmentId);
}
