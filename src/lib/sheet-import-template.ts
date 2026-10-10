import ExcelJS from 'exceljs';
import { hasAssignedRole, type RoleAccessUser } from './role-access';

export const memberTemplateLabel = (person: {name:string; username:string}) => `${person.name}（账号：${person.username}）`;

/** Keep one visible customer sheet; named lists avoid Excel's 255-character inline-list limit. */
export async function personalizeImportTemplate(bytes: Buffer, people: (RoleAccessUser & {name:string;username:string})[]) {
 const workbook = new ExcelJS.Workbook();
 await workbook.xlsx.load(new Uint8Array(bytes).buffer);
 const sheet = workbook.worksheets[0];
 const lists = workbook.addWorksheet('_本组人员', {state:'veryHidden'});
 const choices = [
  {header:'群操作员',name:'GroupOperators',people:people.filter(p=>hasAssignedRole(p,'GROUP_OPERATOR')||hasAssignedRole(p,'LEAD'))},
  {header:'专家负责人',name:'GroupExperts',people:people.filter(p=>hasAssignedRole(p,'EXPERT'))},
 ];
 choices.forEach((choice,index)=>{
  const letter=String.fromCharCode(65+index);
  choice.people.forEach((person,i)=>{lists.getCell(i+1,index+1).value=memberTemplateLabel(person);});
  workbook.definedNames.add(`'_本组人员'!$${letter}$1:$${letter}$${Math.max(1,choice.people.length)}`,choice.name);
  sheet.getRow(1).eachCell((cell,col)=>{
   if(cell.text!==choice.header)return;
   cell.note='从下拉选择本组在职人员；人员变化后请重新下载模板。本人负责的客户可选择本组对应岗位负责人。';
   sheet.getColumn(col).width=32;
   for(let row=2;row<=504;row++)sheet.getCell(row,col).dataValidation={type:'list',allowBlank:true,formulae:[choice.name],showInputMessage:true,promptTitle:'本组负责人',prompt:choice.people.length?'点击下拉箭头选择，姓名后账号用于区分同名人员。':'本组暂无对应岗位人员，请联系组长配置后重新下载。',showErrorMessage:true,errorStyle:'stop',errorTitle:'请选择本组人员',error:'请从下拉名单选择负责人；人员变化后重新下载模板。'};
  });
 });
 return workbook.xlsx.writeBuffer();
}
