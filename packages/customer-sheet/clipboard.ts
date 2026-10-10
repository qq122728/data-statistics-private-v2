/** CSV/TSV parser supports quoted multiline cells and escaped quotes. */
export function parseSheetText(text: string, separator?: string): string[][] {
  const raw=text.replace(/^\uFEFF/,"");
  const first=raw.split(/\r?\n/,1)[0]??"";
  const delimiter=separator??(first.includes("\t")?"\t":first.includes(";")&&!first.includes(",")?";":",");
  const rows:string[][]=[]; let row:string[]=[]; let cell=""; let quoted=false;
  for(let i=0;i<raw.length;i++) {
    const c=raw[i];
    if(c==='"') { if(quoted && raw[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
    else if(!quoted && c===delimiter) { row.push(cell);cell=""; }
    else if(!quoted && (c==='\n'||c==='\r')) { if(c==='\r'&&raw[i+1]==='\n')i++; row.push(cell);if(separator || row.some(v=>v.trim()))rows.push(row);row=[];cell=""; }
    else cell+=c;
  }
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
