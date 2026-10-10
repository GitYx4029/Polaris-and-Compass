"use client";
import {useCallback,useEffect,useState} from "react";
import {Download,RefreshCw} from "lucide-react";
import {navigationGroups} from "@/lib/navigation";
import {validEtfFlows,type EtfFlowSnapshot,type EtfFlowRow} from "@/lib/etfFlows";

const root="https://raw.githubusercontent.com/GitYx4029/Polaris-and-Compass/main/public/data/";
const apiRoot="https://api.github.com/repos/GitYx4029/Polaris-and-Compass/contents/public/data/";
async function readFile(name:string):Promise<unknown>{
  // Data commits are served directly: collection never needs a site rebuild.
  const stamp=Date.now();
  for(const base of [root,apiRoot,"/Polaris-and-Compass/data/"]){
    try{
      const response=await fetch(`${base}${name}?t=${stamp}`,{cache:"no-store",
        headers:base===apiRoot?{Accept:"application/vnd.github.raw+json"}:undefined,
        signal:AbortSignal.timeout(7000)});
      if(response.ok)return await response.json();
    }catch{/* Try the next public delivery path. */}
  }
  throw new Error("ETF 榜单暂时无法读取");
}
const number=(value:number)=>value.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
function saveCsv(snapshots:EtfFlowSnapshot[],row?:EtfFlowRow){
  const field=(value:string|number|boolean)=>`"${String(value).replace(/"/g,'""')}"`;
  const header="统计交易日,排名,ETF代码,ETF名称,基金全称,资金净流入(亿元),同日成交额(亿元),成交额交易日,净流入来源,净流入来源链接,成交额来源链接,核验时间(UTC),数据口径";
  const lines=snapshots.flatMap(s=>s.rows.filter(r=>!row||r.code===row.code).map(r=>
    [s.asOf,r.rank,r.code,r.name,r.fullName,r.netInflowYi,r.turnoverYi,r.turnoverDate,
      s.source,s.sourceUrl,r.turnoverSourceUrl,s.generatedAt,s.method].map(field).join(",")));
  const url=URL.createObjectURL(new Blob(["\ufeff",header,"\r\n",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;
  a.download=`ETF净流入${row?`_${row.code}`:"前20"}_${snapshots[0].asOf}${snapshots.length>1?`_${snapshots.at(-1)!.asOf}`:""}.csv`;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function EtfFlows({refreshKey,marketDate}:{refreshKey?:string;marketDate?:string}){
  const [snapshot,setSnapshot]=useState<EtfFlowSnapshot|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [expanded,setExpanded]=useState(false),[downloading,setDownloading]=useState(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try{
      const value=await readFile("etf-flows.json");
      if(!validEtfFlows(value))throw new Error("ETF 榜单未通过日期、排名与成交额校验");
      if(!signal?.aborted){
        setSnapshot(previous=>!previous||value.asOf>previous.asOf||
          (value.asOf===previous.asOf&&value.generatedAt>=previous.generatedAt)?value:previous);
        setError("");
      }
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:"ETF 榜单获取失败");}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);
    return()=>controller.abort();},[refresh,refreshKey]);
  const downloadArchive=async()=>{
    if(!snapshot)return;setDownloading(true);
    try{
      const archive=await readFile("etf-flows-history.json") as {schemaVersion:number;sessions:unknown[]};
      if(archive.schemaVersion!==1||!Array.isArray(archive.sessions)||!archive.sessions.length||
        !archive.sessions.every(validEtfFlows))throw new Error("历史榜单未通过校验");
      const sessions=archive.sessions as EtfFlowSnapshot[];
      if(sessions.some((s,i)=>i>0&&s.asOf<=sessions[i-1].asOf))throw new Error("历史日期重复或顺序异常");
      saveCsv(sessions);setError("");
    }catch(e){setError(e instanceof Error?e.message:"历史下载失败");}
    finally{setDownloading(false);}
  };
  const delayed=!!(snapshot&&marketDate&&snapshot.asOf<marketDate);
  return <section className={`panel etf-flows ${expanded?"flow-expanded":""}`} id="etf-inflows">
    <div className="panel-header"><div><p className="eyebrow">ETF DAILY NET INFLOWS</p>
      <h3>{navigationGroups[2].links[0].label}</h3><p className="flow-subtitle">按净流入金额降序 · 净申购赎回估算 · 单位：亿元</p></div>
      <div className="flow-actions"><button className="data-export" onClick={()=>snapshot&&saveCsv([snapshot])} disabled={!snapshot}><Download size={14}/>下载本期</button>
        <button className="data-export" onClick={downloadArchive} disabled={!snapshot||downloading}><Download size={14}/>{downloading?"下载中…":"下载历史"}</button>
        <button className="data-export icon-only" onClick={()=>void refresh()} disabled={loading} title="重新读取已核验榜单" aria-label="刷新 ETF 榜单"><RefreshCw size={14} className={loading?"spinning":""}/></button></div>
    </div>
    {snapshot?<>
      <div className="flow-date"><strong>统计交易日 · {snapshot.asOf}</strong><span>已核验 {snapshot.universeCount.toLocaleString("zh-CN")} 只的数据源排名</span></div>
      {delayed&&<p className="fine flow-delay">{marketDate} 的净流入统计尚未发布或通过核验；以下为 {snapshot.asOf} 榜单，成交额也取同日。申赎统计通常晚于收盘行情。</p>}
      <table className="flow-table"><thead><tr><th scope="col">排名</th><th scope="col">代码 / ETF 名称</th><th scope="col">资金净流入</th><th scope="col">同日成交额</th><th scope="col"><span className="sr-only">下载</span></th></tr></thead>
        <tbody>{snapshot.rows.map(row=><tr key={row.code}><td className="flow-rank">{String(row.rank).padStart(2,"0")}</td>
          <td className="flow-name"><a href={`https://fund.stockstar.com/funds/${row.code}.shtml`} target="_blank" rel="noreferrer" title={row.fullName}>{row.name}</a><span>{row.code}</span></td>
          <td className="flow-amount flow-inflow"><small>净流入</small><strong>+{number(row.netInflowYi)}</strong><i style={{width:`${row.netInflowYi/snapshot.rows[0].netInflowYi*100}%`}}/></td>
          <td className="flow-amount"><small>成交额</small><strong>{number(row.turnoverYi)}</strong></td>
          <td className="flow-download"><button className="data-export icon-only" title={`下载 ${row.code} 本期数据`} aria-label={`下载 ${row.name} 数据`} onClick={()=>saveCsv([snapshot],row)}><Download size={13}/></button></td></tr>)}</tbody></table>
      <button className="flow-mobile-more" onClick={()=>setExpanded(!expanded)}>{expanded?"收起至前 5 名":"展开全部 20 只 ETF"}</button>
      <p className="fine flow-provenance">净流入：<a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">{snapshot.source}</a>；同日成交额：腾讯财经日线。净流入采用数据源申赎估算原值，与二级市场主力资金流向、成交额分开统计。核验：{new Date(snapshot.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}（北京时间）。历史从首次成功采集起累计，最多保留 300 期。</p>
    </>:<p className="empty">{loading?"正在读取已核验 ETF 榜单…":"ETF 榜单暂缺，请稍后刷新"}</p>}
    {error&&<p className="fine" role="status">{error}{snapshot?"；保留上次核验结果。":"。"}</p>}
  </section>;
}
