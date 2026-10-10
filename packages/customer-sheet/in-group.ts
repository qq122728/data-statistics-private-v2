export type InGroupCounts={joinCount?:number;normalLeaveCount?:number;abnormalLeaveCount?:number};
export function inGroupDelta(v:InGroupCounts){return (v.joinCount||0)-(v.normalLeaveCount||0)-(v.abnormalLeaveCount||0);}
