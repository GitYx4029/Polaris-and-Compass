"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { composeDays, parseTencent, type Day, type MarketRow } from "@/lib/market";
import { investorQuotes, quoteIndexAt } from "@/lib/investorQuotes";
import { nextScheduledRefresh } from "@/lib/refreshSchedule";

type Detail = { date:string;sh:number;sz:number;star?:number;etf?:number;etfCount?:number;etfActive?:number;etf510300?:number|null };
type Snapshot = { asOf:string;generatedAt:string;history:Detail[];status?:{star?:string|null;etf?:string|null} };
type Result = { days: Day[]; quoteAt: (string|null)[]; source: string; checkedAt: string;
  snapshot:Snapshot|null; etf300:Map<string,number>|null };
const wan = (yi: number) => (yi/10000).toFixed(2);
const yi = (value:number) => value.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const tiers = [
  { text: "＜ 1.3", name: "量化和小散" },
  { text: "1.3—1.5", name: "救市和托" },
  { text: "1.5—1.8", name: "小散开始有增量资金" },
  { text: "1.8—2.0", name: "单一板块行情" },
  { text: "≥ 2.0", name: "多板块行情" }
];
const tier = (v: number) => v < 1.3 ? 0 : v < 1.5 ? 1 : v < 1.8 ? 2 : v < 2 ? 3 : 4;
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

async function loadMarket():Promise<Result> {
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
  const days=composeDays(rows);
  if(days.length<20)throw new Error(`仅取得 ${days.length} 个完整交易日，无法核实近20日成交额。`);
  const snapshotUrl=window.location.hostname.endsWith(".github.io")
    ? `${window.location.pathname.split("/").filter(Boolean).length?"/Polaris-and-Compass":""}/data/market-snapshot.json`
    : "https://gityx4029.github.io/Polaris-and-Compass/data/market-snapshot.json";
  const [snapshot,etf300]=await Promise.all([
    fetch(`${snapshotUrl}?t=${Date.now()}`,{cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error(`快照 ${response.status}`);
      const value=await response.json() as Snapshot;
      if(!Array.isArray(value.history)||!/^\d{4}-\d\d-\d\d$/.test(value.asOf))throw new Error("快照格式异常");
      return value;
    }).catch(()=>null),
    browserKline("sh510300").then(data=>data.amounts).catch(()=>null)
  ]);
  return {days,quoteAt,source,checkedAt:new Date().toISOString(),snapshot,etf300};
}

