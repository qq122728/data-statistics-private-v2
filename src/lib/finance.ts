export function validateFanBreakdown(input: {
  newFans: number;
  effectiveFans: number;
  noNumber: number;
  duplicateFans: number;
}): { valid: true } | { valid: false; message: string } {
  if (input.effectiveFans + input.noNumber + input.duplicateFans > input.newFans) {
    return { valid: false, message: "有效粉、无 WS 号码和撞粉合计不能大于提交号码" };
  }

  return { valid: true };
}
