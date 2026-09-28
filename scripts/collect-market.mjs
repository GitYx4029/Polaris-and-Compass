// Run on GitHub Actions at 12:10 and 15:25 China time and at each deployment.
// Values are RMB 100 million (亿元). A failed source never becomes a zero.
import fs from 'node:fs/promises';
import path from 'node:path';
import {alignedQuoteDates,unchangedClosedSession} from './market-session.mjs';

const output = path.resolve('public/data/market-snapshot.json');
const now = new Date();
const beijing = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const beijingClock=new Date(now.getTime()+8*3600_000).toISOString().slice(11,16);
const headers = {'User-Agent':'Mozilla/5.0 (compatible; Polaris-and-Compass/1.0)', 'Accept':'*/*'};
async function get(url, extra={}) {
  const response = await fetch(url,{headers:{...headers,...extra},signal:AbortSignal.timeout(16000)});
  if(!response.ok) throw new Error(`${url.hostname}: HTTP ${response.status}`);
  return response.text();
}
const positive = v => Number.isFinite(Number(v)) && Number(v)>0 ? Number(v) : null;
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function tencent(symbol) {
  const url = new URL('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get');
  url.searchParams.set('_var','kline_'+symbol);
  url.searchParams.set('param',`${symbol},day,,,300,qfq`);
  const raw = await get(url);
  const body = JSON.parse(raw.slice(raw.indexOf('={')+1).replace(/;\s*$/,''));
  const data = body.data?.[symbol];
  const bars = data?.day ?? data?.qfqday;
  if(!Array.isArray(bars)||bars.length<20)throw new Error(`${symbol}: daily bars unavailable`);
  const amounts = new Map();
  for(const bar of bars){
    if(!/^\d{4}-\d\d-\d\d$/.test(bar?.[0]??''))continue;
    const amount=positive(bar[8]);
    if(amount && amount>(symbol==='sh510300'?1e3:1e6) && amount<1e10) amounts.set(bar[0],amount/1e4);
  }
  const quote = data?.qt?.[symbol];
  const stamp = Array.isArray(quote)?quote[30]:null;
  if(/^\d{14}$/.test(stamp??'')){
    const date=`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}`;
    const yuan=positive(String(quote[35]??'').split('/')[2]);
    if(yuan && yuan>(symbol==='sh510300'?1e7:1e10) && yuan<1e14){
      const amount=yuan/1e8, fromBar=amounts.get(date);
      const closeCheck=stamp.slice(8,12)>='1600'||
        (date===beijing&&beijingClock>='15:25'&&stamp.slice(8,12)>='1500');
      if(fromBar && closeCheck && Math.abs(amount/fromBar-1)>.005)
        throw new Error(`${symbol}: quote/bar mismatch`);
      amounts.set(date,amount);
    }
  }
  if(amounts.size<20)throw new Error(`${symbol}: too few valid daily amounts`);
  return {amounts,quoteAt:stamp};
}
async function star(date){
  const url=new URL('https://query.sse.com.cn/commonQuery.do');
  url.searchParams.set('sqlId','COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C');
  url.searchParams.set('PRODUCT_CODE','01,02,03,11,17');
  url.searchParams.set('type','inParams');
  url.searchParams.set('SEARCH_DATE',date);
  let raw;
  try {raw=await get(url,{'Referer':'https://www.sse.com.cn/'});}
  catch(first){
    // Exchange also serves the same public query below /sseQuery/.
    url.pathname='/sseQuery/commonQuery.do';
    try {raw=await get(url,{'Referer':'https://www.sse.com.cn/'});}
    catch(second){throw new Error(`SSE endpoints unavailable: ${first}; ${second}`);}
  }
  const data=JSON.parse(raw);
  if(!Array.isArray(data.result)||data.result.length<3)throw new Error(`SSE ${date}: no daily breakdown`);
  const rows=data.result;
  const main=Object.values(rows[0]), kcb=Object.values(rows[2]);
  const stamp=String(main[8]??'').replace(/[^\d]/g,'').slice(0,8);
  if(stamp!==date.replaceAll('-','')) throw new Error(`SSE ${date}: reported ${stamp}`);
  const amount=positive(kcb[4]);
  if(!amount||amount>=10000) throw new Error(`SSE ${date}: invalid STAR amount`);
  // Official stock total, if present, must reconcile to A, B and STAR.
  if(rows.length>=5){
    const all=positive(Object.values(rows[4])[4]);
    const a=positive(main[4]),b=positive(Object.values(rows[1])[4]);
    if(all&&a&&b&&Math.abs(all-a-b-amount)>Math.max(1,all*.001))
      throw new Error(`SSE ${date}: categories do not reconcile`);
  }
  return amount;
}
// Exchange code ranges: Shanghai listed ETF secondary-market codes end in 0;
// Shenzhen assigns both 158000-158999 and 159000-159999 to ETFs. Query the
// whole ranges, then retain securities that Tencent identifies as ETF.
async function etfTencent(asOf, etf300){
  const symbols=[];
  for(let code=500000;code<600000;code+=10)symbols.push(`sh${code}`);
  for(let code=158000;code<160000;code++)symbols.push(`sz${code}`);
  const groups=[];
  for(let i=0;i<symbols.length;i+=80)groups.push(symbols.slice(i,i+80));
  let next=0, queried=0, shYuan10k=0, szYuan10k=0, listed=0, active=0;
  const seen=new Set();
  async function worker(){
    while(next<groups.length){
      const group=groups[next++];
      // Put a known liquid ETF last to detect truncation of long quote batches.
      const request=group.includes('sh510300')?group:[...group,'sh510300'];
      const url=new URL('https://qt.gtimg.cn/');
      url.searchParams.set('q',request.join(','));
      let raw;
      try{raw=await get(url);}catch{await pause(250);raw=await get(url);}
      const assignments=[...raw.matchAll(/v_(sh|sz)(\d{6})="([^"]*)";/g)];
      if(!assignments.some(item=>item[1]+item[2]==='sh510300'))
        throw new Error(`Tencent ETF batch truncated; ${assignments.length}/${request.length} quoted`);
      queried+=group.length;
      for(const item of assignments){
        const symbol=item[1]+item[2], fields=item[3].split('~');
        if(symbol==='sh510300'&&!group.includes(symbol))continue;
        if(!group.includes(symbol)||seen.has(symbol))throw new Error(`Tencent ETF duplicate or unexpected ${symbol}`);
        seen.add(symbol);
        if(fields[61]!=='ETF')continue;
        if(fields[2]!==item[2])throw new Error(`Tencent ETF code mismatch ${symbol}`);
        listed++;
        const date=String(fields[30]??'').replace(/^(\d{4})(\d\d)(\d\d).*$/,'$1-$2-$3');
        if(date!==asOf)continue; // Suspended funds have no turnover on this day.
        const amount=Number(fields[57]); // RMB 10,000 (万元)
        if(!Number.isFinite(amount)||amount<0)throw new Error(`Tencent ETF amount malformed ${symbol}`);
        if(amount===0)continue;
        if(item[1]==='sh')shYuan10k+=amount;else szYuan10k+=amount;
        active++;
      }
    }
  }
  await Promise.all(Array.from({length:12},()=>worker()));
  if(queried!==symbols.length||listed<500||active<300)throw new Error(`Tencent ETF coverage ${queried}/${symbols.length}, ETF ${listed}, active ${active}`);
  const sh=shYuan10k/1e4,sz=szYuan10k/1e4;
  if(sh<100||sz<100||sh+sz<(etf300??0))throw new Error(`Tencent ETF totals invalid: SH ${sh}, SZ ${sz}`);
  if(asOf==='2026-09-24'&&Math.abs(sh-3777.45)>5)
    throw new Error(`Tencent ETF SSE cross-check differs: ${sh.toFixed(2)} vs 3777.45`);
  return {amount:sh+sz,sh,sz,count:listed,active,source:'腾讯财经全代码段报价'};
}
let prior={history:[]};
try{prior=JSON.parse(await fs.readFile(output,'utf8'));}catch{}
const [sh,sz]=await Promise.all([tencent('sh000001'),tencent('sz399001')]);
const dates=[...sh.amounts.keys()].filter(d=>sz.amounts.has(d)).sort();
const latest=dates.at(-1);
if(!latest||latest>beijing)throw new Error(`unexpected latest date ${latest}`);
// A new publish or a holiday should not spend another full ETF scan on the
// same, already verified closing session or make old data appear newly checked.
if(unchangedClosedSession(latest,beijing,prior,sh.amounts.get(latest),sz.amounts.get(latest))){
  console.log(JSON.stringify({asOf:latest,unchanged:true,reason:'no new trading session'}));
  process.exit(0);
}
// On a trading day, the two independent market quotes must cover the same
// session. Missing or lagged quotes leave the last verified snapshot intact.
if(latest===beijing&&!alignedQuoteDates(latest,sh.quoteAt,sz.quoteAt))
  throw new Error(`market quote dates disagree with ${latest}: ${sh.quoteAt}, ${sz.quoteAt}`);
