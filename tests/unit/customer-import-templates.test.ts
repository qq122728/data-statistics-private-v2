import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { expect, it } from "vitest";

it("四种客户导入模板可读取，号码保持文本且统一模板包含阶段示例", async () => {
  for (const stage of ["pending", "group", "expert", "unified"]) {
    const bytes = await readFile(join(process.cwd(), "assets/import-templates", `${stage}.xlsx`));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(bytes).buffer);
    const sheet = workbook.worksheets[0];
    const phoneColumn = stage === "unified" ? 2 : 1;
    expect(sheet.getCell(2, phoneColumn).numFmt).toBe("@");
    expect(sheet.getRow(1).getCell(phoneColumn).text).toBe("客户号码");
    if (stage === "unified") {
      expect(sheet.name).toBe("客户导入");
      expect(sheet.getCell("A2").dataValidation.formulae).toEqual(['"待进群,在群跟进,专家跟进"']);
      expect(sheet.getCell("C2").text).toContain("示例，不导入");
      expect(sheet.getCell("F504").text).toBe("有效");
    } else {
      expect(workbook.getWorksheet("填写说明")).toBeTruthy();
    }
  }
});
