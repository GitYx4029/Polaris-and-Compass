// Independent, deterministic gate for a generated market snapshot.
// Runs after collection, before either the archive is committed or Pages built.
import fs from 'node:fs/promises';

const file=process.argv[2]??'public/data/market-snapshot.json';
const snapshot=JSON.parse(await fs.readFile(file,'utf8'));
const archive=JSON.parse(await fs.readFile('data/etf-archive.json','utf8'));
function check(condition,message){if(!condition)throw new Error(`market verification: ${message}`)}
const date=/^\d{4}-\d{2}-\d{2}$/;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
check(Array.isArray(snapshot.history)&&snapshot.history.length>=20,'missing 20 sessions');
check(date.test(snapshot.asOf??'')&&snapshot.history.at(-1)?.date===snapshot.asOf,'snapshot date');
check(Number.isFinite(Date.parse(snapshot.generatedAt)),'verification timestamp');
let previous='';
for(const row of snapshot.history){
  check(date.test(row.date??'')&&row.date>previous&&row.date<=snapshot.asOf,`date order at ${row.date}`);
  check(positive(row.sh)&&positive(row.sz)&&row.sh<1e6&&row.sz<1e6,`market values at ${row.date}`);
  if(row.star!=null)check(positive(row.star)&&row.star<=row.sh,`STAR/Shanghai relationship at ${row.date}`);
  if(row.etf!=null){
    check(positive(row.etf),`ETF amount at ${row.date}`);
    if(row.etfSh!=null||row.etfSz!=null)
      check(positive(row.etfSh)&&positive(row.etfSz)&&Math.abs(row.etf-row.etfSh-row.etfSz)<.02,
        `ETF exchange reconciliation at ${row.date}`);
    if(row.etf510300!=null)check(positive(row.etf510300)&&row.etf510300<=row.etf,`510300 inclusion at ${row.date}`);
  }
  previous=row.date;
}
if(Array.isArray(snapshot.quoteAt))for(const stamp of snapshot.quoteAt){
  if(stamp!=null)check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)&&stamp.slice(0,10)===snapshot.asOf,
    `quote date at ${stamp}`);
}
const byDate=new Map(snapshot.history.map(row=>[row.date,row]));
for(const item of archive){
  const row=byDate.get(item.date);
  check(row&&positive(row.etf),`archive point ${item.date}`);
  if(row.etfSource==='财闻 ETF 日报（历史补录）')
    check(Math.abs(row.etf-item.etf)<.0001&&row.etfReferenceUrl===item.etfReferenceUrl,
      `archive amount/citation at ${item.date}`);
}
const latest=snapshot.history.at(-1);
if(latest.etf!=null)check(latest.etfSource==='腾讯财经全代码段报价',
  'latest ETF source must use the same fund universe');
const last20=snapshot.history.slice(-20);
const total=latest.sh+latest.sz;
const rolling=last20.reduce((sum,row)=>sum+row.sh+row.sz,0);
check(positive(rolling)&&positive(total)&&Number.isFinite(total/(rolling/20)),'rolling/temperature');
console.log(JSON.stringify({verified:true,asOf:snapshot.asOf,sessions:snapshot.history.length,
  turnoverYi:Number(total.toFixed(4)),rolling20Yi:Number(rolling.toFixed(4)),
  temperature:Number((total/(rolling/20)).toFixed(6)),etf:latest.etf??null,star:latest.star??null}));