function downloadHistory(result:Result) {
  const detail=new Map(result.snapshot?.history.map(item=>[item.date,item])??[]);
  const header="交易日,上证市场成交额(亿元),深证市场成交额(亿元),沪深合计成交额(亿元),科创板成交额(亿元),沪深ETF成交额(亿元),510300成交额(亿元),近20交易日累计成交额(亿元),近20交易日平均成交额(亿元),资金温度(倍),数据来源,核对时间";
  const lines=result.days.map(d=>{
    const extra=detail.get(d.date),etf300=result.etf300?.get(d.date)??extra?.etf510300;
    return [d.date,d.sh.toFixed(4),d.sz.toFixed(4),d.total.toFixed(4),
      extra?.star?.toFixed(4)??"",extra?.etf?.toFixed(4)??"",etf300?.toFixed(4)??"",
      d.roll20?.toFixed(4)??"",d.avg20?.toFixed(4)??"",d.heat?.toFixed(6)??"",
      result.source,result.checkedAt].join(",");
  });
  const file=new Blob(["\ufeff",header,"\r\n",lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(file);
  const anchor=document.createElement("a"); anchor.href=url;
  anchor.download=`市场成交额_${result.days[0].date}_${result.days.at(-1)!.date}.csv`;
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

function Chart({data}:{data:Day[]}) {
  const [hover,setHover]=useState<number|null>(null);
  const pts=data.filter(d=>d.roll20!==undefined).slice(-45);
  if(pts.length<2)return <div className="chart-empty">凑齐 21 个完整交易日后绘制滚动趋势</div>;
  const w=900,h=230,p=30,values=pts.map(d=>d.roll20!/10000);
  const min=Math.floor((Math.min(...values)-2)/2)*2;
  const max=Math.ceil((Math.max(...values)+2)/2)*2;
  const x=(i:number)=>p+i*(w-p*2)/(pts.length-1);
  const y=(v:number)=>h-p-(v-min)*(h-p*2)/(max-min);
  const path=pts.map((d,i)=>`${i?"L":"M"}${x(i)},${y(d.roll20!/10000)}`).join(" ");
  const selected=hover!==null?pts[hover]:undefined;
  return <div className="line-frame"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="近20交易日累计成交额走势"
    onPointerMove={event=>{
      const rect=event.currentTarget.getBoundingClientRect();
      const px=(event.clientX-rect.left)/rect.width*w;
      setHover(Math.max(0,Math.min(pts.length-1,Math.round((px-p)*(pts.length-1)/(w-2*p)))));
    }} onPointerLeave={()=>setHover(null)}>
    {[55,60,110,115].filter(v=>v>min&&v<max).map(v=><g key={v}><line x1={p} x2={w-p} y1={y(v)} y2={y(v)} stroke="#477078" strokeDasharray="5 7"/><text x={w-p-4} y={y(v)-7} textAnchor="end" fill="#8aa5a7" fontSize="16">{v} 万亿</text></g>)}
    <path d={path} fill="none" stroke="#42c6b1" strokeWidth="3.5" vectorEffect="non-scaling-stroke"/>
    {selected&&<line x1={x(hover!)} x2={x(hover!)} y1={p} y2={h-p} stroke="#91ddd0" strokeDasharray="4 5" vectorEffect="non-scaling-stroke"/>}
    {pts.map((d,i)=><circle key={d.date} cx={x(i)} cy={y(d.roll20!/10000)} r={i===hover?"7":"4"} fill="#42c6b1"
      tabIndex={0} aria-label={`${d.date}，20日累计 ${(d.roll20!/10000).toFixed(4)} 万亿元`}
      onFocus={()=>setHover(i)} onBlur={()=>setHover(null)} onClick={()=>setHover(i)}/>)}
  </svg>{selected&&<div className={`chart-tooltip ${y(selected.roll20!/10000)<110?"below":"above"}`}
    style={{left:`clamp(120px, ${x(hover!)/w*100}%, calc(100% - 120px))`,top:`${y(selected.roll20!/10000)/h*210}px`}} role="status">
    <strong>{selected.date}</strong><div><span>20 日累计</span><b>{(selected.roll20!/10000).toFixed(4)} 万亿元</b></div>
    <div><span>20 日均量</span><b>{yi(selected.avg20!)} 亿元</b></div>
    <div><span>资金温度</span><b>{selected.heat!.toFixed(3)} 倍</b></div>
    <div><span>当日合计</span><b>{(selected.total/10000).toFixed(4)} 万亿元</b></div>
    <div><span>沪市 / 深市</span><b>{(selected.sh/10000).toFixed(4)} / {(selected.sz/10000).toFixed(4)} 万亿元</b></div>
  </div>}<div className="chart-axis"><span>{pts[0].date.slice(5)}</span><span>{pts.at(-1)!.date.slice(5)}</span></div></div>;
}

const chartModes=[
  {key:"total",label:"沪深合计",unit:"万亿元",scale:10000},
  {key:"sh",label:"上证市场",unit:"亿元",scale:1},
  {key:"star",label:"科创板",unit:"亿元",scale:1},
  {key:"etf",label:"沪深 ETF",unit:"亿元",scale:1},
  {key:"etf510300",label:"510300",unit:"亿元",scale:1},
  {key:"roll20",label:"20 日累计",unit:"万亿元",scale:10000},
  {key:"avg20",label:"20 日均量",unit:"亿元",scale:1}
] as const;
type ChartKey=typeof chartModes[number]["key"];

function MarketChart({days,result}:{days:Day[];result:Result|null}) {
  const [mode,setMode]=useState<ChartKey>("total");
  const [hover,setHover]=useState<number|null>(null);
  const detail=new Map(result?.snapshot?.history.map(item=>[item.date,item])??[]);
  const selectedMode=chartModes.find(item=>item.key===mode)!;
  const pts=days.map(day=>{
    const extra=detail.get(day.date);
    const value=mode==="star"?extra?.star:mode==="etf"?extra?.etf
      :mode==="etf510300"?(result?.etf300?.get(day.date)??extra?.etf510300)
      :day[mode];
    return {date:day.date,value:typeof value==="number"&&value>0?value/selectedMode.scale:null};
  }).filter((point):point is {date:string;value:number}=>point.value!==null).slice(-40);
  const w=900,h=190,p=26,values=pts.map(point=>point.value);
  const low=values.length?Math.min(...values):0, high=values.length?Math.max(...values):1;
  const min=Math.max(0,low-(high-low||high*.1)*.2),max=high+(high-low||high*.1)*.2;
  const x=(index:number)=>p+index*(w-p*2)/Math.max(1,pts.length-1);
  const y=(value:number)=>h-p-(value-min)/(max-min||1)*(h-p*2);
  const focus=hover===null?null:pts[hover];
  return <section className="panel multi-trend"><div className="panel-header"><div><p className="eyebrow">MARKET SERIES</p><h2>各层级成交额趋势</h2></div><span>选择指标 · 悬停查看数值</span></div>
    <div className="chart-tabs" role="group" aria-label="趋势指标">{chartModes.map(item=><button
      key={item.key} className={mode===item.key?"active":""} aria-pressed={mode===item.key}
      onClick={()=>{setMode(item.key);setHover(null)}}>{item.label}</button>)}</div>
    {pts.length<2?<div className="chart-empty">{pts.length===1?`${pts[0].date}：${pts[0].value.toFixed(2)} ${selectedMode.unit}；等待下一交易日以绘制趋势`:"该指标的已核实历史数据暂不足两日"}</div>
    :<div className="line-frame extra-chart"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${selectedMode.label}历史成交额趋势`}
      onPointerMove={event=>{const rect=event.currentTarget.getBoundingClientRect();const px=(event.clientX-rect.left)/rect.width*w;
        setHover(Math.max(0,Math.min(pts.length-1,Math.round((px-p)*(pts.length-1)/(w-p*2)))));}}
      onPointerLeave={()=>setHover(null)}>
      {[0,1,2].map(i=><g key={i}><line x1={p} x2={w-p} y1={p+i*(h-2*p)/2} y2={p+i*(h-2*p)/2} stroke="#38565a" strokeDasharray="4 6"/><text x={w-p} y={p+i*(h-2*p)/2-5} textAnchor="end" fill="#abc6c1" fontSize="14">{(max-i*(max-min)/2).toFixed(2)}</text></g>)}
      <path d={pts.map((point,index)=>`${index?"L":"M"}${x(index)},${y(point.value)}`).join(" ")} fill="none" stroke="#62d4bd" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
      {focus&&<circle cx={x(hover!)} cy={y(focus.value)} r="7" fill="#d5fff0"/>}
    </svg>{focus&&<div className="chart-tooltip" style={{left:`clamp(110px,${x(hover!)/w*100}%,calc(100% - 110px))`,top:`${y(focus.value)/h*170}px`,transform:"translate(-50%,-105%)"}} role="status"><strong>{focus.date}</strong><div><span>{selectedMode.label}</span><b>{focus.value.toFixed(4)} {selectedMode.unit}</b></div></div>}
    <div className="chart-axis"><span>{pts[0].date.slice(5)}</span><span>{pts.at(-1)!.date.slice(5)}</span></div></div>}
    <p className="fine">科创板和 ETF 的历史值从成功核实之日逐日积累；单只 ETF 包含在 ETF 总额中，科创板包含在沪市内，请勿横向相加。</p>
  </section>;
}

export default function Home() {
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [dailyQuoteIndex,setDailyQuoteIndex]=useState(0);
  const requestId=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++requestId.current;
    setLoading(true);setError("");
    try {const next=await loadMarket();if(id===requestId.current)setResult(next);}
    catch(e){if(id===requestId.current)setError(e instanceof Error?e.message:"行情读取失败");}
    finally{if(id===requestId.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    const poll=setInterval(()=>void refresh(),2*60*1000);
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
  const days=result?.days??[],latest=days.at(-1),prev=days.at(-2);
  const latestDetail=result?.snapshot?.history.find(item=>item.date===latest?.date);
  const etf300=latest?(result?.etf300?.get(latest.date)??latestDetail?.etf510300):undefined;
  const currentTier=latest?tier(latest.total/10000):null;
  const delta=latest&&prev?(latest.total/prev.total-1)*100:null;
  const nowBeijing=new Date(Date.now()+8*3600_000).toISOString();
  const today=nowBeijing.slice(0,10),clock=nowBeijing.slice(11,16);
  const quoteTime=result?.quoteAt.filter((x):x is string=>!!x).sort().at(0);
  const currentDay=latest?.date===today;
  const closeConfirmed=!!(currentDay&&quoteTime?.startsWith(today)&&quoteTime.slice(11)>="15:00");
  const waitingClose=!!(currentDay&&clock>="15:15"&&!closeConfirmed);
  const waitingNoon=!!(currentDay&&clock>="12:00"&&clock<"13:00"&&(!quoteTime?.startsWith(today)||quoteTime.slice(11)<"11:30"));
  const intraday=!!(currentDay&&!closeConfirmed&&!waitingClose);
  const phase=waitingClose?"收盘数据待更新":waitingNoon?"午间数据待更新":intraday&&clock>="12:00"&&clock<"13:00"?"午间累计":intraday?"盘中累计":"收盘";
  const dailyQuote=investorQuotes[dailyQuoteIndex];
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"/>A股成交观察</div><div className="top-right"><span>沪深两市 · {waitingClose?"收盘核对中":intraday?"盘中更新":"最近交易日"}</span><button onClick={refresh} disabled={loading}><RefreshCw size={17} className={loading?"spinning":""}/>刷新</button></div></header>
    <div className="content">
      <section className="daily-quote" aria-label="每日投资观点"><div className="quote-body"><span className="quote-label">今日投资观点 · {dailyQuote.author}</span><p>{dailyQuote.text}</p><a href={dailyQuote.url} target="_blank" rel="noreferrer">{dailyQuote.source} · {dailyQuote.locator}</a><span className="quote-note">据原文意译或归纳</span></div><button className="quote-export" onClick={downloadQuotes}><Download size={15}/>导出观点库 CSV（{investorQuotes.length} 条）</button></section>
      <div className="intro"><div><p className="eyebrow">MARKET ACTIVITY / DAILY</p><h1>成交活跃度</h1></div><div className="status-col"><div className="freshness"><span className={`dot ${latest?"good":""}`}/>{loading&&!latest?"正在读取行情数据":latest?`数据日期 ${latest.date} · ${phase}`:"暂无有效数据"}</div><div className="schedule-hint">北京时间 12:00 / 15:15 自动刷新</div></div></div>
      {error&&<div className="notice error" role="alert">{error} <button onClick={refresh}>重试</button></div>}
      {latest&&prev&&tier(prev.total/10000)!==currentTier&&<div className="notice" role="status">最近交易日成交额进入 <strong>{tiers[currentTier!].text} 万亿</strong> 区间。</div>}
      <div className="section-kicker">01 / 全市场 · 当日与基准</div>
      <div className="metrics overview-metrics">
        <article className="metric primary"><div className="metric-title">沪深两市成交额 <small>单日 · 万亿元</small></div><div className="big">{latest?wan(latest.total):"—"}<span>万亿</span></div><div className="under"><span>{delta===null?"等待完整数据":`较上日 ${delta>=0?"+":""}${delta.toFixed(1)}%`}</span><strong>{currentTier===null?"—":tiers[currentTier].name}</strong></div><div className="split"><span>上证市场 <b>{latest?yi(latest.sh):"—"} 亿</b></span><span>深证市场 <b>{latest?yi(latest.sz):"—"} 亿</b></span></div></article>
        <article className="metric"><div className="metric-title">近 20 个交易日累计 <small>万亿元</small></div><div className="big">{latest?.roll20!==undefined?wan(latest.roll20):"—"}<span>万亿</span></div><div className="under"><span>{latest?.roll20!==undefined&&prev?.roll20!==undefined?`较上一交易日 ${((latest.roll20/prev.roll20-1)*100).toFixed(1)}%`:"累计 20 个完整交易日后显示"}</span></div><div className="reference-mini">参考值 55 / 60 / 110 / 115 万亿</div></article>
      </div>
      <div className="metrics baseline-metrics">
        <article className="metric compact"><div className="metric-title">20 日平均成交额 <small>沪深合计 · 每交易日</small></div><div className="compact-number">{latest?.avg20?yi(latest.avg20):"—"}<span>亿元</span></div><p className="fine">基准量＝近 20 个交易日累计额 ÷ 20</p></article>
        <article className="metric compact"><div className="metric-title">资金温度 <small>当日 ÷ 20 日均量</small></div><div className="compact-number">{latest?.heat?latest.heat.toFixed(2):"—"}<span>倍 · {latest?.heat?(latest.heat*100).toFixed(1):"—"}%</span></div><div className="heat-track"><span style={{width:`${Math.min(100,(latest?.heat??0)/2*100)}%`}}/></div><p className="fine">1.00 倍为近 20 个交易日平均水平；仅衡量成交活跃度，不表示资金净流入。</p></article>
      </div>
      <div className="section-kicker">02 / 市场与产品 · 自大到小</div>
      <section className="panel market-depth"><div className="panel-header"><div><p className="eyebrow">MARKET DEPTH / DAILY</p><h2>市场层级成交额</h2></div><span>{latest?.date??"等待数据"} · 单位：亿元</span></div>
        <div className="depth-list">{[
          {label:"沪深两市",value:latest?.total,note:"沪市＋深市"},
          {label:"上证市场",value:latest?.sh,note:"包含科创板"},
          {label:"深证市场",value:latest?.sz,note:"与沪市合计构成上方总额"},
          {label:"科创板",value:latestDetail?.star,note:"上交所股票分类统计"},
          {label:"沪深 ETF",value:latestDetail?.etf,note:latestDetail?.etfCount?`已核对 ${latestDetail.etfCount} 只 ETF` :"ETF 明细全量汇总"},
          {label:"510300",value:etf300??undefined,note:"沪深300ETF · ETF 总额子集"}
        ].map((item,index)=><div className={`depth-row depth-${index}`} key={item.label}><div className="depth-name"><strong>{item.label}</strong><small>{item.note}</small></div>
          <div className="depth-data"><b>{item.value!==undefined&&item.value!==null?yi(item.value):"—"}</b><span>{item.value!==undefined&&item.value!==null?"亿元":"同日数据待核实"}</span></div>
          <div className="depth-bar"><span style={{width:`${latest&&item.value?Math.max(1,item.value/latest.total*100):0}%`}}/></div></div>)}</div>
        <p className="fine">细分项与上层市场之间存在包含关系，不应直接相加。ETF 为沪深场内 ETF 成交额，不等同全部基金；510300 已计入 ETF。</p>
      </section>
      <MarketChart days={days} result={result}/>
      <div className="two-col">
        <section className="panel trend"><div className="panel-header"><div><p className="eyebrow">20-DAY ROLLING</p><h2>滚动累计趋势</h2></div><span>每日推进一个交易日</span></div><Chart data={days}/><p className="fine">每一点为该日及之前 19 个交易日的成交金额合计；仅在图表范围内绘制参考线。</p></section>
        <section className="panel guide"><div className="panel-header"><div><p className="eyebrow">REFERENCE LIST</p><h2>指标与参考含义</h2></div><span>单日与滚动指标</span></div><div className="range-list">{tiers.map((t,i)=><div className={`range ${i===currentTier?"active":""}`} key={t.text}><span>0{i+1}</span><strong>{t.text}</strong><span>{t.name}</span>{i===currentTier&&<em>当前</em>}</div>)}</div><p className="fine">上表是单日沪深成交额观察区间，单位：万亿元。</p><div className="reference-list"><div><strong>11.38 万亿</strong><span>历史参考低点</span></div><div><strong>55—60 万亿</strong><span>减仓观察区间</span></div><div><strong>110—115 万亿</strong><span>清仓观察区间</span></div></div><p className="fine">此处单位为近 20 个交易日累计万亿元；均为人工设定的参考阈值，不代表可验证的交易信号。</p><div className="indicator-reference"><strong>层级与作用</strong><p>沪深合计：全市场成交活跃度；上证、深证：观察两地市场分布；科创板：观察沪市科技板块；沪深 ETF：观察交易所基金；510300：观察单只宽基 ETF。20 日累计：观察中期总量；20 日平均：作为当日比较基准；资金温度：当日成交额相对基准的倍数。</p></div></section>
      </div>
      <section className="panel history"><div className="panel-header"><div><p className="eyebrow">LATEST SESSIONS</p><h2>近期交易日</h2><p className="history-unit">沪、深、合计、20 日累计：万亿元；科创、ETF、510300、20 日平均：亿元；资金温度：倍</p></div><button className="download" onClick={()=>result&&downloadHistory(result)} disabled={!result}><Download size={16}/>下载历史 CSV（{days.length} 日）</button></div><div className="table-wrap"><div className="table-row table-head"><span>交易日</span><span>上证</span><span>深证</span><span>沪深合计</span><span>科创板</span><span>沪深 ETF</span><span>510300</span><span>20 日累计</span><span>20 日平均</span><span>资金温度</span></div>{days.slice(-10).reverse().map(d=>{const extra=result?.snapshot?.history.find(item=>item.date===d.date),single=result?.etf300?.get(d.date)??extra?.etf510300;return <div className="table-row" key={d.date}><span>{d.date}</span><span>{wan(d.sh)}</span><span>{wan(d.sz)}</span><strong>{wan(d.total)}</strong><span>{extra?.star!==undefined?yi(extra.star):"—"}</span><span>{extra?.etf!==undefined?yi(extra.etf):"—"}</span><span>{single!=null?yi(single):"—"}</span><span>{d.roll20===undefined?"—":wan(d.roll20)}</span><span>{d.avg20===undefined?"—":yi(d.avg20)}</span><span>{d.heat===undefined?"—":d.heat.toFixed(2)}</span></div>})}{!days.length&&<div className="empty">{loading?"正在核对交易日数据…":"暂无完整的沪深数据"}</div>}</div><p className="fine">导出 CSV 保留底层“亿元”数值，细分市场历史仅包含已核实日期；空白表示尚无可靠记录。</p></section>
      <footer><p><strong>数据口径</strong> 页面中的“量”统一指成交额，不是成交股数或 ETF 份数。腾讯行情上证指数与深证成指的沪、深市场成交额由万元换算为亿元；该行情口径与严格仅计 A 股的交易所分类统计有细微差异。20 日累计由连续 20 个共同交易日计算，20 日均量＝累计额 ÷ 20，资金温度＝当日沪深合计 ÷ 20 日均量。</p><p><strong>更新与核对</strong> 页面打开时，北京时间 12:00、15:15 定点刷新，并每 2 分钟读取一次；重新打开页面也会立即读取。科创板、ETF 的数据由仓库工作流于交易日 12:10、15:25 抓取并核验，服务延迟或节假日时以数据日期为准；无同日合格数据时显示“待核实”。{result&&` ${result.source}；行情时间 ${quoteTime??"未知"}（北京时间）；本页核对 ${new Date(result.checkedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}。`}{result?.snapshot&&` 细分项快照 ${new Date(result.snapshot.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}。`}</p><p><strong>来源</strong> <a href="https://gu.qq.com/sh000001/zs" target="_blank" rel="noreferrer">腾讯财经·上证指数</a> · <a href="https://gu.qq.com/sz399001/zs" target="_blank" rel="noreferrer">腾讯财经·深证成指</a> · <a href="https://gu.qq.com/sh510300" target="_blank" rel="noreferrer">腾讯财经·510300</a> · <a href="https://www.sse.com.cn/market/stockdata/overview/day/" target="_blank" rel="noreferrer">上交所·股票成交概况</a> · <a href="https://quote.eastmoney.com/center/gridlist.html#fund_etf" target="_blank" rel="noreferrer">东方财富·ETF 行情</a>。观察区间仅供自定义监测，不构成投资建议。</p></footer>
    </div>
  </main>;
}
