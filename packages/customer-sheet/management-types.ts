import type { CustomerStage } from "./navigation";

export type ProgressGroup = { id: string; name: string; departmentId: string; departmentName: string; companyId: string; companyName: string };
export type ProgressRow = {
  id: string; phone: string; code: string; groupId: string; stage: CustomerStage; status: string;
  owner: string; operator: string; expert: string; originalOwner: string; originalGroup: string;
  intakeOn: string; joinedOn: string; expertOn: string; updatedAt: string; days: number | null; channel: string;
};
export type ProgressPayload = {
  groups: ProgressGroup[]; members: { id: string; name: string }[]; today: string;
  rows: ProgressRow[]; total: number; page: number; pages: number; pageSize: number;
  counts: Record<"all" | CustomerStage, number>;
};
export type ProgressDetail = {
  row: ProgressRow;
  fields: { id: string; label: string; value: string; stage: string }[];
  funds: { date: string; kind: string; method: string; amount: number; code: string }[];
  total: number; withdrawal: number; legacyBalance: number;
};
