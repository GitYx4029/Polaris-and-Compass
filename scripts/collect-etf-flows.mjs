// Deterministic, standalone collection. No account, browser or LLM required.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chartUrl,tableUrl,flowSourceUrl,check,parseRanking,reconcileUniverse,
  parseTurnover,validateFlowSnapshot} from './etf-flow-core.mjs';

const started=performance.now(),now=new Date();
const today=new Date(now.getTime()+8*3600_000).toISOString().slice(0,10);
const directory=path.resolve(process.env.ETF_FLOWS_OUTPUT_DIR??'public/data');
const output=path.join(directory,'etf-flows.json'),archiveFile=path.join(directory,'etf-flows-history.json');
let requests=0;
async function get(url){
  let error;
  for(let attempt=0;attempt<2;attempt++){
    try{
      requests++;
      const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',
        'Referer':flowSourceUrl,'Accept':'application/json,text/plain,*/*'},signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return await response.text();
    }catch(e){error=e;}
  }
  throw new Error(`${new URL(url).hostname}: ${error}`);
}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ranking=parseRanking(JSON.parse(await get(chartUrl)),today);
const digest=fingerprint(ranking);
let prior=null;
try{prior=JSON.parse(await fs.readFile(output,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(prior&&process.env.ETF_FLOWS_FORCE!=='1'){
  validateFlowSnapshot(prior,today);
  check(ranking.date>=prior.asOf,'source date regressed; keep the verified archive');
  if(prior.asOf===ranking.date&&prior.rankingDigest===digest){
    console.log(JSON.stringify({asOf:prior.asOf,unchanged:true,requests,
      seconds:Number(((performance.now()-started)/1000).toFixed(2))}));
    process.exit(0);
  }
}
// Full provider universe verifies that no larger inflow was omitted.
const first=JSON.parse(await get(tableUrl+'1'));
check(first.ret===0&&Number.isInteger(first.total)&&first.total>=500&&first.total<=5000&&
  Array.isArray(first.data)&&first.data.length>0,'invalid universe response');
const pages=[first];
if(first.data.length<first.total){
  const count=Math.ceil(first.total/first.data.length);
  for(let page=2;page<=count;page++)pages.push(JSON.parse(await get(tableUrl+page)));
}
const universe=reconcileUniverse(ranking,pages);
let next=0;
const rows=new Array(20);
async function worker(){
  while(next<universe.rows.length){
    const i=next++,item=universe.rows[i];
    const symbol=(item.code.startsWith('5')?'sh':'sz')+item.code;
    const url=new URL('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get');
    url.searchParams.set('_var','etf_'+symbol);
    url.searchParams.set('param',`${symbol},day,,,40,qfq`);
    const raw=await get(url.toString()),start=raw.indexOf('={');
    check(start>=0,'unexpected Tencent response');
    const payload=JSON.parse(raw.slice(start+1).replace(/;\s*$/,''));
    const amount=parseTurnover(payload,symbol,ranking.date);
    let sameDateCrossCheck=false;
    if(item.providerQuoteDate===ranking.date){
      check(item.providerTurnoverYi>0&&Math.abs(amount-item.providerTurnoverYi)<=Math.max(.03,amount*.005),
        `provider/Tencent same-day turnover mismatch ${item.code}`);
      sameDateCrossCheck=true;
    }
    rows[i]={rank:item.rank,code:item.code,name:item.name,fullName:item.fullName,
      netInflowYi:item.netInflowYi,turnoverYi:amount,turnoverDate:ranking.date,
      providerQuoteDate:item.providerQuoteDate,turnoverSourceUrl:url.toString(),sameDateCrossCheck};
  }
}
await Promise.all(Array.from({length:6},()=>worker()));
// A provider update halfway through collection must not mix two sessions.
check(fingerprint(parseRanking(JSON.parse(await get(chartUrl)),today))===digest,
  'ranking changed during collection; retry next schedule');
const snapshot={schemaVersion:1,asOf:ranking.date,generatedAt:now.toISOString(),
  source:'证券之星 ETF 数据宝',sourceUrl:flowSourceUrl,
  method:'数据源净申购赎回估算原值，非二级市场主力资金流向',
  rankingUrl:chartUrl,universeCount:universe.total,rankingDigest:digest,
  checks:{rankingMatched:20,turnoverDateMatched:20,fundTypeConfirmed:20,
    sameDateCrossChecks:rows.filter(row=>row.sameDateCrossCheck).length,
    providerRecords:universe.providerRecords,deduplicated:universe.deduplicated},
  rows,collection:{requests,seconds:Number(((performance.now()-started)/1000).toFixed(2))}};
validateFlowSnapshot(snapshot,today);
let archive={schemaVersion:1,sessions:[]};
try{archive=JSON.parse(await fs.readFile(archiveFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
check(archive.schemaVersion===1&&Array.isArray(archive.sessions),'archive schema');
for(const session of archive.sessions)validateFlowSnapshot(session,today);
const sessions=new Map(archive.sessions.map(session=>[session.asOf,session]));
check(sessions.size===archive.sessions.length,'duplicate archive date');
check(!prior||ranking.date>=prior.asOf,'source date regressed');
sessions.set(snapshot.asOf,snapshot);
const history={schemaVersion:1,sessions:[...sessions.values()].sort((a,b)=>a.asOf.localeCompare(b.asOf)).slice(-300)};
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(archiveFile+'.tmp',JSON.stringify(history,null,2)+'\n');
await fs.writeFile(output+'.tmp',JSON.stringify(snapshot,null,2)+'\n');
await fs.rename(archiveFile+'.tmp',archiveFile);
await fs.rename(output+'.tmp',output);
console.log(JSON.stringify({asOf:snapshot.asOf,rows:20,universe:universe.total,
  latestProviderQuoteDate:rows.map(row=>row.providerQuoteDate).sort().at(-1),
  rankingDateUsedForTurnover:true,...snapshot.collection}));
