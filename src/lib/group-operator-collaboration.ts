/**
 * 组长手工分配的接粉员，加上炒群员自己兼任接粉时的本人。
 * 本人不需要再额外配置一遍，也会自动去重。
 */
export function resolveAccessibleReceptionistIds(input: {
  operatorId: string;
  pairedReceptionistIds: string[];
  isReceptionist: boolean;
}): string[] {
  return [...new Set([
    ...input.pairedReceptionistIds,
    ...(input.isReceptionist ? [input.operatorId] : []),
  ])];
}
