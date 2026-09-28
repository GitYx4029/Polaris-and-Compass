// Manual live check: compare backup quote aggregation with a verified SSE close.
// Never writes to the snapshot and never runs on page publication.
import fs from 'node:fs/promises';
import {starFallback} from './star-fallback.mjs';

const snapshot=JSON.parse(await fs.readFile('public/data/market-snapshot.json','utf8'));
const latest=snapshot.history.at(-1);
if(!latest?.star||latest.starSource!=='上海证券交易所分类成交')
  throw new Error('An official close is required for a live backup comparison');
async function get(url){
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'*/*'},signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw new Error(`${url.hostname} HTTP ${response.status}`);
  return response.text();
}
const candidate=await starFallback(latest.date,latest.sh,get);
const difference=Math.abs(candidate.amount-latest.star);
if(difference>Math.max(3,latest.star*.0075))
  throw new Error(`Backup/official mismatch: ${candidate.amount.toFixed(2)} vs ${latest.star.toFixed(2)} 亿元`);
console.log(JSON.stringify({date:latest.date,officialYi:latest.star,backupYi:Number(candidate.amount.toFixed(4)),
  differenceYi:Number(difference.toFixed(4)),source:candidate.source,stocks:candidate.count,active:candidate.active}));
