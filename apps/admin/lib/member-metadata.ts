/** 岗位权限（干哪道工序）——同一账号可拥有接粉、炒群、专家任意组合。 */
export type Position = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
export const POSITION_META: Record<Position, string> = {
  RECEPTION: "接粉",
  GROUP_OPERATOR: "炒群",
  EXPERT: "专家",
};
export const POSITION_ORDER: Position[] = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"];

/** 组员——一个人可同时拥有 1-3 个岗位权限，客户资料仍只有一份。 */
export type Member = {
  id: string;
  name: string;
  username: string;
  /** 后端主岗位；新增兼任权限时必须保留，不能被前端重新排序后误改。 */
  primaryPosition?: Position;
  /** 是否必须在首次登录或密码重置后修改密码。 */
  mustChangePassword: boolean;
  positions: Position[];
  /** 炒群岗位专用：这个炒群配对了哪几个接粉——只有 positions 里有 GROUP_OPERATOR 才有意义 */
  pairedReceptionIds?: string[];
  /** 接粉岗位专用：这个接粉配对给了哪个炒群——只有 positions 里有 RECEPTION 才有意义 */
  pairedGroupOperatorId?: string;
  /** 专家岗位专用：这个专家是不是本组默认专家（没指定专家时客户推给谁） */
  isDefaultExpert?: boolean;
  active: boolean;
  joinedGroupDate: string;
};
