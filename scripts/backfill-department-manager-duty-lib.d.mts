export type DepartmentManagerAccount = {
  id: string;
  username: string;
  name: string;
  duty: string | null;
  departmentId: string | null;
  active: boolean;
};

export type DepartmentManagerDutyBackfillPlan = {
  roleAccounts: DepartmentManagerAccount[];
  toBackfill: DepartmentManagerAccount[];
  alreadySet: DepartmentManagerAccount[];
};

type BackfillClient = {
  user: {
    findMany(args: {
      where: { role: "COMPANY_MANAGER" };
      select: { id: true; username: true; name: true; duty: true; departmentId: true; active: true };
      orderBy: { username: "asc" };
    }): Promise<DepartmentManagerAccount[]>;
    updateMany(args: {
      where: { id: { in: string[] }; role: "COMPANY_MANAGER"; duty: null };
      data: { duty: "DEPARTMENT_MANAGER" };
    }): Promise<{ count: number }>;
  };
};

export function planDepartmentManagerDutyBackfill(db: BackfillClient): Promise<DepartmentManagerDutyBackfillPlan>;
export function applyDepartmentManagerDutyBackfill(
  db: BackfillClient,
  toBackfill: DepartmentManagerAccount[],
): Promise<{ count: number }>;
