"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, Download, RefreshCw, Share2, X } from "lucide-react";
import { composeDays, parseTencent, type Day, type MarketRow } from "@/lib/market";
import { investorQuotes, quoteIndexAt } from "@/lib/investorQuotes";
import { isCloseConfirmed, nextScheduledRefresh } from "@/lib/refreshSchedule";
import { saveQuotePng, type ShareDatum } from "@/lib/quoteImage";
import { recoverBrowserDetail, type RecoveredDetail } from "@/lib/browserDetail";
import EtfFlows from "./EtfFlows";

type Detail = { date:string;sh:number;sz:number;star?:number;starCheckedAt?:string;starSource?:string;starCount?:number;starActive?:number;etf?:number;etfSh?:number;etfSz?:number;etfCount?:number;etfActive?:number;etfSource?:string;etfCheckedAt?:string;etfReferenceUrl?:string;etf510300?:number|null };
type Snapshot = { asOf:string;generatedAt:string;history:Detail[];quoteAt?:[string|null,string|null];status?:{star?:string|null;etf?:string|null};clientRecoveredAt?:string };
type Result = { days: Day[]; quoteAt: (string|null)[]; source: string; checkedAt: string;
  snapshot:Snapshot|null; etf300:Map<string,number>|null };
const wan = (yi: number) => (yi/10000).toFixed(2);
const yi = (value:number) => value.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const tiers = [
  { text: "＜ 1.3", name: "量化和小散", note:"按原规则，不以此区间作为赚钱目标" },
  { text: "1.3—1.5", name: "救市和托", note:"观察防止市场继续下坠的支撑" },
  { text: "1.5—1.8", name: "小散开始有增量资金", note:"观察散户增量资金是否进场" },
  { text: "1.8—2.0", name: "单一板块行情", note:"观察行情是否集中于单一板块" },
  { text: "≥ 2.0", name: "多板块行情", note:"观察是否出现多个板块的行情" }
];
const tier = (v: number) => v < 1.3 ? 0 : v < 1.5 ? 1 : v < 1.8 ? 2 : v < 2 ? 3 : 4;
function relativeMark(current?:number|null,previous?:number|null,comparable=true):string|null {
  if(!comparable||current==null||previous==null||current<=0||previous<=0)return null;
  const change=(current/previous-1)*100;
  return Math.abs(change)<.05?"较前交易日持平":`较前交易日 ${change>0?"+":""}${change.toFixed(1)}%`;
}
function rollingMark(value?:number):string|null {
  if(value===undefined)return null;
  const wanValue=value/10000;
  return wanValue>=55&&wanValue<=60?"北极星参考 · 利润开始撤走":
    wanValue>=110&&wanValue<=115?"北极星参考 · 全部撤走":null;
}
function heatMark(value?:number):string|null {
  if(value===undefined)return null;
  const percent=value*100;
  return percent<85?"温度参考 · 地量":percent<=105?"温度参考 · 正常":
    percent>110&&percent<140?"温度参考 · 过热":percent>=140?"温度参考 · 太热":null;
}
const historyUrl = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";

// Tencent provides a JavaScript assignment (_var=...), so the browser can read
// it directly if the site server cannot connect to the provider.
function browserKline(symbol: "sh000001"|"sz399001"|"sh510300") {
  return new Promise<ReturnType<typeof parseTencent>>((resolve,reject)=>{
    const key=`ashare_${symbol}_${Date.now()}`;
    const url=new URL(historyUrl);
    url.searchParams.set("_var",key);
    url.searchParams.set("param",`${symbol},day,,,300,qfq`);
    const script=document.createElement("script");
    const scope=window as unknown as Record<string,unknown>;
    let done=false;
    const finish=(error?:Error)=>{
      if(done)return; done=true;
      clearTimeout(timer); script.remove();
      const data=scope[key]; delete scope[key];
      if(error) reject(error);
      else {try {resolve(parseTencent(data,symbol));}catch(e){reject(e);}}
    };
    const timer=setTimeout(()=>finish(new Error(`${symbol} 行情连接超时`)),10000);
    script.onload=()=>finish();
    script.onerror=()=>finish(new Error(`${symbol} 行情网络不可达`));
    script.src=url.toString(); script.async=true; document.head.appendChild(script);
  });
}

