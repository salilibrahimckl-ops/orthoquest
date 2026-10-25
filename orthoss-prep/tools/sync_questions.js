// usage: node sync_questions.js <artifact.html> <out.json>
const fs=require('fs'),vm=require('vm');
const h=fs.readFileSync(process.argv[2],'utf8');
const js=h.match(/<script>([\s\S]*?)<\/script>/)[1].split('render();').slice(0,-1).join('render();');
const ctx={localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:()=>({addEventListener(){}})},console};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(js+';this.__raw=RAW;this.__upd=BANK_UPDATED;',ctx);
const raw=ctx.__raw;
raw.forEach((r,i)=>{if(!Array.isArray(r[3])||r[3].length!==4||r[4]<0||r[4]>3)throw new Error('bad entry '+i)});
if(new Set(raw.map(r=>r[2])).size!==raw.length)throw new Error('duplicate question text');
let prev=null;try{prev=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))}catch(e){}
if(prev){if(raw.length<prev.raw.length)throw new Error('new bank is smaller than published bank');
  prev.raw.forEach((r,i)=>{if(r[2]!==raw[i][2])throw new Error('order changed at '+i+' - would break saved progress')})}
fs.writeFileSync(process.argv[3],JSON.stringify({updated:ctx.__upd,count:raw.length,raw}));
console.log('questions.json',raw.length,'questions, updated',ctx.__upd,prev?'(was '+prev.raw.length+')':'');