const etf300Result=await tencent('sh510300').then(value=>({value})).catch(error=>({error:String(error)}));
const etf300=etf300Result.value;
const history=dates.map(date=>({date,sh:sh.amounts.get(date),sz:sz.amounts.get(date),
  etf510300:etf300?.amounts.get(date)??null}));
const old=new Map((prior.history??[]).map(x=>[x.date,x]));
for(const record of history){
  const previous=old.get(record.date)??{};
  // Keep verified historical specialty fields until the source is checked again.
  old.set(record.date,{...previous,...record,
    etf510300:record.etf510300??previous.etf510300??null});
}
// One-time historical backfill from dated ETF market reports. Keep each
// report URL beside its number; never replace a live, fully scanned record.
const archive=JSON.parse(await fs.readFile(path.resolve('data/etf-archive.json'),'utf8'));
for(const item of archive){
  const row=old.get(item.date);
  if(!row||row.etf!=null)continue;
  if(!/^\d{4}-\d\d-\d\d$/.test(item.date)||!positive(item.etf)||
    !/^https:\/\/www\.caiwennews\.com\/article\/\d+\.shtml$/.test(item.etfReferenceUrl))
    throw new Error(`ETF historical citation invalid: ${item.date}`);
  old.set(item.date,{...row,etf:item.etf,etfSource:'财闻 ETF 日报（历史补录）',
    etfReferenceUrl:item.etfReferenceUrl,etfCheckedAt:now.toISOString()});
}
const latestDate=history.at(-1).date;
const specialDate=latestDate;
let starStatus=null,etfStatus=null;
try{
  const amount=await star(specialDate);
  old.set(specialDate,{...old.get(specialDate),star:amount,starCheckedAt:now.toISOString()});
  // Backfill the recent trend once; subsequent runs only retrieve new dates.
  const backfill=dates.slice(-20,-1).filter(date=>!old.get(date)?.star);
  for(let i=0;i<backfill.length;i+=4){
    const batch=await Promise.allSettled(backfill.slice(i,i+4).map(async date=>({date,amount:await star(date)})));
    for(const value of batch)if(value.status==='fulfilled'){
      const {date,amount}=value.value;
      old.set(date,{...old.get(date),star:amount,starCheckedAt:now.toISOString()});
    }
  }
}catch(e){starStatus=String(e);console.warn(starStatus)}
try{
  // One stable universe throughout a trading day. Switching providers changed
  // the fund count and made cumulative turnover appear to fall intraday.
  const value=await etfTencent(specialDate,etf300?.amounts.get(specialDate));
  const previous=prior.history?.find(row=>row.date===specialDate);
  if(previous?.etfSource===value.source&&previous.etf!=null&&value.amount<previous.etf*.985)
    throw new Error(`ETF cumulative fell within same source: ${previous.etf.toFixed(2)} to ${value.amount.toFixed(2)}`);
  old.set(specialDate,{...old.get(specialDate),etf:value.amount,etfSh:value.sh,etfSz:value.sz,
    etfCount:value.count,etfActive:value.active,etfSource:value.source,etfCheckedAt:now.toISOString()});
}catch(e){
  // Do not carry a stale or differently scoped intraday ETF sum forward.
  old.set(specialDate,{...old.get(specialDate),etf:undefined,etfSh:undefined,etfSz:undefined,
    etfCount:undefined,etfActive:undefined,etfSource:undefined,etfCheckedAt:undefined});
  etfStatus=String(e);console.warn(etfStatus);
}
const payload={asOf:latestDate,generatedAt:now.toISOString(),
  quoteAt:[sh.quoteAt,sz.quoteAt].map(stamp=>/^\d{14}$/.test(stamp??'')
    ?`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}`:null),
  source:`腾讯财经 / 上海证券交易所 / ${old.get(latestDate)?.etfSource??'ETF 待核实'}`,
  status:{star:starStatus,etf:etfStatus},
  history:[...old.values()].filter(x=>x.date<=latestDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-300)};
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({asOf:latestDate,sh:sh.amounts.get(latestDate),sz:sz.amounts.get(latestDate),
  etf510300:etf300?.amounts.get(latestDate),etf300Status:etf300Result.error,
  star:old.get(latestDate)?.star,
  etf:old.get(latestDate)?.etf,etfSh:old.get(latestDate)?.etfSh,etfSz:old.get(latestDate)?.etfSz,
  etfCount:old.get(latestDate)?.etfCount,etfSource:old.get(latestDate)?.etfSource,
  starStatus,etfStatus}));
