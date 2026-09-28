import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const groups = [
  ['base','company',36,2],['base','startup',5,1],['base','capitalist',5,1],
  ['interbellum','company',24,2],['interbellum','startup',4,1],['interbellum','capitalist',5,1],
  ['interbellum','agent',4,1],['interbellum','university',3,2],['interbellum','manager',14,1],['interbellum','personal-manager',1,1],
];
const components = groups.flatMap(([set,kind,count,sides])=>Array.from({length:count},(_,i)=>({
  slotId:`${set}-${kind}-${String(i+1).padStart(2,'0')}`, set,kind,
  identification:null, expectedGameplaySides:sides, evidence:[], status:'awaiting-evidence',
  familyId:null, effects:null, notes:'Inventory slot only; not an identified original card.',
})));
await mkdir('research',{recursive:true});
try {
  const existing = JSON.parse(await readFile('research/component-register.json', 'utf8'));
  if (existing.components.some(c => c.evidence?.length || c.status !== 'awaiting-evidence' || c.identification || c.effects))
    throw new Error('The inventory already contains research data. It must not be regenerated.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile('research/component-register.json',JSON.stringify({schemaVersion:1,physicalCards:86,managerTokens:15,verifiedComponents:0,components},null,2)+'\n');
const sources=[];
for(const [id,url,version] of [
  ['base','https://hobbygames.ru/download/rules/industry_rules.pdf','1.1'],
  ['faq','https://hobbygames.ru/download/rules/industry_faq.pdf',null],
  ['interbellum','https://hobbygames.ru/download/rules/industry-interbellum-rules.pdf','1.0'],
]) {
  const bytes=await readFile(`research/sources/${id}.pdf`);
  sources.push({id,url,version,retrievedAt:'2026-09-25',sha256:createHash('sha256').update(bytes).digest('hex'),localPath:`research/sources/${id}.pdf`});
}
await writeFile('research/source-manifest.json',JSON.stringify({sources},null,2)+'\n');
console.log('Inventory: 86 card slots + 15 manager tokens. Verified: 0.');
