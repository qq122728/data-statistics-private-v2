import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseCustomerImportClipboard, parseCustomerImportRows } from "../../src/lib/customer-import-clipboard";
import { parseCustomerImportCsv, parseCustomerImportFile } from "../../src/lib/customer-import-file";

describe("客户资料 Excel 粘贴", () => {
  it("按导入表的列顺序读取多行资料，并优先匹配自己的设备库", () => {
    const result = parseCustomerImportClipboard(
      "客户编号\t客户姓名\t前台接粉设备号\t客户金额（美元）\t客户平台\t备注\n13800138000\tAllen\tA13\t4832\tMT5\t晚间联系\n13900139000\tBob\t临时机\t6000\tWeb\t已加好友",
      [{ id: "device-a13", code: "A13" }],
      (index) => `row-${index}`,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({ id: "row-0", phone: "13800138000", customerName: "Allen", deviceMode: "SELECT", deviceId: "device-a13", lossAmount: "4832", customerPlatform: "MT5", notes: "晚间联系" }),
      expect.objectContaining({ id: "row-1", phone: "13900139000", customerName: "Bob", deviceMode: "MANUAL", deviceCode: "临时机", lossAmount: "6000", customerPlatform: "Web", notes: "已加好友" }),
    ]);
  });

  it("提示不合法金额，不把有问题的行加入导入表", () => {
    const result = parseCustomerImportClipboard("13800138000\tAllen\t\t不是金额\tMT5\t", [], (index) => `row-${index}`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["第 1 行：客户金额不是有效数字"]);
  });

  it("按被骗资料表的列名自动映射邮箱和 WhatsApp 后六位", () => {
    const result = parseCustomerImportClipboard(
      "被骗金额（$）\t被骗平台\t邮箱\t客户名字\tWhatsApp\n50000\tPfalz Finanz AG\tdieter-hellmann@t-online.de\tDieter Hellmann\t491713035238",
      [],
      (index) => `fraud-${index}`,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "fraud-0", phone: "035238", customerName: "Dieter Hellmann", customerEmail: "dieter-hellmann@t-online.de",
        lossAmount: "50000", customerPlatform: "Pfalz Finanz AG",
      }),
    ]);
  });

  it("识别无表头的五列被骗资料，不把客户姓名误当金额", () => {
    const result = parseCustomerImportClipboard(
      "500.00\t事实上\t51587@qq.com\t请问我去\t457878113",
      [],
      (index) => `headerless-${index}`,
    );

    expect(result).toEqual({
      errors: [],
      rows: [expect.objectContaining({
        id: "headerless-0",
        phone: "878113",
        customerName: "请问我去",
        customerEmail: "51587@qq.com",
        lossAmount: "500",
        customerPlatform: "事实上",
      })],
    });
  });

  it("读取文件表格的标准六列，并把 WhatsApp / 手机号转换为后六位客户编号", () => {
    const result = parseCustomerImportRows(
      [
        ["被骗金额（美元）", "被骗平台", "邮箱", "客户姓名", "WhatsApp / 手机号", "备注"],
        ["50000", "Pfalz Finanz AG", "dieter-hellmann@t-online.de", "Dieter Hellmann", "491713035238", "优先联系"],
      ],
      [],
      (index) => `file-${index}`,
    );

    expect(result).toEqual({
      errors: [],
      rows: [expect.objectContaining({
        id: "file-0",
        phone: "035238",
        customerName: "Dieter Hellmann",
        customerEmail: "dieter-hellmann@t-online.de",
        lossAmount: "50000",
        customerPlatform: "Pfalz Finanz AG",
        notes: "优先联系",
      })],
    });
  });

  it("读取逗号分隔的 CSV 文件，并保留带逗号的备注内容", () => {
    const result = parseCustomerImportCsv(
      "被骗金额（美元）,被骗平台,邮箱,客户姓名,WhatsApp / 手机号,备注\n50000,Pfalz Finanz AG,dieter-hellmann@t-online.de,Dieter Hellmann,491713035238,\"今晚联系, 需要德语\"",
      [],
      (index) => `csv-${index}`,
    );

    expect(result).toEqual({
      errors: [],
      rows: [expect.objectContaining({
        id: "csv-0",
        phone: "035238",
        customerName: "Dieter Hellmann",
        notes: "今晚联系, 需要德语",
      })],
    });
  });

  it("读取 xlsx 文件时沿用标准六列和 WhatsApp 后六位规则", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("客户资料");
    sheet.addRow(["被骗金额（美元）", "被骗平台", "邮箱", "客户姓名", "WhatsApp / 手机号", "备注"]);
    sheet.addRow(["50000", "Pfalz Finanz AG", "dieter-hellmann@t-online.de", "Dieter Hellmann", "491713035238", "优先联系"]);
    const file = new File([await workbook.xlsx.writeBuffer()], "客户资料.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    const result = await parseCustomerImportFile(file, [], (index) => `xlsx-${index}`);

    expect(result).toEqual({
      errors: [],
      rows: [expect.objectContaining({ id: "xlsx-0", phone: "035238", customerName: "Dieter Hellmann", notes: "优先联系" })],
    });
  });

  it("把无表头的一行被骗资料按邮箱和末尾 WhatsApp 自动拆开", () => {
    const result = parseCustomerImportClipboard(
      "50000 Pfalz Finanz AGdieter-hellmann@t-online.deDieter Hellmann 491713035238",
      [],
      (index) => `plain-${index}`,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "plain-0", phone: "035238", customerName: "Dieter Hellmann", customerEmail: "dieter-hellmann@t-online.de",
        lossAmount: "50000", customerPlatform: "Pfalz Finanz AG",
      }),
    ]);
  });
});
