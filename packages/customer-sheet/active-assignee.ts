import { isExpertCustomer, type SheetData } from "./schema";

// Count each active row once, under the person responsible for its current stage.
export function sheetActiveAssignee(ownerId: string, data: SheetData): string | null {
  return sheetActiveAssignment(ownerId, data)?.ownerId ?? null;
}

export function sheetActiveAssignment(ownerId: string, data: SheetData): {ownerId:string; field:"ownerId"|"operatorId"|"expertId"; stage:"reception"|"operator"|"expert"} | null {
  if (data.__deletedAt) return null;
  if (data.normalLeft === true || data.abnormalLeft === true) return null;
  if (data.expertMode === "暂停跟进" || data.expertMode === "已结束") return null;
  if (data.quality && data.quality !== "有效") return null;
  if (isExpertCustomer(data) && data.expertId) return {ownerId:String(data.expertId),field:"expertId",stage:"expert"};
  if (data.joinedOn) return {ownerId:String(data.operatorId || ownerId),field:"operatorId",stage:"operator"};
  return {ownerId,field:"ownerId",stage:"reception"};
}
