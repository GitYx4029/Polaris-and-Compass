"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { composeDays, parseTencent, type Day, type MarketRow } from "@/lib/market";

type Result = { days: Day[]; quoteAt: (string|null)[]; source: string; checkedAt: string };
const wan = (yi: number) => (yi/10000).toFixed(2);
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
function browserKline(symbol: "sh000001"|"sz399001") {
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
  return {days,quoteAt,source,checkedAt:new Date().toISOString()};
}

function downloadHistory(result:Result) {
  const header="交易日,沪市成交额(亿元),深市成交额(亿元),沪深合计(亿元),近20交易日累计(万亿元),数据来源,核对时间";
  const lines=result.days.map(d=>[d.date,d.sh.toFixed(4),d.sz.toFixed(4),d.total.toFixed(4),
    d.roll20===undefined?"":(d.roll20/10000).toFixed(4),result.source,result.checkedAt].join(","));
  const file=new Blob(["\ufeff",header,"\r\n",lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(file);
  const anchor=document.createElement("a"); anchor.href=url;
  anchor.download=`沪深成交额_${result.days[0].date}_${result.days.at(-1)!.date}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function Chart({data}:{data:Day[]}) {
  const pts=data.filter(d=>d.roll20!==undefined).slice(-45);
  if(pts.length<2)return <div className="chart-empty">凑齐 21 个完整交易日后绘制滚动趋势</div>;
  const w=900,h=230,p=30,values=pts.map(d=>d.roll20!/10000);
  const min=Math.floor((Math.min(...values)-2)/2)*2;
  const max=Math.ceil((Math.max(...values)+2)/2)*2;
  const x=(i:number)=>p+i*(w-p*2)/(pts.length-1);
  const y=(v:number)=>h-p-(v-min)*(h-p*2)/(max-min);
  const path=pts.map((d,i)=>`${i?"L":"M"}${x(i)},${y(d.roll20!/10000)}`).join(" ");
  return <div className="line-frame"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="近20交易日累计成交额走势">
    {[55,60,110,115].filter(v=>v>min&&v<max).map(v=><g key={v}><line x1={p} x2={w-p} y1={y(v)} y2={y(v)} stroke="#477078" strokeDasharray="5 7"/><text x={w-p-4} y={y(v)-7} textAnchor="end" fill="#8aa5a7" fontSize="16">{v} 万亿</text></g>)}
    <path d={path} fill="none" stroke="#42c6b1" strokeWidth="3.5" vectorEffect="non-scaling-stroke"/>
    {pts.map((d,i)=><circle key={d.date} cx={x(i)} cy={y(d.roll20!/10000)} r="4" fill="#42c6b1"><title>{d.date}：{wan(d.roll20!)} 万亿元</title></circle>)}
  </svg><div className="chart-axis"><span>{pts[0].date.slice(5)}</span><span>{pts.at(-1)!.date.slice(5)}</span></div></div>;
}

export default function Home() {
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try {setResult(await loadMarket());}
    catch(e){setError(e instanceof Error?e.message:"行情读取失败");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{refresh();const id=setInterval(refresh,2*60*1000);return()=>clearInterval(id)},[refresh]);
  const days=result?.days??[],latest=days.at(-1),prev=days.at(-2);
  const currentTier=latest?tier(latest.total/10000):null;
  const delta=latest&&prev?(latest.total/prev.total-1)*100:null;
  const today=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  const quoteTime=result?.quoteAt.filter((x):x is string=>!!x).sort().at(0);
  const intraday=!!(latest&&quoteTime?.startsWith(today)&&quoteTime.slice(11)<"15:05");
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"/>A股成交观察</div><div className="top-right"><span>沪深两市 · {intraday?"盘中更新":"最近交易日"}</span><button onClick={refresh} disabled={loading}><RefreshCw size={17} className={loading?"spinning":""}/>刷新</button></div></header>
    <div className="content">
      <div className="intro"><div><p className="eyebrow">MARKET ACTIVITY / DAILY</p><h1>成交活跃度</h1></div><div className="freshness"><span className={`dot ${latest?"good":""}`}/>{loading&&!latest?"正在读取行情数据":latest?`数据日期 ${latest.date}${intraday?" · 盘中累计":" · 收盘"}`:"暂无有效数据"}</div></div>
      {error&&<div className="notice error" role="alert">{error} <button onClick={refresh}>重试</button></div>}
      {latest&&prev&&tier(prev.total/10000)!==currentTier&&<div className="notice" role="status">最近交易日成交额进入 <strong>{tiers[currentTier!].text} 万亿</strong> 区间。</div>}
      <div className="metrics">
        <article className="metric primary"><div className="metric-title">单日成交额 <small>沪＋深 · 万亿元</small></div><div className="big">{latest?wan(latest.total):"—"}<span>万亿</span></div><div className="under"><span>{delta===null?"等待完整数据":`较上日 ${delta>=0?"+":""}${delta.toFixed(1)}%`}</span><strong>{currentTier===null?"—":tiers[currentTier].name}</strong></div><div className="split"><span>沪市 <b>{latest?wan(latest.sh):"—"}</b></span><span>深市 <b>{latest?wan(latest.sz):"—"}</b></span></div></article>
        <article className="metric"><div className="metric-title">近 20 个交易日累计 <small>万亿元</small></div><div className="big">{latest?.roll20!==undefined?wan(latest.roll20):"—"}<span>万亿</span></div><div className="under"><span>{latest?.roll20!==undefined&&prev?.roll20!==undefined?`较上一交易日 ${((latest.roll20/prev.roll20-1)*100).toFixed(1)}%`:"累计 20 个完整交易日后显示"}</span></div><div className="reference-mini">参考值 55 / 60 / 110 / 115 万亿</div></article>
      </div>
      <div className="two-col">
        <section className="panel trend"><div className="panel-header"><div><p className="eyebrow">20-DAY ROLLING</p><h2>滚动累计趋势</h2></div><span>每日推进一个交易日</span></div><Chart data={days}/><p className="fine">每一点为该日及之前 19 个交易日的成交金额合计；仅在图表范围内绘制参考线。</p></section>
        <section className="panel guide"><div className="panel-header"><div><p className="eyebrow">REFERENCE LIST</p><h2>指标与参考含义</h2></div><span>原图观察框架</span></div><div className="range-list">{tiers.map((t,i)=><div className={`range ${i===currentTier?"active":""}`} key={t.text}><span>0{i+1}</span><strong>{t.text}</strong><span>{t.name}</span>{i===currentTier&&<em>当前</em>}</div>)}</div><p className="fine">上表单位为单日万亿元；原图据此描述参与结构与板块行情。</p><div className="reference-list"><div><strong>11.38 万亿</strong><span>原图记录的本轮最低滚动值</span></div><div><strong>55—60 万亿</strong><span>原图：利润开始撤走的观察区间</span></div><div><strong>110—115 万亿</strong><span>原图：全部撤走的观察区间</span></div></div><p className="fine">此处单位为近 20 个交易日累计万亿元。均为原图的主观观察，不代表可验证的买卖信号。</p></section>
      </div>
      <section className="panel history"><div className="panel-header"><div><p className="eyebrow">LATEST SESSIONS</p><h2>近期交易日</h2><p className="history-unit">金额单位：万亿元</p></div><button className="download" onClick={()=>result&&downloadHistory(result)} disabled={!result}><Download size={16}/>下载历史 CSV（{days.length} 日）</button></div><div className="table-wrap"><div className="table-row table-head"><span>交易日</span><span>沪市</span><span>深市</span><span>合计</span><span>20 日累计</span></div>{days.slice(-10).reverse().map(d=><div className="table-row" key={d.date}><span>{d.date}</span><span>{wan(d.sh)}</span><span>{wan(d.sz)}</span><strong>{wan(d.total)}</strong><span>{d.roll20===undefined?"—":wan(d.roll20)}</span></div>)}{!days.length&&<div className="empty">{loading?"正在核对交易日数据…":"暂无完整的沪深数据"}</div>}</div></section>
      <footer><p><strong>数据口径</strong> 腾讯行情上证指数与深证成指的沪、深市场成交额，单位由万元换算为万亿元；该行情口径与严格仅计 A 股的交易所分类统计有细微差异。20 日指标由连续 20 个共同交易日合计，不补填休市日。</p><p><strong>更新与核对</strong> 页面开启时每 2 分钟读取一次；盘中显示累计值，收盘后显示最近交易日。最近行情还用同一数据源的独立即时报价字段核对。{result&&` ${result.source}；行情时间 ${quoteTime??"未知"}（北京时间）；本页核对 ${new Date(result.checkedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}。`}</p><p><strong>来源</strong> <a href="https://gu.qq.com/sh000001/zs" target="_blank" rel="noreferrer">腾讯财经·上证指数</a> · <a href="https://gu.qq.com/sz399001/zs" target="_blank" rel="noreferrer">腾讯财经·深证成指</a>。观察区间仅供自定义监测，不构成投资建议。</p></footer>
    </div>
  </main>;
}
