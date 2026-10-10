import {db} from '../../src/lib/db';
import {repairNumberStock} from '../../src/lib/repair-number-stock';
async function main(){
 const apply=process.argv.includes('--apply');
 const groups=await db.teamGroup.findMany({where:{groupType:'HACKER'},select:{id:true,name:true}});
 const results=[];
 for(const group of groups){
  const changes=await db.$transaction(tx=>repairNumberStock(tx,group.id,apply),{isolationLevel:'Serializable',timeout:60000});
  results.push({groupId:group.id,name:group.name,changes});
 }
 console.log(JSON.stringify({apply,changed:results.reduce((n,g)=>n+g.changes.length,0),results}));
}
main().finally(()=>db.$disconnect());
