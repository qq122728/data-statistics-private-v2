import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sheetHttp } from '../../../../lib/customer-sheet-http';
import { sheetAccess, SheetError } from '../../../../lib/customer-sheet';
import { personalizeImportTemplate } from '../../../../lib/sheet-import-template';
import { db } from '../../../../lib/db';

const names:Record<string,string>={unified:'客户统一导入模板',pending:'待进群导入模板',group:'在群跟进导入模板',expert:'专家跟进导入模板'};
export async function GET(request:Request){
 return sheetHttp(async actorId=>{
  const query=new URL(request.url).searchParams;
  const stage=query.get('stage')||'unified';
  if(!Object.hasOwn(names,stage))throw new SheetError('请选择客户统一导入模板');
  const people=await db.$transaction(async tx=>{
   const groupId=query.get('groupId')||'';
   if(!(await sheetAccess(tx,actorId,groupId)).canCreate)throw new SheetError('此账号不能导入',403);
   return tx.user.findMany({where:{groupId,active:true},select:{name:true,username:true,role:true,active:true,roleAssignments:true},orderBy:[{name:'asc'},{username:'asc'}]});
  });
  const bytes=await readFile(join(process.cwd(),'assets','import-templates',stage+'.xlsx'));
  return new Response(new Uint8Array(await personalizeImportTemplate(bytes,people)),{headers:{
   'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'Content-Disposition':`attachment; filename="${stage}-import.xlsx"; filename*=UTF-8''${encodeURIComponent(names[stage]+'.xlsx')}`,
   'Cache-Control':'private, no-store',
  }});
 });
}
