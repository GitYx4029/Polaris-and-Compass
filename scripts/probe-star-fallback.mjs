// Manual live check: compare backup quote aggregation with a verified SSE close.
// Never writes to the snapshot and never runs on page publication.
import fs from 'node:fs/promises';
import {starFallback} from './star-fallback.mjs';

const snapshot=JSON.parse(await fs.readFile('public/data/market-snapshot.json','utf8'));
const latest=snapshot.history.at(-1);
if(!latest?.star||latest.starSource!=='上海证券交易所分类成交')
  throw new Error('An official close is required for a live backup comparison');
async function get(url){
  let response;
  try{response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'*/*'},signal:AbortSignal.timeout(16000)});}
  catch(error){throw new Error(`${url.hostname} ${error.cause?.code??error.name}: ${error.cause?.message??error.message}`)}
  if(!response.ok)throw new Error(`${url.hostname} HTTP ${response.status}`);
  return response.text();
}
let candidate;
try{candidate=await starFallback(latest.date,latest.sh,get)}
catch(error){
  console.error(String(error));
  const endpoints=['https://proxy.finance.qq.com/','https://qt.gtimg.cn/','https://push2.eastmoney.com/','https://82.push2.eastmoney.com/','https://query.sse.com.cn/'];
  const results=await Promise.allSettled(endpoints.map(async url=>{
    try{const response=await fetch(url,{signal:AbortSignal.timeout(6000)});return `${new URL(url).hostname}: HTTP ${response.status}`}
    catch(e){return `${new URL(url).hostname}: ${e.cause?.code??e.name}: ${e.cause?.message??e.message}`}
  }));
  for(const result of results)console.log(result.status==='fulfilled'?result.value:String(result.reason));
  throw error;
}
const difference=Math.abs(candidate.amount-latest.star);
if(difference>Math.max(3,latest.star*.0075))
  throw new Error(`Backup/official mismatch: ${candidate.amount.toFixed(2)} vs ${latest.star.toFixed(2)} 亿元`);
console.log(JSON.stringify({date:latest.date,officialYi:latest.star,backupYi:Number(candidate.amount.toFixed(4)),
  differenceYi:Number(difference.toFixed(4)),source:candidate.source,stocks:candidate.count,active:candidate.active}));
