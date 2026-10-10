import { prepareNumberImport, ImportHeaderChoiceError } from "../../../../../packages/customer-sheet/number-import";
import { z } from "zod";
import ExcelJS from "exceljs";
import { readImportWorkbook, assertImportQuality, importRowStage, isTemplateExample, isDefaultQualityRow } from "../../../../lib/sheet-import-workbook";
import { sheetHttp } from "../../../../lib/customer-sheet-http";
import { sheetAccess, SheetError } from "../../../../lib/customer-sheet";
import { db } from "../../../../lib/db";
import { parseSheetText } from "../../../../lib/sheet-import";
export async function POST(request:Request) {
  return sheetHttp(async actorId=>{
    if(Number(request.headers.get("content-length")||0)>11*1024*1024) throw new SheetError("文件不能超过10MB",413);
    const form=await request.formData();
    const groupId=String(form.get("groupId")??"");
    const headerChoices=z.record(z.string().max(128),z.enum(["header","customer"])).parse(JSON.parse(String(form.get("headerChoices")||"{}")));
    await db.$transaction(async tx=>{if(!(await sheetAccess(tx,actorId,groupId)).canCreate) throw new SheetError("此账号不能导入",403);});
    const file=form.get("file");let matrix:string[][]=[];
    if(file instanceof File) {
      if(file.size>10*1024*1024) throw new SheetError("文件不能超过10MB",413);
      if(/\.(csv|tsv|txt)$/i.test(file.name)) matrix=parseSheetText(await file.text());
      else if(/\.xlsx$/i.test(file.name)) {
        const workbook=new ExcelJS.Workbook();
        const contents=await file.arrayBuffer();
        try {
          await workbook.xlsx.load(contents);
        } catch {
          throw new SheetError("无法读取此 Excel 文件，文件可能已损坏或已加密。请用 Excel 打开后另存为 .xlsx，再重新选择上传。");
        }
        try { return readImportWorkbook(workbook,form.get("mode")==="numbers",headerChoices); }
        catch(error) {
          if(error instanceof ImportHeaderChoiceError)return Response.json({error:error.message,headerQuestion:error.question},{status:400,headers:{"Cache-Control":"private, no-store"}});
          throw new SheetError((error as Error).message);
        }
      } else throw new SheetError("支持 XLSX、CSV、TSV 文件");
    } else matrix=parseSheetText(String(form.get("text")??""));
    let firstDataRowIndex=1;
    if(matrix.some(r=>r.length>60))throw new SheetError("每次最多500行、60列");
    if(form.get("mode")==="numbers"){
      try {const prepared=prepareNumberImport(matrix,headerChoices["名单"]);matrix=prepared.matrix;firstDataRowIndex=prepared.firstDataRowIndex;}
      catch(error){if(error instanceof ImportHeaderChoiceError)return Response.json({error:error.message,headerQuestion:error.question},{status:400,headers:{"Cache-Control":"private, no-store"}});throw error;}
    }
    if(matrix.length<2) throw new SheetError("请提供表头和至少一行客户数据");
    const skippedExamples=matrix.slice(1).filter(cells=>isTemplateExample(matrix[0],cells)).length;
    const retained=matrix.slice(1).map((cells,i)=>({cells,row:i+firstDataRowIndex+1})).filter(({cells})=>!isTemplateExample(matrix[0],cells)&&!isDefaultQualityRow(matrix[0],cells));
    if(!retained.length)throw new SheetError("已跳过模板示例，尚未填写真实客户。请填写后再上传。");
    try { for(const record of retained)assertImportQuality(matrix[0],record.cells,`第${record.row}行`); } catch(error) { throw new SheetError((error as Error).message); }
    matrix=[matrix[0],...retained.map(r=>r.cells)];
    if(matrix.length>501 || matrix.some(r=>r.length>60)) throw new SheetError("每次最多500行、60列");
    let sources;
    if(matrix[0].includes("业务阶段")){try{sources=matrix.slice(1).map((cells,i)=>({sheet:"客户导入",row:retained[i].row,stage:importRowStage(matrix[0],cells,`第${retained[i].row}行`)}));}catch(error){throw new SheetError((error as Error).message);}}
    return {headers:matrix[0],rows:matrix.slice(1),sources,skippedExamples,note:"此步骤仅预览，确认后才保存；此名单使用所选导入阶段"};
  });
}