const snapshotRemote="https://gityx4029.github.io/Polaris-and-Compass/data/market-snapshot.json";
async function fetchSnapshot():Promise<Snapshot|null>{
  const path=window.location.hostname.endsWith(".github.io")
    ? "/Polaris-and-Compass/data/market-snapshot.json":"/api/snapshot";
  const read=async(url:string)=>{
    const response=await fetch(`${url}?t=${Date.now()}`,{cache:"no-store",signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`快照 ${response.status}`);
    const value=await response.json() as Snapshot;
    if(!Array.isArray(value.history)||value.history.length<20||!/^\d{4}-\d\d-\d\d$/.test(value.asOf))throw new Error("快照格式异常");
    const latest=value.history.at(-1);
    const todayChina=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
    if(latest?.date!==value.asOf||value.asOf>todayChina||!Number.isFinite(latest.sh)||latest.sh<=0||!Number.isFinite(latest.sz)||latest.sz<=0)throw new Error("快照交易日不一致");
    return value;
  };
  try{return await read(path)}
  catch {if(path!=="/api/snapshot")return null;try{return await read(snapshotRemote)}catch{return null}}
}

function resultFromSnapshot(snapshot:Snapshot):Result {
  const days=composeDays(snapshot.history.map(({date,sh,sz})=>({date,sh,sz})));
  if(days.length<20||days.at(-1)?.date!==snapshot.asOf)throw new Error("核验快照缺少完整交易日");
  return {days,quoteAt:snapshot.quoteAt??[null,null],source:"定时核验快照（腾讯历史行情）",
    checkedAt:new Date().toISOString(),snapshot,etf300:null};
}

async function fetchLiveRows():Promise<{rows:MarketRow[];quoteAt:(string|null)[];source:string}>{
  let rows:MarketRow[], quoteAt:(string|null)[], source:string;
  try {
    // GitHub Pages is static; use Tencent's browser script response there.
    if(window.location.hostname.endsWith(".github.io"))throw new Error("static-host");
    const response=await fetch("/api/market",{cache:"no-store"});
    if(!response.ok)throw new Error(`服务端 ${response.status}`);
    const data=await response.json() as {rows:MarketRow[];quoteAt:(string|null)[];source:string};
    rows=data.rows; quoteAt=data.quoteAt; source=data.source;
  } catch {
    const [sh,sz]=await Promise.all([browserKline("sh000001"),browserKline("sz399001")]);
    rows=[...new Set([...sh.amounts.keys(),...sz.amounts.keys()])].sort().map(date=>({
      date,sh:sh.amounts.get(date)??null,sz:sz.amounts.get(date)??null
    }));
    quoteAt=[sh.quoteAt,sz.quoteAt]; source="腾讯行情（浏览器直连）";
  }
  return {rows,quoteAt,source};
}

async function loadMarket(onSnapshot:(interim:Result)=>void):Promise<Result> {
  // Start the verified snapshot and live quote at the same time. The snapshot
  // can render first when an upstream provider is slow or temporarily blocked.
  const snapshotPromise=fetchSnapshot().then(snapshot=>{
    if(snapshot){try{onSnapshot(resultFromSnapshot(snapshot))}catch{}}
    return snapshot;
  });
  const livePromise=fetchLiveRows().then(value=>({value,error:null})).catch(error=>({value:null,error}));
  const [{value:live,error},snapshot]=await Promise.all([livePromise,snapshotPromise]);
  if(!live){if(snapshot)return resultFromSnapshot(snapshot);throw error??new Error("行情与快照均不可用")}
  const {rows,quoteAt,source}=live;
  const days=composeDays(rows);
  const todayChina=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  if(days.length<20||days.at(-1)!.date>todayChina){if(snapshot)return resultFromSnapshot(snapshot);throw new Error(`仅取得 ${days.length} 个完整交易日，无法核实近20日成交额。`)}
  if(snapshot&&snapshot.asOf>days.at(-1)!.date)return resultFromSnapshot(snapshot);
  // Verified past 510300 observations are already in the daily snapshot. Only
  // request its full K-line when today's session could be newer than the snapshot.
  const latestDate=days.at(-1)?.date;
  const snapshotHas300=snapshot?.history.some(item=>item.date===latestDate&&typeof item.etf510300==="number")??false;
  const etf300=latestDate===todayChina||!snapshotHas300
    ?await browserKline("sh510300").then(data=>data.amounts).catch(()=>null):null;
  return {days,quoteAt,source,checkedAt:new Date().toISOString(),snapshot,etf300};
}

function recoveryKey(date:string){return `ashare_verified_detail_${date}`}
function storageGet(key:string){try{return localStorage.getItem(key)}catch{return null}}
function storageSet(key:string,value:string){try{localStorage.setItem(key,value)}catch{/* Data still displays in this tab. */}}
function cachedRecovery(result:Result):RecoveredDetail|null {
  const day=result.days.at(-1);if(!day)return null;
  try{
    const value=JSON.parse(storageGet(recoveryKey(day.date))??'null') as RecoveredDetail|null;
    if(!value||value.date!==day.date||Math.abs(value.sh-day.sh)>.02||
      Math.abs(value.sz-day.sz)>.02||!Number.isFinite(Date.parse(value.checkedAt)))return null;
    if(value.star!==undefined&&(!Number.isFinite(value.star)||value.star<=0||value.star>=day.sh*.9))return null;
    if(value.etf!==undefined&&(!Number.isFinite(value.etf)||value.etf<=0||
      !value.etfSh||!value.etfSz||Math.abs(value.etf-value.etfSh-value.etfSz)>.02||
      !value.etfCount||value.etfCount<500))return null;
    return value.star!==undefined||value.etf!==undefined?value:null;
  }catch{return null}
}
function mergeRecovery(result:Result,recovered:RecoveredDetail):Result {
  const day=result.days.at(-1);
  if(!day||day.date!==recovered.date||Math.abs(day.sh-recovered.sh)>.02||
    Math.abs(day.sz-recovered.sz)>.02)return result;
  const base=result.snapshot;
  const previous=base?.history.find(row=>row.date===day.date);
  if(previous?.star!==undefined&&previous?.etf!==undefined)return result;
  const row:Detail={...previous,date:day.date,sh:day.sh,sz:day.sz,
    etf510300:result.etf300?.get(day.date)??previous?.etf510300??null};
  if(previous?.star===undefined&&recovered.star!==undefined)
    Object.assign(row,{star:recovered.star,starSource:recovered.starSource,
      starCount:recovered.starCount,starActive:recovered.starActive,starCheckedAt:recovered.starCheckedAt});
  if(previous?.etf===undefined&&recovered.etf!==undefined)
    Object.assign(row,{etf:recovered.etf,etfSh:recovered.etfSh,etfSz:recovered.etfSz,
      etfCount:recovered.etfCount,etfActive:recovered.etfActive,
      etfSource:recovered.etfSource,etfCheckedAt:recovered.etfCheckedAt});
  const history=[...(base?.history??[]).filter(item=>item.date!==day.date),row]
    .sort((a,b)=>a.date.localeCompare(b.date)).slice(-300);
  return {...result,snapshot:{...base,asOf:day.date,history,generatedAt:recovered.checkedAt,
    clientRecoveredAt:recovered.checkedAt,quoteAt:result.quoteAt.slice(0,2) as [string|null,string|null]}};
}
function recoveryReady(result:Result):boolean {
  const date=result.days.at(-1)?.date,now=new Date(Date.now()+8*3600_000).toISOString();
  if(!date||date>now.slice(0,10)||now.slice(0,10)===date&&now.slice(11,16)<'15:25')return false;
  return result.quoteAt.length===2&&result.quoteAt.every(stamp=>
    !!stamp?.startsWith(date)&&stamp.slice(11)>='15:00');
}

function provisionalDate(result:Result):string|null {
  const latest=result.days.at(-1)?.date;
  const today=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  return latest===today&&!isCloseConfirmed(latest,result.quoteAt,Date.now())?latest:null;
}

function downloadHistory(result:Result,onlyDate?:string) {
  const detail=new Map(result.snapshot?.history.map(item=>[item.date,item])??[]);
  const provisional=provisionalDate(result);
  const header="交易日,上证市场成交额(亿元),深证市场成交额(亿元),沪深合计成交额(亿元),科创板成交额(亿元),沪深ETF成交额(亿元),沪市ETF成交额(亿元),深市ETF成交额(亿元),510300成交额(亿元),近20交易日累计成交额(亿元),近20交易日平均成交额(亿元),资金温度(倍),科创核对时间,科创来源,ETF核对时间,ETF来源,ETF核验链接,沪深行情来源,行情核对时间,数据阶段";
  const lines=result.days.filter(day=>!onlyDate||day.date===onlyDate).map(d=>{
    const extra=detail.get(d.date),etf300=result.etf300?.get(d.date)??extra?.etf510300;
    return [d.date,d.sh.toFixed(4),d.sz.toFixed(4),d.total.toFixed(4),
      extra?.star?.toFixed(4)??"",extra?.etf?.toFixed(4)??"",extra?.etfSh?.toFixed(4)??"",extra?.etfSz?.toFixed(4)??"",etf300?.toFixed(4)??"",
      d.date===provisional?"":d.roll20?.toFixed(4)??"",d.date===provisional?"":d.avg20?.toFixed(4)??"",d.date===provisional?"":d.heat?.toFixed(6)??"",
      extra?.starCheckedAt??"",extra?.starSource??"",extra?.etfCheckedAt??"",extra?.etfSource??"",extra?.etfReferenceUrl??"",result.source,result.checkedAt,d.date===provisional?"盘中暂计":"收盘/历史"].join(",");
  });
  const file=new Blob(["\ufeff",header,"\r\n",lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(file);
  const anchor=document.createElement("a"); anchor.href=url;
  anchor.download=onlyDate?`市场成交额_${onlyDate}.csv`:`市场成交额_${result.days[0].date}_${result.days.at(-1)!.date}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function downloadQuotes() {
  const field=(value:string|number)=>`"${String(value).replace(/"/g,'""')}"`;
  const rows=["序号,人物,观点摘述,表述方式,原始出处,出处位置,来源链接",
    ...investorQuotes.map(q=>[q.id,q.author,q.text,"依据原文意译或归纳",q.source,q.locator,q.url].map(field).join(","))];
  const blob=new Blob(["\ufeff",rows.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");anchor.href=url;anchor.download="投资观点摘录库.csv";
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function quoteShareText(quote:typeof investorQuotes[number]) {
  return `“${quote.text}”\n——${quote.author}\n出处：${quote.source} · ${quote.locator}\n${quote.url}\n据原文意译或归纳\npowered by C.Luo w/ChatGPT`;
}

function Chart({data}:{data:Day[]}) {
  const [hover,setHover]=useState<number|null>(null);
  const [picked,setPicked]=useState<number|null>(null);
  const pts=data.filter(d=>d.roll20!==undefined).slice(-45);
  if(pts.length<2)return <div className="chart-empty">凑齐 21 个完整交易日后绘制滚动趋势</div>;
  const w=900,h=230,p=30,values=pts.map(d=>d.roll20!/10000);
  const min=Math.floor((Math.min(...values)-2)/2)*2;
  const max=Math.ceil((Math.max(...values)+2)/2)*2;
  const x=(i:number)=>p+i*(w-p*2)/(pts.length-1);
  const y=(v:number)=>h-p-(v-min)*(h-p*2)/(max-min);
  const path=pts.map((d,i)=>`${i?"L":"M"}${x(i)},${y(d.roll20!/10000)}`).join(" ");
  const activeIndex=hover??Math.min(picked??pts.length-1,pts.length-1);
  const selected=pts[activeIndex];
  return <div className="line-frame"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="近20交易日累计成交额走势"
    onPointerMove={event=>{
      const rect=event.currentTarget.getBoundingClientRect();
      const px=(event.clientX-rect.left)/rect.width*w;
      setHover(Math.max(0,Math.min(pts.length-1,Math.round((px-p)*(pts.length-1)/(w-2*p)))));
    }} onPointerLeave={()=>setHover(null)}>
    {[55,60,110,115].filter(v=>v>min&&v<max).map(v=><g key={v}><line x1={p} x2={w-p} y1={y(v)} y2={y(v)} stroke="#477078" strokeDasharray="5 7"/><text x={w-p-4} y={y(v)-7} textAnchor="end" fill="#8aa5a7" fontSize="16">{v} 万亿</text></g>)}
    <path d={path} fill="none" stroke="#42c6b1" strokeWidth="3.5" vectorEffect="non-scaling-stroke"/>
    <line x1={x(activeIndex)} x2={x(activeIndex)} y1={p} y2={h-p} stroke="#91ddd0" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>
    {pts.map((d,i)=><circle key={d.date} cx={x(i)} cy={y(d.roll20!/10000)} r={i===activeIndex?"7":"4"} fill="#42c6b1"
      tabIndex={0} aria-label={`${d.date}，20日累计 ${(d.roll20!/10000).toFixed(4)} 万亿元`}
      onFocus={()=>setHover(i)} onBlur={()=>setHover(null)} onClick={()=>setPicked(i)}/>)}
  </svg>{(hover!==null||picked!==null)&&<div className={`chart-tooltip ${y(selected.roll20!/10000)<110?"below":"above"}`}
    style={{left:`clamp(120px, ${x(activeIndex)/w*100}%, calc(100% - 120px))`,top:`${y(selected.roll20!/10000)/h*210}px`}} role="status">
    <strong>{selected.date}</strong><div><span>20 日累计</span><b>{(selected.roll20!/10000).toFixed(4)} 万亿元</b></div>
    <div><span>20 日均量</span><b>{yi(selected.avg20!)} 亿元</b></div>
    <div><span>资金温度</span><b>{selected.heat!.toFixed(3)} 倍</b></div>
    <div><span>当日合计</span><b>{(selected.total/10000).toFixed(4)} 万亿元</b></div>
    <div><span>沪市 / 深市</span><b>{(selected.sh/10000).toFixed(4)} / {(selected.sz/10000).toFixed(4)} 万亿元</b></div>
  </div>}<div className="chart-axis"><span>{pts[0].date.slice(5)}</span><span>{pts.at(-1)!.date.slice(5)}</span></div>
  <label className="chart-scrubber"><span>拖动选择交易日</span><input type="range" min={0} max={pts.length-1} step={1} value={Math.min(picked??pts.length-1,pts.length-1)} style={{"--scrub-progress":`${(picked??pts.length-1)/(pts.length-1)*100}%`} as CSSProperties}
    onChange={event=>{setHover(null);setPicked(Number(event.currentTarget.value))}} aria-label="选择滚动累计交易日"/><strong>{selected.date}</strong></label>
  <p className="chart-readout">20 日累计 <b>{(selected.roll20!/10000).toFixed(4)} 万亿元</b> · 当日 <b>{(selected.total/10000).toFixed(4)} 万亿元</b> · 资金温度 <b>{(selected.heat!*100).toFixed(1)}%</b></p></div>;
}

const chartModes=[
  {key:"total",label:"沪深合计",unit:"万亿元",scale:10000},
  {key:"sh",label:"上证市场",unit:"亿元",scale:1},
  {key:"star",label:"科创板",unit:"亿元",scale:1},
  {key:"etf",label:"沪深 ETF",unit:"亿元",scale:1},
  {key:"etf510300",label:"510300 · 华泰柏瑞",unit:"亿元",scale:1},
  {key:"roll20",label:"20 日累计",unit:"万亿元",scale:10000},
  {key:"avg20",label:"20 日均量",unit:"亿元",scale:1}
] as const;
type ChartKey=typeof chartModes[number]["key"];
type MetricKey=ChartKey|"sz"|"heat"|"etfSh"|"etfSz";
const metricLabels:Record<MetricKey,string>={total:"沪深两市成交额",sh:"上证市场成交额",sz:"深证市场成交额",star:"科创板成交额",etf:"沪深 ETF 成交额",etfSh:"沪市 ETF 成交额",etfSz:"深市 ETF 成交额",etf510300:"510300 沪深300ETF华泰柏瑞 成交额",roll20:"近 20 日累计成交额",avg20:"20 日平均成交额",heat:"资金温度"};

function metricValue(result:Result,day:Day,key:MetricKey):number|undefined {
  const extra=result.snapshot?.history.find(item=>item.date===day.date);
  switch(key){
    case "star":return extra?.star;
    case "etf":return extra?.etf;
    case "etfSh":return extra?.etfSh;
    case "etfSz":return extra?.etfSz;
    case "etf510300":return result.etf300?.get(day.date)??extra?.etf510300??undefined;
    default:return day[key];
  }
}
function downloadMetric(result:Result,key:MetricKey){
  const field=(value:string|number)=>`"${String(value).replace(/"/g,'""')}"`;
  const lines=["交易日,指标,数值,单位,数据来源,核对时间(ISO 8601),核验链接,数据阶段"];
  const provisional=provisionalDate(result);
  for(const day of result.days){
    if(day.date===provisional&&["roll20","avg20","heat"].includes(key))continue;
    const value=metricValue(result,day,key);
    if(value===undefined||!Number.isFinite(value))continue;
    const extra=result.snapshot?.history.find(item=>item.date===day.date);
    const detail=key==="star"?extra?.starCheckedAt:key==="etf"||key==="etfSh"||key==="etfSz"?extra?.etfCheckedAt:undefined;
    const source=key==="star"?"上海证券交易所":key==="etf"||key==="etfSh"||key==="etfSz"?extra?.etfSource??"ETF 行情":key==="etf510300"?"腾讯财经·510300":result.source;
    lines.push([day.date,metricLabels[key],value.toFixed(key==="heat"?6:4),key==="heat"?"倍":"亿元",source,detail??result.checkedAt,key==="etf"||key==="etfSh"||key==="etfSz"?extra?.etfReferenceUrl??"":"",day.date===provisional?"盘中暂计":"收盘/历史"].map(field).join(","));
  }
  const url=URL.createObjectURL(new Blob(["\ufeff",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=`${metricLabels[key]}_${result.days.at(-1)?.date??"历史"}.csv`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function DataDownload({result,metric,iconOnly=false}:{result:Result|null;metric:MetricKey;iconOnly?:boolean}){
  const available=result?.days.some(day=>metricValue(result,day,metric)!==undefined)??false;
  return <button type="button" className={`data-export${iconOnly?" icon-only":""}`} aria-label={`下载${metricLabels[metric]}历史 CSV`}
    title={`下载${metricLabels[metric]}历史 CSV`} disabled={!available} onClick={()=>result&&downloadMetric(result,metric)}><Download size={14}/>{!iconOnly&&<span>下载 CSV</span>}</button>;
}
function HistoryTableHead({result}:{result:Result|null}){
  const columns:[MetricKey,string][]=[["sh","上证"],["sz","深证"],["total","沪深合计"],["star","科创板"],["etf","沪深 ETF"],["etf510300","510300"],["roll20","20 日累计"],["avg20","20 日平均"],["heat","资金温度"]];
  return <div className="table-row table-head"><span>交易日</span>{columns.map(([key,label])=><span className="head-metric" key={key}><span>{label}</span><DataDownload result={result} metric={key} iconOnly/></span>)}</div>;
}
function MobileHistory({days,result,provisional}:{days:Day[];result:Result|null;provisional:string|null}){
  return <div className="mobile-history" aria-label="近期交易日手机视图">{!days.length&&<div className="empty">正在核对交易日数据…</div>}{days.slice(-10).reverse().map(day=>{
    const extra=result?.snapshot?.history.find(item=>item.date===day.date);
    const single=result?.etf300?.get(day.date)??extra?.etf510300;
    const rows:[string,string,string][]=[
      ["上证市场",wan(day.sh),"万亿元"],["深证市场",wan(day.sz),"万亿元"],
      ["科创板",extra?.star!==undefined?yi(extra.star):"—","亿元"],
      ["沪深 ETF",extra?.etf!==undefined?yi(extra.etf):"—","亿元"],
      ["510300 沪深300ETF华泰柏瑞",single!=null?yi(single):"—","亿元"],
      ["20 日累计",day.date!==provisional&&day.roll20!==undefined?wan(day.roll20):"—","万亿元"],
      ["20 日平均",day.date!==provisional&&day.avg20!==undefined?yi(day.avg20):"—","亿元"],
      ["资金温度",day.date!==provisional&&day.heat!==undefined?(day.heat*100).toFixed(1):"—","%"]
    ];
    return <details className="day-card" key={day.date}><summary><span className="day-date">{day.date}</span><span className="day-total"><strong>{wan(day.total)} 万亿</strong><small>{day.date===provisional?"盘中暂计 · 温度待收盘":`资金温度 ${day.heat!==undefined?(day.heat*100).toFixed(1):"—"}%`}</small></span><span className="day-chevron">明细⌄</span></summary>
      <div className="day-detail-grid">{rows.map(([label,value,unit])=><div key={label}><span>{label}</span><b>{value} <small>{value==="—"?"":unit}</small></b></div>)}</div>
      <button className="download day-download" onClick={()=>result&&downloadHistory(result,day.date)} disabled={!result}><Download size={15}/>下载 {day.date} 数据</button>
    </details>;
  })}</div>;
}

function MarketChart({days,result,provisional}:{days:Day[];result:Result|null;provisional:string|null}) {
  const [mode,setMode]=useState<ChartKey>("total");
  const [hover,setHover]=useState<number|null>(null);
  const [picked,setPicked]=useState<number|null>(null);
  const detail=new Map(result?.snapshot?.history.map(item=>[item.date,item])??[]);
  const selectedMode=chartModes.find(item=>item.key===mode)!;
  const pts=days.filter(day=>!(day.date===provisional&&(mode==="roll20"||mode==="avg20"))).map(day=>{
    const extra=detail.get(day.date);
    const value=mode==="star"?extra?.star:mode==="etf"?extra?.etf
      :mode==="etf510300"?(result?.etf300?.get(day.date)??extra?.etf510300)
      :day[mode];
    return {date:day.date,value:typeof value==="number"&&value>0?value/selectedMode.scale:null,
      source:extra?.etfSource,url:extra?.etfReferenceUrl};
  }).filter((point):point is {date:string;value:number;source:string|undefined;url:string|undefined}=>point.value!==null).slice(-40);
  const w=900,h=190,p=26,values=pts.map(point=>point.value);
  const low=values.length?Math.min(...values):0, high=values.length?Math.max(...values):1;
  const min=Math.max(0,low-(high-low||high*.1)*.2),max=high+(high-low||high*.1)*.2;
  const x=(index:number)=>p+index*(w-p*2)/Math.max(1,pts.length-1);
  const y=(value:number)=>h-p-(value-min)/(max-min||1)*(h-p*2);
  const activeIndex=Math.min(hover??picked??pts.length-1,pts.length-1);
  const focus=pts.length?pts[activeIndex]:null;
  return <section className="panel multi-trend"><div className="panel-header"><div><p className="eyebrow">MARKET SERIES</p><h2>各层级成交额趋势</h2></div><div className="panel-actions"><span>选择指标 · 悬停查看数值</span><DataDownload result={result} metric={mode}/></div></div>
    <div className="chart-tabs" role="group" aria-label="趋势指标">{chartModes.map(item=><button
      key={item.key} className={mode===item.key?"active":""} aria-pressed={mode===item.key}
      onClick={()=>{setMode(item.key);setHover(null);setPicked(null)}}>{item.label}</button>)}</div>
    {pts.length<2?<div className="chart-empty">{pts.length===1?`${pts[0].date}：${pts[0].value.toFixed(2)} ${selectedMode.unit}；等待下一交易日以绘制趋势`:"该指标的已核实历史数据暂不足两日"}</div>
    :<div className="line-frame extra-chart"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${selectedMode.label}历史成交额趋势`}
      onPointerMove={event=>{const rect=event.currentTarget.getBoundingClientRect();const px=(event.clientX-rect.left)/rect.width*w;
        setHover(Math.max(0,Math.min(pts.length-1,Math.round((px-p)*(pts.length-1)/(w-p*2)))));}}
      onPointerLeave={()=>setHover(null)}>
      {[0,1,2].map(i=><g key={i}><line x1={p} x2={w-p} y1={p+i*(h-2*p)/2} y2={p+i*(h-2*p)/2} stroke="#38565a" strokeDasharray="4 6"/><text x={w-p} y={p+i*(h-2*p)/2-5} textAnchor="end" fill="#abc6c1" fontSize="14">{(max-i*(max-min)/2).toFixed(2)}</text></g>)}
      <path d={pts.map((point,index)=>`${index?"L":"M"}${x(index)},${y(point.value)}`).join(" ")} fill="none" stroke="#62d4bd" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
      {focus&&<circle cx={x(activeIndex)} cy={y(focus.value)} r="7" fill="#d5fff0"/>}
    </svg>{focus&&hover!==null&&<div className="chart-tooltip" style={{left:`clamp(110px,${x(activeIndex)/w*100}%,calc(100% - 110px))`,top:`${y(focus.value)/h*170}px`,transform:"translate(-50%,-105%)"}} role="status"><strong>{focus.date}</strong><div><span>{selectedMode.label}</span><b>{focus.value.toFixed(4)} {selectedMode.unit}</b></div></div>}
    <div className="chart-axis"><span>{pts[0].date.slice(5)}</span><span>{pts.at(-1)!.date.slice(5)}</span></div>
    <label className="chart-scrubber"><span>拖动选择交易日</span><input type="range" min={0} max={pts.length-1} step={1} value={activeIndex} style={{"--scrub-progress":`${activeIndex/(pts.length-1)*100}%`} as CSSProperties}
      onChange={event=>{setHover(null);setPicked(Number(event.currentTarget.value))}} aria-label={`选择${selectedMode.label}趋势交易日`}/><strong>{focus?.date}</strong></label>
    {focus&&<p className="chart-readout">{selectedMode.label} <b>{focus.value.toFixed(4)} {selectedMode.unit}</b>{focus.source&&` · ${focus.source}`}</p>}</div>}
    {mode==="etf"&&pts.some(point=>point.url)&&<details className="chart-sources"><summary>查看 ETF 历史补录来源（{pts.filter(point=>point.url).length} 个交易日）</summary>
      <div>{pts.filter(point=>point.url).map(point=><a key={point.date} href={point.url} target="_blank" rel="noreferrer">{point.date} · 财闻日报 · {point.value.toFixed(2)} 亿元</a>)}</div></details>}
    {mode==="etf"&&focus?.url&&<p className="fine">{focus.date} 为历史报道补录：<a href={focus.url} target="_blank" rel="noreferrer">查看财闻 ETF 日报</a>。与定时采集记录分开标注来源。</p>}
    <p className="fine">{provisional&&"最新交易日的日成交额曲线为盘中暂计；20 日累计和均量曲线只展示完整交易日。"}科创板和 ETF 的历史值从已核实记录逐日积累；ETF 早期补录值单独标明来源。单只 ETF 包含在 ETF 总额中，科创板包含在沪市内，请勿横向相加。</p>
  </section>;
}

export default function Home() {
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [dailyQuoteIndex,setDailyQuoteIndex]=useState(0);
  const [shareOpen,setShareOpen]=useState(false);
  const [shareFeedback,setShareFeedback]=useState("");
  const [detailStatus,setDetailStatus]=useState("");
  const shareDialog=useRef<HTMLElement>(null);
  const requestId=useRef(0);
  const inFlight=useRef(false);
  const refresh=useCallback(async()=>{
    if(inFlight.current)return;
    inFlight.current=true;
    const id=++requestId.current;
    setLoading(true);setError("");
    try {
      const next=await loadMarket(interim=>{if(id===requestId.current)setResult(interim)});
      const cached=cachedRecovery(next);
      const shown=cached?mergeRecovery(next,cached):next;
      if(id===requestId.current){setResult(shown);setLoading(false)}
      const date=next.days.at(-1)?.date;
      const existing=shown.snapshot?.history.find(row=>row.date===date);
      const diagnostic=new URLSearchParams(window.location.search).has('checkDetail')&&
        sessionStorage.getItem(`ashare_check_${date}`)!=='done';
      const needStar=existing?.star===undefined||diagnostic;
      const needEtf=existing?.etf===undefined||diagnostic;
      if(!date||!recoveryReady(next))return;
      if(!needStar&&!needEtf){if(id===requestId.current)setDetailStatus('');return}
      const retryKey=`ashare_retry_${date}`;
      if(!diagnostic&&Number(storageGet(retryKey)??0)>Date.now())return;
      if(id===requestId.current)setDetailStatus('正在从行情源直连核验缺失的细分项…');
      try{
        const recovered=await recoverBrowserDetail(date,next.days.at(-1)!.sh,
          next.days.at(-1)!.sz,next.etf300?.get(date)??existing?.etf510300??null,
          needStar,needEtf);
        if(diagnostic){
          sessionStorage.setItem(`ashare_check_${date}`,'done');
          const starOK=!needStar||recovered.star!==undefined&&
            (existing?.star===undefined||Math.abs(existing.star-recovered.star)<Math.max(3,existing.star*.0075));
          const etfOK=!needEtf||recovered.etf!==undefined&&
            (existing?.etf===undefined||Math.abs(existing.etf-recovered.etf)<Math.max(3,existing.etf*.002));
          if(id===requestId.current)setDetailStatus(
            `${starOK&&etfOK?'直连复核偏差在校验范围内':'直连复核与快照存在差异，已保留原始快照'}：`+
            `科创 ${recovered.star===undefined?'未取得':yi(recovered.star)} / ${existing?.star===undefined?'缺失':yi(existing.star)}，`+
            `ETF ${recovered.etf===undefined?'未取得':yi(recovered.etf)} / ${existing?.etf===undefined?'缺失':yi(existing.etf)} 亿元（直连 / 快照）。`);
        }else{
          const combined={...cached,...recovered};
          storageSet(recoveryKey(date),JSON.stringify(combined));
          storageSet(retryKey,String(Date.now()+15*60_000));
          if(id===requestId.current){setResult(mergeRecovery(shown,combined));
            setDetailStatus(combined.star!==undefined&&combined.etf!==undefined?
              'ETF 已直连核验；科创为竞价口径参考值，交易所分类终值待仓库补采。':
              '部分细分项已补采，其余仍待核实并将稍后重试。')}
        }
      }catch{
        storageSet(retryKey,String(Date.now()+15*60_000));
        if(id===requestId.current)setDetailStatus('细分项直连补采暂不可用，保留“待核实”并稍后重试。');
      }
    }
    catch(e){if(id===requestId.current)setError(e instanceof Error?e.message:"行情读取失败");}
    finally{inFlight.current=false;if(id===requestId.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    // Keep the two minute cadence while exchanges and the close snapshot can
    // change. A hidden tab or out-of-hours page does no repeated fetches.
    const poll=setInterval(()=>{
      const time=new Date(Date.now()+8*3600_000),weekday=time.getUTCDay();
      const minute=time.getUTCHours()*60+time.getUTCMinutes();
      if(!document.hidden&&weekday>0&&weekday<6&&minute>=9*60+15&&minute<=16*60+30)void refresh();
    },2*60*1000);
    let scheduled:ReturnType<typeof setTimeout>;
    const schedule=()=>{
      scheduled=setTimeout(()=>{void refresh();schedule()},nextScheduledRefresh(Date.now()));
    };
    schedule();
    const onVisibility=()=>{if(!document.hidden)void refresh()};
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{clearInterval(poll);clearTimeout(scheduled);document.removeEventListener("visibilitychange",onVisibility);requestId.current++};
  },[refresh]);
  useEffect(()=>{
    const update=()=>setDailyQuoteIndex(quoteIndexAt(Date.now()));
    update();const clock=setInterval(update,60_000);
    return()=>clearInterval(clock);
  },[]);
  useEffect(()=>{
    if(!shareOpen)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setShareOpen(false)};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  },[shareOpen]);
  useEffect(()=>{
    if(!shareOpen)return;
    const fit=()=>{
      const dialog=shareDialog.current;
      if(!dialog)return;
      dialog.style.zoom="1";
      if(window.innerWidth>650)return;
      // Fit the card and controls inside the visible phone viewport.
      const available=(window.visualViewport?.height??window.innerHeight)-12;
      dialog.style.zoom=String(Math.min(1,available/dialog.scrollHeight));
    };
    const frame=requestAnimationFrame(fit);
    window.addEventListener("resize",fit);
    window.visualViewport?.addEventListener("resize",fit);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener("resize",fit);window.visualViewport?.removeEventListener("resize",fit)};
  },[shareOpen,shareFeedback,dailyQuoteIndex,result]);
  const days=result?.days??[],latest=days.at(-1),prev=days.at(-2);
  const latestDetail=result?.snapshot?.history.find(item=>item.date===latest?.date);
  const etf300=latest?(result?.etf300?.get(latest.date)??latestDetail?.etf510300):undefined;
  const nowBeijing=new Date(Date.now()+8*3600_000).toISOString();
  const today=nowBeijing.slice(0,10),clock=nowBeijing.slice(11,16);
  const quoteTime=result?.quoteAt.filter((x):x is string=>!!x).sort().at(0);
  const currentDay=latest?.date===today;
  const closeConfirmed=!!(currentDay&&result&&isCloseConfirmed(today,result.quoteAt,Date.now()));
  const waitingClose=!!(currentDay&&clock>="15:15"&&!closeConfirmed);
  const waitingNoon=!!(currentDay&&clock>="12:00"&&clock<"13:00"&&(!quoteTime?.startsWith(today)||quoteTime.slice(11)<"11:30"));
  const intraday=!!(currentDay&&!closeConfirmed&&!waitingClose);
  const provisional=currentDay&&!closeConfirmed?today:null;
  const complete=provisional?prev:latest;
  const completePrev=provisional?days.at(-3):prev;
  const prevDetail=result?.snapshot?.history.find(item=>item.date===prev?.date);
  const currentTier=complete?tier(complete.total/10000):null;
  const delta=!provisional&&latest&&prev?(latest.total/prev.total-1)*100:null;
  const heat=!provisional?latest?.heat:undefined;
  const phase=waitingClose?"收盘数据待更新":waitingNoon?"午间数据待更新":intraday&&clock>="12:00"&&clock<"13:00"?"午间累计":intraday?"盘中累计":"收盘";
  const rollingWan=complete?.roll20===undefined?null:complete.roll20/10000;
  const rollingReference=rollingWan!==null&&rollingWan>=55&&rollingWan<=60?1:
    rollingWan!==null&&rollingWan>=110&&rollingWan<=115?2:null;
  const heatPercent=heat===undefined?null:heat*100;
  const heatReference=heatPercent===null?null:heatPercent<85?0:heatPercent<=105?1:
    heatPercent>110&&heatPercent<140?2:heatPercent>=140?3:null;
  const comparable=!provisional&&!!prev;
  const detailComparable=comparable&&latestDetail?.starSource===prevDetail?.starSource;
  const etfComparable=comparable&&latestDetail?.etfSource===prevDetail?.etfSource;
  const prevEtf300=prev?(result?.etf300?.get(prev.date)??prevDetail?.etf510300):undefined;
  const dailyQuote=investorQuotes[dailyQuoteIndex];
  const shareData:ShareDatum[]=[
    {label:"沪深两市成交额",value:latest?`${wan(latest.total)} 万亿元`:"待核实",note:provisional?"盘中暂计":undefined},
    {label:"近 20 个交易日累计成交额",value:complete?.roll20!==undefined?`${wan(complete.roll20)} 万亿元`:"待核实",note:provisional&&complete?.roll20!==undefined?"截至上一完整交易日":undefined},
    {label:"20 日平均成交额",value:complete?.avg20!==undefined?`${yi(complete.avg20)} 亿元/日`:"待核实",note:provisional&&complete?.avg20!==undefined?"截至上一完整交易日":undefined},
    {label:"科创板成交额",value:latestDetail?.star!==undefined?`${yi(latestDetail.star)} 亿元`:"待核实",note:latestDetail?.starSource?.includes('浏览器补采')?'竞价口径参考，待交易所核对':latestDetail?.star===undefined?"上交所同日分类暂缺":undefined},
    {label:"沪深 ETF 成交额",value:latestDetail?.etf!==undefined?`${yi(latestDetail.etf)} 亿元`:"待核实"}
  ];
  const saveQuoteImage=async()=>{
    try{
      await saveQuotePng({quote:dailyQuote.text,author:dailyQuote.author,source:dailyQuote.source,locator:dailyQuote.locator,url:dailyQuote.url,
        date:latest?.date??today,stage:latest?phase:"等待数据",data:shareData});
      setShareFeedback("PNG 图片已生成并开始下载");
    }catch(error){setShareFeedback(error instanceof Error?`图片保存失败：${error.message}`:"图片保存失败");}
  };
  const copyQuote=async()=>{
    try{await navigator.clipboard.writeText(quoteShareText(dailyQuote));setShareFeedback("观点、出处和来源链接已复制");}
    catch{setShareFeedback("复制失败，请选择卡片文字手动复制");}
  };
  const shareQuote=async()=>{
    if(!navigator.share){await copyQuote();return;}
    try{await navigator.share({title:`${dailyQuote.author} · 投资观点`,text:quoteShareText(dailyQuote)});setShareFeedback("已打开系统分享");}
    catch(error){if((error as Error)?.name!=="AbortError")setShareFeedback("分享未完成，可使用复制文案");}
  };
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"/>大A观测助手</div><div className="top-right"><span>沪深两市 · {waitingClose?"收盘核对中":intraday?"盘中更新":"最近交易日"}</span><button onClick={refresh} disabled={loading}><RefreshCw size={17} className={loading?"spinning":""}/>刷新</button></div></header>
    <div className="content">
      <section className="daily-quote" aria-label="每日投资观点"><div className="quote-body"><span className="quote-label">今日投资观点 · {dailyQuote.author}</span><p>“{dailyQuote.text}”</p><a href={dailyQuote.url} target="_blank" rel="noreferrer">出处：{dailyQuote.source} · {dailyQuote.locator}</a><span className="quote-note">据原文意译或归纳</span></div><div className="quote-actions"><button className="quote-export" onClick={()=>{setShareFeedback("");setShareOpen(true)}}><Share2 size={15}/>分享观点</button></div></section>
      {shareOpen&&<div className="share-backdrop" onClick={event=>{if(event.target===event.currentTarget)setShareOpen(false)}}><section ref={shareDialog} className="share-dialog" role="dialog" aria-modal="true" aria-label="投资观点分享卡片"><div className="share-heading"><button type="button" onClick={()=>setShareOpen(false)} aria-label="关闭分享卡片" autoFocus><X size={19}/></button></div><div className="share-card"><span>大A观测助手 · 今日投资观点</span><blockquote>“{dailyQuote.text}”</blockquote><p className="share-author">—— {dailyQuote.author}</p><p className="share-source">出处：<a href={dailyQuote.url} target="_blank" rel="noreferrer">{dailyQuote.source} · {dailyQuote.locator}</a></p><p className="share-paraphrase">据原文意译或归纳</p><div className="share-market"><h3>市场数据 · {latest?.date??today} · {latest?phase:"等待数据"}</h3><div className="share-market-grid">{shareData.map(item=><div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note&&<small>{item.note}</small>}</div>)}</div></div><footer>powered by C.Luo w/ChatGPT</footer></div><div className="share-actions"><button type="button" onClick={saveQuoteImage}><Download size={17}/>保存图片 PNG</button><button type="button" onClick={copyQuote}><Copy size={17}/>复制分享文案</button><button type="button" onClick={shareQuote}><Share2 size={17}/>系统分享</button></div><p className="share-feedback" role="status">{shareFeedback}</p></section></div>}
      <div className="intro"><div><p className="eyebrow">MARKET ACTIVITY / DAILY</p><h1>成交活跃度</h1></div><div className="status-col"><div className="freshness"><span className={`dot ${latest?"good":""}`}/>{loading&&!latest?"正在读取行情数据":latest?`数据日期 ${latest.date} · ${phase}`:"暂无有效数据"}</div><div className="schedule-hint">北京时间 12:00 / 15:15 / 收盘后多次自动刷新</div></div></div>
      {error&&<div className="notice error" role="alert">{error} <button onClick={refresh}>重试</button></div>}
      <div className="section-kicker">01 / 全市场 · 当日与基准</div>
      <div className="metrics overview-metrics">
        <article className="metric primary"><div className="metric-title">沪深两市成交额 <small>{provisional?"盘中暂计":"单日"} · 万亿元</small></div><div className="big">{latest?wan(latest.total):"—"}<span>万亿</span></div><div className="under"><span>{provisional?"收盘后计算日变化":delta===null?"等待完整数据":`较上日 ${delta>=0?"+":""}${delta.toFixed(1)}%`}</span><a href="#guide-daily">指南针 · 解读参考</a></div><div className="metric-actions"><DataDownload result={result} metric="total"/></div><div className="split"><span>上证市场 <b>{latest?yi(latest.sh):"—"} 亿</b><DataDownload result={result} metric="sh" iconOnly/></span><span>深证市场 <b>{latest?yi(latest.sz):"—"} 亿</b><DataDownload result={result} metric="sz" iconOnly/></span></div></article>
        <article className="metric compact temperature-metric"><div className="metric-title">资金温度计 <small>当日 ÷ 20 日均量</small></div><div className="compact-number">{heat!==undefined?(heat*100).toFixed(1):"—"}<span>% · {heat!==undefined?heat.toFixed(2):"—"} 倍</span></div><div className="heat-track"><span style={{width:`${Math.min(100,(heat??0)/2*100)}%`}}/></div>{heatMark(heat)&&<a className="metric-mark" href="#guide-heat">{heatMark(heat)}</a>}<p className="fine">{provisional?"盘中成交额尚未完整，收盘核实后计算资金温度。":"1.00 倍为近 20 个交易日平均水平；仅衡量成交活跃度，不表示资金净流入。"}</p><div className="metric-actions"><DataDownload result={result} metric="heat"/><a href="#guide-heat">资金温度 · 解读参考</a></div></article>
      </div>
      <section className="panel rolling-summary"><div className="rolling-head"><div className="rolling-stat"><p className="eyebrow">20-DAY ROLLING / 北极星</p><h2>近 20 个交易日累计成交额</h2><div className="big">{complete?.roll20!==undefined?wan(complete.roll20):"—"}<span>万亿</span></div>{!provisional&&rollingMark(complete?.roll20)&&<a className="metric-mark" href="#guide-rolling">{rollingMark(complete?.roll20)}</a>}<p className="fine">{provisional&&complete?`截至上一完整交易日 ${complete.date}；盘中暂不计入`:complete?.roll20!==undefined&&completePrev?.roll20!==undefined?`较上一交易日 ${((complete.roll20/completePrev.roll20-1)*100).toFixed(1)}%`:"累计 20 个完整交易日后显示"}</p><div className="metric-actions"><DataDownload result={result} metric="roll20"/><a href="#guide-rolling">北极星 · 解读参考</a></div></div><div className="rolling-stat average-stat"><p className="eyebrow">20-DAY BASELINE</p><h2>20 日平均成交额</h2><div className="compact-number">{complete?.avg20!==undefined?yi(complete.avg20):"—"}<span>亿元 / 交易日</span></div>{relativeMark(complete?.avg20,completePrev?.avg20,!provisional)&&<span className="metric-mark neutral">{relativeMark(complete?.avg20,completePrev?.avg20)}</span>}<p className="fine">基准量＝近 20 个完整交易日累计额 ÷ 20</p><div className="metric-actions"><DataDownload result={result} metric="avg20"/></div></div></div><div className="rolling-chart-heading"><h3>滚动累计趋势</h3><span>悬停查看具体日期、均量和资金温度</span></div><Chart data={provisional?days.slice(0,-1):days}/><p className="fine">每一点为该日及之前 19 个完整交易日的成交额合计；图中参考线对应北极星的滚动累计区间。</p></section>
      <div className="section-kicker">02 / 市场与产品 · 按覆盖范围</div>
      <section className="panel market-depth"><div className="panel-header"><div><p className="eyebrow">MARKET DEPTH / DAILY</p><h2>市场层级成交额</h2></div><span>{latest?.date??"等待数据"} · 单位：亿元</span></div>
        <div className="depth-list">{[
          {metric:"total",label:"沪深两市",value:latest?.total,note:"沪市＋深市",mark:relativeMark(latest?.total,prev?.total,comparable)},
          {metric:"sh",label:"上证市场",value:latest?.sh,note:"包含科创板",mark:relativeMark(latest?.sh,prev?.sh,comparable)},
          {metric:"sz",label:"深证市场",value:latest?.sz,note:"与沪市合计构成上方总额",mark:relativeMark(latest?.sz,prev?.sz,comparable)},
          {metric:"star",label:"科创板",value:latestDetail?.star,note:latestDetail?.starSource??"上交所股票分类统计",mark:relativeMark(latestDetail?.star,prevDetail?.star,detailComparable)},
          {metric:"etf",label:"沪深 ETF",value:latestDetail?.etf,note:latestDetail?.etfCount?`已核对 ${latestDetail.etfCount.toLocaleString("zh-CN")} 只 · ${latestDetail.etfSource??"ETF 行情"}` :"ETF 明细全量汇总",mark:relativeMark(latestDetail?.etf,prevDetail?.etf,etfComparable)},
          {metric:"etf510300",label:"510300",value:etf300??undefined,note:"沪深300ETF华泰柏瑞 · ETF 总额子集",mark:relativeMark(etf300,prevEtf300,comparable)}
        ].map((item,index)=><div className={`depth-row depth-${index}`} key={item.label}><div className="depth-name"><div className="depth-heading"><strong>{item.label}</strong>{item.mark&&<span className="metric-mark neutral">{item.mark}</span>}</div><small>{item.note}</small></div>
          <div className="depth-data"><b>{item.value!==undefined&&item.value!==null?yi(item.value):"—"}</b><span>{item.value!==undefined&&item.value!==null?"亿元":"同日数据待核实"}</span><DataDownload result={result} metric={item.metric as MetricKey} iconOnly/></div>
          <div className="depth-bar"><span style={{width:`${latest&&item.value?Math.max(1,item.value/latest.total*100):0}%`}}/></div></div>)}</div>
        {detailStatus&&<p className="fine" role="status">{detailStatus}</p>}
        {latest&&latestDetail?.star===undefined&&<p className="fine">科创板：同日可核验的分类成交额暂缺；正在通过定时任务与浏览器直连补采，不使用科创综指等不同口径代填。</p>}
        {latestDetail?.etfSh!==undefined&&latestDetail?.etfSz!==undefined&&<p className="fine etf-breakdown">ETF 分市场：沪市 {yi(latestDetail.etfSh)} 亿元 <DataDownload result={result} metric="etfSh" iconOnly/>{relativeMark(latestDetail.etfSh,prevDetail?.etfSh,etfComparable)&&<span className="metric-mark neutral">{relativeMark(latestDetail.etfSh,prevDetail?.etfSh)}</span>}＋深市 {yi(latestDetail.etfSz)} 亿元 <DataDownload result={result} metric="etfSz" iconOnly/>{relativeMark(latestDetail.etfSz,prevDetail?.etfSz,etfComparable)&&<span className="metric-mark neutral">{relativeMark(latestDetail.etfSz,prevDetail?.etfSz)}</span>}；核对于 {latestDetail.etfCheckedAt?new Date(latestDetail.etfCheckedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"未知"}（北京时间）。</p>}
        <p className="fine">细分项与上层市场之间存在包含关系，不应直接相加。ETF 为沪深场内 ETF 成交额，不等同全部基金；510300 已计入 ETF。科创板最近核对：{latestDetail?.starCheckedAt?new Date(latestDetail.starCheckedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"待核实"}；来源：{latestDetail?.starSource??"待核实"}。</p>
      </section>
      <EtfFlows refreshKey={result?.checkedAt} marketDate={latest?.date}/>
      <MarketChart days={days} result={result} provisional={provisional}/>
      <section className="panel history"><div className="panel-header"><div><p className="eyebrow">LATEST SESSIONS</p><h2>近期交易日</h2><p className="history-unit">沪、深、合计、20 日累计：万亿元；科创、ETF、510300、20 日平均：亿元；资金温度：表格用倍，手机卡片用百分比</p></div><button className="download" onClick={()=>result&&downloadHistory(result)} disabled={!result}><Download size={16}/>下载历史 CSV（{days.length} 日）</button></div><div className="table-wrap"><HistoryTableHead result={result}/>{days.slice(-10).reverse().map(d=>{const extra=result?.snapshot?.history.find(item=>item.date===d.date),single=result?.etf300?.get(d.date)??extra?.etf510300;return <div className="table-row" key={d.date}><span>{d.date}{d.date===provisional?" · 盘中":""}</span><span>{wan(d.sh)}</span><span>{wan(d.sz)}</span><strong>{wan(d.total)}</strong><span>{extra?.star!==undefined?yi(extra.star):"—"}</span><span>{extra?.etf!==undefined?yi(extra.etf):"—"}</span><span>{single!=null?yi(single):"—"}</span><span>{d.date===provisional||d.roll20===undefined?"—":wan(d.roll20)}</span><span>{d.date===provisional||d.avg20===undefined?"—":yi(d.avg20)}</span><span>{d.date===provisional||d.heat===undefined?"—":d.heat.toFixed(2)}</span></div>})}{!days.length&&<div className="empty">{loading?"正在核对交易日数据…":"暂无完整的沪深数据"}</div>}</div><MobileHistory days={days} result={result} provisional={provisional}/><p className="fine">导出 CSV 保留底层“亿元”数值，细分市场历史仅包含已核实日期；盘中行会标记“盘中暂计”，其滚动值和温度留空。</p></section>
      <section className="panel guide" id="reference"><div className="panel-header"><div><p className="eyebrow">REFERENCE LIST / 解读参考</p><h2>指标、阈值与观察含义</h2></div><span>按对应数据口径分区</span></div>
        <p className="reference-credit">本页观察工具箱来自“袁莹投资思维”；以下阈值用于标注原有观察规则，实际数据由行情与交易所来源核对。</p>
        <p className="guide-swipe-hint">左右滑动查看三项解读参考 →</p><div className="guide-groups" aria-label="指南针、北极星和资金温度计解读参考">
          <div className="guide-block" id="guide-daily"><span className="guide-index">01 · 当日沪深成交额</span><h3>指南针</h3><p className="guide-description">大 A 每日成交额 · 单位：万亿元</p>
            <div className="range-list">{tiers.map((t,i)=><div className={`reference-entry ${i===currentTier?"active":""}`} key={t.text}><strong>{t.text}</strong><div><b>{t.name}</b><small>{t.note}</small></div>{i===currentTier&&<em>{provisional?"前收":"当前"}</em>}</div>)}</div>
          </div>
          <div className="guide-block" id="guide-rolling"><span className="guide-index">02 · 近 20 日累计成交额</span><h3>北极星指标</h3><p className="guide-description">大 A 近 20 个交易日流动成交额 · 单位：万亿元</p>
            <div className="reference-list"><div><strong>11.38</strong><span>原有历史参考低点</span></div><div className={rollingReference===1?"active":undefined}><strong>55—60</strong><span>利润开始撤走；原有减仓观察区间</span>{rollingReference===1&&<em>{provisional?"前收":"当前"}</em>}</div><div className={rollingReference===2?"active":undefined}><strong>110—115</strong><span>全部撤走；原有清仓观察区间</span>{rollingReference===2&&<em>{provisional?"前收":"当前"}</em>}</div></div>
            <p className="fine">以上是原有的滚动累计观察值，对应页面的 20 日累计与趋势图。</p>
          </div>
          <div className="guide-block" id="guide-heat"><span className="guide-index">03 · 当日与基准比较</span><h3>资金温度计</h3><p className="guide-description">当日沪深成交额 ÷（近 20 日累计成交额 ÷ 20）</p>
            <div className="reference-list"><div className={heatReference===0?"active":undefined}><strong>＜85%</strong><span>地量，交易较少；按原规则可准备买入</span>{heatReference===0&&<em>当前</em>}</div><div className={heatReference===1?"active":undefined}><strong>85%—105%</strong><span>正常，按原规则暂不操作</span>{heatReference===1&&<em>当前</em>}</div><div className={heatReference===2?"active":undefined}><strong>＞110%—＜140%</strong><span>过热，按原规则准备卖出</span>{heatReference===2&&<em>当前</em>}</div><div className={heatReference===3?"active":undefined}><strong>≥140%</strong><span>太热，按原规则需要退出</span>{heatReference===3&&<em>当前</em>}</div></div>
            <p className="fine">105%—110% 未设定明确动作；85% 归入正常区间，140% 归入最高区间。</p>
          </div>
        </div>
        <p className="fine guide-disclaimer">以上解读是用户设定的观察规则，数字由真实成交额计算；阈值及对应操作未经过策略验证，不构成投资建议。</p>
        <div className="indicator-reference"><strong>层级与作用</strong><p>沪深合计：全市场成交活跃度；上证、深证：观察两地市场分布；科创板：观察沪市科技板块；沪深 ETF：观察交易所基金；510300：观察单只宽基 ETF。20 日累计：观察中期总量；20 日平均：作为当日比较基准；资金温度：当日成交额相对基准的倍数。</p></div>
      <footer><p><strong>数据口径</strong> 页面中的“量”统一指成交额，不是成交股数或 ETF 份数。腾讯行情上证指数与深证成指的沪、深市场成交额由万元换算为亿元；该行情口径与严格仅计 A 股的交易所分类统计有细微差异。20 日累计由连续 20 个共同交易日计算，20 日均量＝累计额 ÷ 20，资金温度＝当日沪深合计 ÷ 20 日均量。</p><p><strong>更新与核对</strong> 页面打开时，北京时间 12:00、15:15、15:55、16:55、17:55、18:55 定点刷新，在北京时间工作日 09:15—16:30 的可变时段每 2 分钟核对；重新打开页面也会立即读取。科创板、ETF 的数据由仓库工作流于交易日午间与收盘后的多个错峰时点抓取，若工作流漏采，收盘后浏览器会按完整代码范围直连补采，并检查日期、金额与覆盖数量；补采结果仅在当前浏览器保存，仓库快照仍须由工作流提交。无同日合格数据时显示“待核实”。{result&&` ${result.source}；行情时间 ${quoteTime??"未知"}（北京时间）；本页核对 ${new Date(result.checkedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}。`}{result?.snapshot&&` ${result.snapshot.clientRecoveredAt?"浏览器细分项补采":"细分项仓库快照"} ${new Date(result.snapshot.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}。`}</p><p><strong>来源</strong> <a href="https://gu.qq.com/sh000001/zs" target="_blank" rel="noreferrer">腾讯财经·上证指数</a> · <a href="https://gu.qq.com/sz399001/zs" target="_blank" rel="noreferrer">腾讯财经·深证成指</a> · <a href="https://gu.qq.com/sh510300" target="_blank" rel="noreferrer">腾讯财经·510300</a> · <a href="https://www.sse.com.cn/market/stockdata/overview/day/" target="_blank" rel="noreferrer">上交所·股票成交概况</a> · <a href="https://qt.gtimg.cn/q=sh510300" target="_blank" rel="noreferrer">腾讯财经·ETF 报价</a>。观察区间仅供自定义监测，不构成投资建议。</p></footer>
      <section className="quote-library" aria-label="投资观点库导出"><div><strong>投资观点库</strong><span>逐条附有作者、原始出处和定位；页面按北京时间每日轮换。</span></div><button className="quote-export" onClick={downloadQuotes}><Download size={15}/>导出观点库 CSV（{investorQuotes.length} 条）</button></section>
      </section>
    </div>
  </main>;
}
