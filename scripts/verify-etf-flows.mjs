import fs from 'node:fs/promises';
import path from 'node:path';
import {validateFlowSnapshot,check} from './etf-flow-core.mjs';
const directory=process.argv[2]??'public/data';
const today=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
const latest=validateFlowSnapshot(JSON.parse(await fs.readFile(path.join(directory,'etf-flows.json'),'utf8')),today);
const archive=JSON.parse(await fs.readFile(path.join(directory,'etf-flows-history.json'),'utf8'));
check(archive.schemaVersion===1&&Array.isArray(archive.sessions)&&archive.sessions.length>0,'archive missing');
let previous='';
for(const session of archive.sessions){
  validateFlowSnapshot(session,today);
  check(session.asOf>previous,'archive date order/duplicate');previous=session.asOf;
}
check(JSON.stringify(archive.sessions.at(-1))===JSON.stringify(latest),'latest/archive disagreement');
console.log(JSON.stringify({verified:true,asOf:latest.asOf,rows:latest.rows.length,
  sessions:archive.sessions.length,checks:latest.checks}));
