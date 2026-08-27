import ExcelJS from "exceljs";

type AttendanceRole = "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type AttendanceRecord = {
  userId: string;
  businessDate: string;
  clockInAt: Date | null;
  clockInStatus: "NORMAL" | "LATE" | "EARLY" | null;
  clockOutStatus: "NORMAL" | "LATE" | "EARLY" | null;
  leaveAt: Date | null;
};
type AttendanceMember = { id: string; name: string; role: AttendanceRole; groupName: string; departmentName: string; hireDate: string | null; recruitmentSource: "DIRECT" | "AGENT" | null; referrerName: string | null };

const roleName: Record<AttendanceRole, string> = { LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家" };

function recruitmentLabel(member: AttendanceMember) {
  if (!member.recruitmentSource) return "待补";
  if (member.recruitmentSource === "DIRECT") return "公司直营";
  return member.referrerName ? `代理介绍：${member.referrerName}` : "代理介绍：待补介绍人";
}

function datesInMonth(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  const total = new Date(Date.UTC(year, monthValue, 0)).getUTCDate();
  return Array.from({ length: total }, (_, offset) => `${month}-${String(offset + 1).padStart(2, "0")}`);
}

export async function buildAttendanceWorkbook(input: { month: string; members: AttendanceMember[]; records: AttendanceRecord[] }) {
  const dates = datesInMonth(input.month);
  const recordsByUser = new Map<string, Map<string, AttendanceRecord>>();
  for (const record of input.records) {
    const userRecords = recordsByUser.get(record.userId) ?? new Map<string, AttendanceRecord>();
    userRecords.set(record.businessDate, record);
    recordsByUser.set(record.userId, userRecords);
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "数据统计";
  const sheet = workbook.addWorksheet("月度考勤", { views: [{ state: "frozen", ySplit: 3, xSplit: 4 }] });
  const lastColumn = 6 + dates.length + 5;
  sheet.mergeCells(1, 1, 1, lastColumn);
  const title = sheet.getCell(1, 1);
  title.value = `${input.month.replace("-", " 年 ")} 月度考勤报表`;
  title.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  sheet.getRow(1).height = 26;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = "✓ 正常上班　迟 迟到上班　请 已请假　— 未打卡。归属代理由财务维护：公司直营，或代理介绍 + 介绍人；待补表示旧员工资料尚未补齐。";
  sheet.getCell(2, 1).font = { color: { argb: "FF64748B" }, italic: true };
  const headers = ["归属代理", "公司", "小组", "姓名", "岗位", "入职日期", ...dates.map((date) => String(Number(date.slice(-2)))), "出勤", "请假", "迟到", "早退", "未打卡"];
  sheet.getRow(3).values = headers;
  const header = sheet.getRow(3);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  header.height = 30;
  for (const member of input.members) {
    const records = recordsByUser.get(member.id) ?? new Map<string, AttendanceRecord>();
    let attended = 0; let leave = 0; let late = 0; let early = 0;
    const states = dates.map((date) => {
      const record = records.get(date);
      if (record?.leaveAt) { leave += 1; return "请"; }
      if (record?.clockInAt) { attended += 1; if (record.clockInStatus === "LATE") { late += 1; return "迟"; } if (record.clockOutStatus === "EARLY") early += 1; return "✓"; }
      return "—";
    });
    const row = sheet.addRow([recruitmentLabel(member), member.departmentName, member.groupName, member.name, roleName[member.role], member.hireDate ?? "待补", ...states, attended, leave, late, early, dates.length - attended - leave]);
    row.alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(4).font = { bold: true, color: { argb: "FF1F2937" } };
    for (let index = 7; index < 7 + dates.length; index += 1) {
      const cell = row.getCell(index);
      if (cell.value === "✓") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
      if (cell.value === "迟") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
      if (cell.value === "请") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4DFEC" } };
    }
  }
  sheet.columns = [
    { width: 22 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    ...dates.map(() => ({ width: 4 })),
    { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 10 },
  ];
  return workbook;
}
