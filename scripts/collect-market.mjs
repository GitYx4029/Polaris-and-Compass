// Run on GitHub Actions at 12:10 and 15:25 China time and at each deployment.
// Values are RMB 100 million (亿元). A failed source never becomes a zero.
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('public/data/market-snapshot.json');
const now = new Date();
const beijing = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
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
    if(yuan && yuan>(symbol==='sh510300'?1e7:1e10)){
      const amount=yuan/1e8, fromBar=amounts.get(date);
      if(fromBar && stamp.slice(8,12)>='1600' && Math.abs(amount/fromBar-1)>.005)
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
const etfUrl='https://push2delay.eastmoney.com/api/qt/clist/get';
async function eastmoney(url){
  const hosts=['push2delay.eastmoney.com','88.push2.eastmoney.com','push2.eastmoney.com'];
  const failures=[];
  for(const host of hosts){
    url.hostname=host;
    try{return JSON.parse(await get(url,{'Referer':'https://quote.eastmoney.com/'}));}
    catch(error){failures.push(`${host}: ${String(error)}`);}
  }
  throw new Error(failures.join(' | '));
}
async function etf(asOf){
  const size=200;
  const all=[];
  let expected=0;
  for(let page=1;page<=40;page++){
    const url=new URL(etfUrl);
    for(const [key,value] of Object.entries({pn:page,pz:size,po:1,np:1,
      ut:'bd1d9ddb04089700cf9c27f6f7426281',fltt:2,invt:2,fid:'f12',
      fs:'b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827',
      fields:'f6,f12,f13,f14,f124,f297'}))url.searchParams.set(key,String(value));
    const data=(await eastmoney(url)).data;
    if(!data||!Array.isArray(data.diff)||!Number.isInteger(data.total))throw new Error('ETF list missing total or rows');
    if(page===1)expected=data.total;
    if(data.total!==expected)throw new Error('ETF list count changed during pagination');
    all.push(...data.diff);
    if(all.length>=expected)break;
    await pause(160);
  }
  if(expected<100||all.length!==expected)throw new Error(`ETF incomplete: ${all.length}/${expected}`);
  const codes=new Set(), positiveDates=new Set();
  let yuan=0, active=0;
  for(const item of all){
    if(!/^\d{6}$/.test(String(item.f12))||![0,1].includes(Number(item.f13)))
      throw new Error('ETF security identifier invalid');
    const code=`${item.f13}.${item.f12}`;
    if(codes.has(code))throw new Error(`ETF duplicated security ${code}`);
    codes.add(code);
    if(item.f6==='-'||item.f6==null||Number(item.f6)===0)continue;
    const value=positive(item.f6);
    if(!value)throw new Error(`ETF invalid turnover ${code}`);
    const date=Number.isFinite(Number(item.f124))
      ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(item.f124)*1000))
      : String(item.f297??'').replace(/^(\d{4})(\d\d)(\d\d)$/,'$1-$2-$3');
    positiveDates.add(date);
    if(date!==asOf)throw new Error(`ETF ${code} turnover dated ${date}, expected ${asOf}`);
    yuan+=value;active++;
  }
  if(active<100||yuan<1e10||positiveDates.size!==1)throw new Error(`ETF active symbols ${active} insufficient`);
  return {amount:yuan/1e8,count:codes.size,active};
}

let prior={history:[]};
try{prior=JSON.parse(await fs.readFile(output,'utf8'));}catch{}
const [sh,sz,etf300Result]=await Promise.all([tencent('sh000001'),tencent('sz399001'),
  tencent('sh510300').then(value=>({value})).catch(error=>({error:String(error)}))]);
const etf300=etf300Result.value;
const dates=[...sh.amounts.keys()].filter(d=>sz.amounts.has(d)).sort();
const latest=dates.at(-1);
if(!latest||latest>beijing)throw new Error(`unexpected latest date ${latest}`);
const history=dates.map(date=>({date,sh:sh.amounts.get(date),sz:sz.amounts.get(date),
  etf510300:etf300?.amounts.get(date)??null}));
const old=new Map((prior.history??[]).map(x=>[x.date,x]));
for(const record of history){
  const previous=old.get(record.date)??{};
  // Keep verified historical specialty fields until the source is checked again.
  old.set(record.date,{...previous,...record,
    etf510300:record.etf510300??previous.etf510300??null});
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
  const value=await etf(specialDate);
  old.set(specialDate,{...old.get(specialDate),etf:value.amount,etfCount:value.count,etfActive:value.active,etfCheckedAt:now.toISOString()});
}catch(e){etfStatus=String(e);console.warn(etfStatus)}
if(etfStatus){
  // Diagnostic probes for official exchange totals and Tencent's batch quote.
  for(const address of [
    'https://etf.sse.com.cn/xhtml/js/marketData.js?v=V3.1.0_20260312',
    'https://fund.szse.cn/marketdata/fundsmarket/index.html',
    'https://qt.gtimg.cn/q=sh510300,sz159919'
  ]){
    try{
      const data=await get(new URL(address));
      const indicators=[...data.matchAll(/.{0,120}(?:CATALOGID|sqlId|SHOWTYPE|基金成交概况|ETF).{0,180}/gi)].slice(0,4).map(x=>x[0]);
      console.info('etf-fallback-diagnostic',new URL(address).hostname,data.length,JSON.stringify(indicators));
    }catch(error){console.info('etf-fallback-diagnostic',new URL(address).hostname,String(error));}
  }
}
const payload={asOf:latestDate,generatedAt:now.toISOString(),
  source:'腾讯财经 / 上海证券交易所 / 东方财富 ETF 行情',
  status:{star:starStatus,etf:etfStatus},
  history:[...old.values()].filter(x=>x.date<=latestDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-300)};
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({asOf:latestDate,sh:sh.amounts.get(latestDate),sz:sz.amounts.get(latestDate),
  etf510300:etf300?.amounts.get(latestDate),etf300Status:etf300Result.error,
  star:old.get(latestDate)?.star,
  etf:old.get(latestDate)?.etf,etfCount:old.get(latestDate)?.etfCount,
  starStatus,etfStatus}));
