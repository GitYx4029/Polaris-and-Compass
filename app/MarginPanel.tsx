"use client";
import {createContext,useContext,useEffect,useMemo,useState,type CSSProperties,type ReactNode} from "react";
import {Download,RefreshCw} from "lucide-react";
import {validateMargin,marginSeries,marginLadder,ladderLabels,marginSources,marginResearch,
  type MarginSnapshot,type MarginPoint,type LadderKey} from "@/lib/margin";

type State={snapshot:MarginSnapshot|null;points:MarginPoint[];index:number;pick:(i:number)=>void;
  loading:boolean;error:string;refresh:()=>void;marketDate?:string;ladderKey:LadderKey;setLadderKey:(key:LadderKey)=>void};
const Context=createContext<State|null>(null);
const useMargin=()=>{const state=useContext(Context);if(!state)throw Error("融资数据上下文缺失");return state;};
const numeric=(value:number,digits=2)=>value.toLocaleString("zh-CN",{minimumFractionDigits:digits,maximumFractionDigits:digits});
const yi=(value:number)=>numeric(value/1e8),wan=(value:number)=>numeric(value/1e12,4);
const signed=(value:number,digits=2)=>`${value>0?"+":""}${numeric(value,digits)}`;

export function MarginProvider({children,marketDate}:{children:ReactNode;marketDate?:string}){
  const [snapshot,setSnapshot]=useState<MarginSnapshot|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(""),[revision,setRevision]=useState(0),[picked,setPicked]=useState<string|null>(null);
  const [ladderKey,setLadderKey]=useState<LadderKey>("intensity20");
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    if(!snapshot)try{const cached=JSON.parse(localStorage.getItem("polaris-margin-v1")??"null");validateMargin(cached);setSnapshot(cached);}catch{/* Read verified network data. */}
    const run=async()=>{
      setLoading(true);let success=false;
      for(const url of [
        "https://raw.githubusercontent.com/GitYx4029/Polaris-and-Compass/main/public/data/margin.json",
        "https://api.github.com/repos/GitYx4029/Polaris-and-Compass/contents/public/data/margin.json",
        "/Polaris-and-Compass/data/margin.json",
      ])try{
        const result=await fetch(`${url}?v=${Math.floor(Date.now()/60000)}`,{cache:"no-store",
          headers:url.includes("api.github")?{Accept:"application/vnd.github.raw+json"}:undefined,
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)])});
        if(!result.ok)throw Error(`HTTP ${result.status}`);
        const next:unknown=await result.json();validateMargin(next);
        if(alive){setSnapshot(prev=>!prev||next.asOf>prev.asOf||next.asOf===prev.asOf&&next.generatedAt>=prev.generatedAt?next:prev);setError("");
          try{const old=JSON.parse(localStorage.getItem("polaris-margin-v1")??"null");if(!old||next.asOf>=old.asOf)localStorage.setItem("polaris-margin-v1",JSON.stringify(next));}catch{/* Storage quota does not block reading. */}}
        success=true;break;
      }catch{if(controller.signal.aborted)return;}
      if(alive){setLoading(false);if(!success)setError("融资数据暂时无法读取；保留已核验记录，请稍后刷新。");}
    };
    void run();const timer=setInterval(()=>{if(document.visibilityState==="visible")void run();},300000);
    return()=>{alive=false;controller.abort();clearInterval(timer);};
    // Snapshot is deliberately not a dependency: one fetch supplies both panels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[revision]);
  const points=useMemo(()=>snapshot?marginSeries(snapshot.history):[],[snapshot]);
  const selected=picked?points.findIndex(p=>p.date===picked):-1,index=selected>=0?selected:Math.max(0,points.length-1);
  return <Context.Provider value={{snapshot,points,index,pick:i=>setPicked(points[i]?.date??null),loading,error,refresh:()=>setRevision(r=>r+1),marketDate,ladderKey,setLadderKey}}>{children}</Context.Provider>;
}

type DownloadMetric="all"|"balance"|"net"|"intensity"|"growth20";
const exportColumns:Record<DownloadMetric,[string,(p:MarginPoint)=>unknown][]>={
  all:[],
  balance:[["沪市融资余额(元)",p=>p.sh.balance],["深市融资余额(元)",p=>p.sz.balance],["沪深融资余额(元)",p=>p.balance],
    ["沪深融券余额(元)",p=>p.short],["沪深两融余额(元)",p=>p.total]],
  net:[["融资买入额(元)",p=>p.buy],["融资偿还额_含推算模式(元)",p=>p.repay],["融资净买入(元)",p=>p.net],
    ["近5交易日融资净买入(元)",p=>p.net5],["近20交易日融资净买入(元)",p=>p.net20],["连续净买入天数_负值为净偿还",p=>p.streak]],
  intensity:[["沪深股票行情成交额_代理分母(元)",p=>p.stockTurnover],["融资交易强度_代理口径(%)",p=>p.intensity],["融资交易强度20日均值(%)",p=>p.intensity20]],
  growth20:[["融资余额近20交易日增幅(%)",p=>p.growth20]],
};
const titles:Record<DownloadMetric,string>={all:"融资与杠杆",balance:"融资与两融余额",net:"融资净买入",intensity:"融资交易强度",growth20:"融资余额增速"};
export function MarginDownload({metric="all",compact=false}:{metric?:DownloadMetric;compact?:boolean}){
  const {snapshot,points}=useMargin();
  const save=()=>{
    if(!snapshot)return;
    const columns=metric==="all"?Object.entries(exportColumns).filter(([key])=>key!=="all").flatMap(([,cols])=>cols):exportColumns[metric];
    const field=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
    const head=["统计交易日",...columns.map(c=>c[0]),"范围","核验时间UTC","偿还额是否由余额推算","沪市官方偿还原值_备用模式(元)","融资历史来源","上交所核验来源","深交所核验来源","股票行情来源"];
    const rows=points.map(p=>[p.date,...columns.map(c=>c[1](p)),"沪深证券融资汇总，含ETF等标的",snapshot.generatedAt,!!(p.sh.repayInferred||p.sz.repayInferred),p.sh.reportedRepay,marginSources.em,marginSources.sh,marginSources.sz,marginSources.tencent].map(field).join(","));
    const url=URL.createObjectURL(new Blob(["\ufeff",head.map(field).join(","),"\r\n",rows.join("\r\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=`${titles[metric]}_${points[0].date}_${snapshot.asOf}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <button className={`data-export ${compact?"icon-only":""}`} onClick={save} disabled={!snapshot} aria-label={`下载${titles[metric]}历史 CSV`} title={`下载${titles[metric]}历史 CSV`}><Download size={14}/>{!compact&&"下载 CSV"}</button>;
}

function LadderBadge({metric}:{metric:LadderKey}){
  const {points,index,setLadderKey}=useMargin();const ladder=marginLadder(points,index,metric);
  return ladder?<a className="metric-mark neutral" href="#margin-reference" onClick={()=>setLadderKey(metric)}>{ladderLabels[metric][ladder.band]}</a>:<span className="margin-muted">历史样本待积累</span>;
}
function MarginCharts(){
  const {points,index,pick}=useMargin(),[chart,setChart]=useState("balance"),[full,setFull]=useState(false),[hover,setHover]=useState<number|null>(null);
  const from=full?0:Math.max(0,points.length-120),shown=points.slice(from),focus=points[hover??index],w=640,h=172,p=24;
  if(shown.length<2||!focus)return null;
  const chartIndex=Math.max(0,(hover??index)-from);
  const x=(i:number)=>p+i/(shown.length-1)*(w-2*p);
  const pointerIndex=(clientX:number,rect:DOMRect)=>from+Math.max(0,Math.min(shown.length-1,Math.round(((clientX-rect.left)/rect.width*w-p)/(w-2*p)*(shown.length-1))));
  return <div className="margin-chart-area"><div className="margin-chart-heading"><strong>融资规模与净买入趋势</strong><span>{shown.length} 个交易日 · 单位：亿元</span></div>
    <div className="margin-range-tabs" role="group" aria-label="融资图表历史范围"><button aria-pressed={!full} onClick={()=>{setFull(false);if(index<points.length-120)pick(points.length-1);}}>近 120 日</button><button aria-pressed={full} onClick={()=>setFull(true)}>全部历史</button></div>
    <div className="margin-chart-tabs" role="group" aria-label="融资图表切换">{[["balance","融资余额"],["net","融资净买入"]].map(([key,label])=><button key={key} aria-pressed={chart===key} onClick={()=>setChart(key)}>{label}</button>)}</div>
    <div className="margin-charts">{["balance","net"].map(kind=>{
      const values=shown.map(d=>kind==="balance"?d.balance:d.net),lo=kind==="balance"?Math.min(...values)*.995:Math.min(0,...values),hi=kind==="balance"?Math.max(...values)*1.005:Math.max(0,...values);
      const y=(v:number)=>h-p-(v-lo)/(hi-lo||1)*(h-2*p),zero=y(0);
      return <div className={`margin-chart ${chart===kind?"is-active":""}`} key={kind}><span>{kind==="balance"?"融资余额":"当日融资净买入"}</span>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={kind==="balance"?"沪深融资余额历史曲线":"沪深融资净买入历史柱状图"} onPointerMove={event=>setHover(pointerIndex(event.clientX,event.currentTarget.getBoundingClientRect()))} onPointerLeave={()=>setHover(null)} onClick={event=>pick(pointerIndex(event.clientX,event.currentTarget.getBoundingClientRect()))}>
          {[0,.5,1].map(t=><g key={t}><line x1={p} x2={w-p} y1={p+t*(h-2*p)} y2={p+t*(h-2*p)} stroke="#36575a" strokeDasharray="3 6"/><text x={w-p} y={p+t*(h-2*p)-5} textAnchor="end" fill="#9ebdb5" fontSize="13">{((hi-t*(hi-lo))/1e8).toFixed(0)}</text></g>)}
          {kind==="balance"?<path d={values.map((v,i)=>`${i?"L":"M"}${x(i)},${y(v)}`).join(" ")} stroke="#6fe1cb" strokeWidth="2.5" fill="none" vectorEffect="non-scaling-stroke"/>:<><line x1={p} x2={w-p} y1={zero} y2={zero} stroke="#73938b"/>{values.map((v,i)=><rect key={i} x={x(i)-2} y={Math.min(zero,y(v))} width={Math.max(2,(w-2*p)/shown.length*.65)} height={Math.max(1,Math.abs(y(v)-zero))} fill={v>=0?"#64ceba":"#d4b67c"}/>)}</>}
          {index>=from&&<line x1={x(chartIndex)} x2={x(chartIndex)} y1={p} y2={h-p} stroke="#e7f7f0" strokeDasharray="2 3"/>}
        </svg><div className="chart-axis"><span>{shown[0].date.slice(5)}</span><span>{shown.at(-1)!.date.slice(5)}</span></div>
      </div>;
    })}</div>
    <label className="chart-scrubber"><span>拖动核对交易日</span><input type="range" min={from} max={points.length-1} step={1} value={index} style={{"--scrub-progress":`${(index-from)/(points.length-1-from)*100}%`} as CSSProperties} onChange={e=>{setHover(null);pick(Number(e.currentTarget.value));}} aria-label="选择融资与杠杆交易日"/><strong>{points[index].date}</strong></label>
    <p className="chart-readout">{hover!==null&&`${focus.date} · `}融资余额 <b>{yi(focus.balance)} 亿元</b> · 净买入 <b>{signed(focus.net/1e8)} 亿元</b> · 20 日净买入 <b>{focus.net20===undefined?"—":signed(focus.net20/1e8)} 亿元</b></p>
    {index<from&&<p className="fine">所选日期早于图表最近 120 日范围；卡片、数值和阶梯已同步至 {focus.date}。</p>}
  </div>;
}
export default function MarginPanel(){
  const {snapshot,points,index,loading,error,refresh,marketDate,setLadderKey}=useMargin(),p=points[index];
  return <section className="panel margin-panel" id="margin"><div className="panel-header"><div><p className="eyebrow">MARGIN FINANCING / 杠杆资金</p><h3>融资与杠杆</h3><p className="margin-subtitle">规模、增减、参与强度 · 沪深汇总，含 ETF 等融资标的</p></div>
    <div className="flow-actions"><MarginDownload/><button className="data-export icon-only" onClick={refresh} disabled={loading} aria-label="刷新融资数据"><RefreshCw size={14} className={loading?"spinning":""}/></button></div></div>
    {p&&snapshot?<><div className="margin-session"><strong>融资统计 · {p.date}</strong><span>最新完整数据 {snapshot.asOf} · {points.length} 个交易日历史</span></div>
      {marketDate&&snapshot.asOf<marketDate&&<p className="fine margin-date-note">行情日期 {marketDate}；融资汇总最新完整日期 {snapshot.asOf}。沪深按共同统计日合并，周五深市数据通常在下周一发布。</p>}
      <div className="margin-cards">
        <article className="margin-stat"><div className="margin-stat-title">融资余额<MarginDownload metric="balance" compact/></div><div className="margin-number">{wan(p.balance)}<small>万亿元</small></div><LadderBadge metric="balance"/><p>两融总额 {wan(p.total)} 万亿元<br/>融券余额 {yi(p.short)} 亿元</p><a href="#margin-reference" onClick={()=>setLadderKey("balance")}>规模刻度 · 解读参考</a></article>
        <article className="margin-stat"><div className="margin-stat-title">融资净买入<MarginDownload metric="net" compact/></div><div className="margin-number">{signed(p.net/1e8)}<small>亿元</small></div><span className="metric-mark neutral">{p.streak===0?"当日净额为零":`连续 ${Math.abs(p.streak)} 日${p.streak>0?"净买入":"净偿还"}`}</span><p>近 5 日 {p.net5===undefined?"—":signed(p.net5/1e8)} 亿元<br/>近 20 日 {p.net20===undefined?"—":signed(p.net20/1e8)} 亿元</p><a href="#margin-method">负债增减 · 解读参考</a></article>
        <article className="margin-stat"><div className="margin-stat-title">融资交易强度<MarginDownload metric="intensity" compact/></div><div className="margin-number">{p.intensity===undefined?"—":numeric(p.intensity)}<small>% · 代理口径</small></div><LadderBadge metric="intensity20"/><p>20 日平滑值 {p.intensity20===undefined?"—":numeric(p.intensity20)}%<br/>融资买入额 ÷ 同日股票行情成交额</p><a href="#margin-reference" onClick={()=>setLadderKey("intensity20")}>参与刻度 · 解读参考</a></article>
        <article className="margin-stat"><div className="margin-stat-title">融资余额增速<MarginDownload metric="growth20" compact/></div><div className="margin-number">{p.growth20===undefined?"—":signed(p.growth20)}<small>% / 20 交易日</small></div><LadderBadge metric="growth20"/><p>相对 20 个交易日前的余额<br/>正值为扩张，负值为收缩</p><a href="#margin-reference" onClick={()=>setLadderKey("growth20")}>增速刻度 · 解读参考</a></article>
      </div><MarginCharts/>
      <p className="fine margin-proxy-note"><strong>口径：</strong>融资买入包含股票、ETF 等证券；分母为腾讯沪深指数所带的股票市场成交额，因此“交易强度”是可比历史代理比值，不是严格股票融资占比，不与股票专属占比阈值混用。净偿还可来自现金还款，不等同卖股流出。</p>
      <details className="margin-audit"><summary>来源与核验 · {new Date(snapshot.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}（北京时间）</summary><p>余额与买入、偿还历史：<a href={marginSources.em} target="_blank" rel="noreferrer">东方财富交易所汇总记录</a>；<a href={marginSources.sh} target="_blank" rel="noreferrer">上交所</a>核验 {snapshot.checks.officialSh} 日的余额、买入和两融合计，<a href={marginSources.sz} target="_blank" rel="noreferrer">深交所</a>核验日 {snapshot.checks.officialSzDates.join("、")}；同日股票行情：<a href={marginSources.tencent} target="_blank" rel="noreferrer">腾讯财经</a>。源最新日期：沪 {snapshot.sourceDates.sh}、深 {snapshot.sourceDates.sz}。采集 {snapshot.checks.requests} 次请求／{snapshot.checks.seconds.toFixed(2)} 秒；独立脚本，无大模型参与。</p>{(p.sh.repayInferred||p.sz.repayInferred)&&<p>所选日使用交易所备用模式，偿还额由前日余额、买入和当日余额推算，净买入反映负债变化。深市按官方公布精度；CSV 保留沪市偿还原值及推算标记，供核对差异。</p>}</details>
    </>:<p className="empty">{loading?"正在读取已核验融资历史…":"暂无通过校验的融资数据"}</p>}
    {error&&<p className="fine" role="status">{error}</p>}
  </section>;
}

const explanations:Record<LadderKey,string[]>={
  balance:["融资占用规模处于历史低位；不等于市场底部。","融资占用规模低于多数历史时期；结合增减方向观察。","融资规模接近历史中间水平，单独不指向行情方向。","融资规模相对较大；是否拥挤还需看参与强度。","融资规模处于历史高位；不等于立即见顶。"],
  intensity20:["融资买入相对股票成交较弱；不等于已经见底。","融资参与程度偏低，回升时可观察修复是否持续。","融资参与程度接近历史中间水平，无明确冷热倾向。","融资参与较活跃，可能伴随行情延续，也可能累积拥挤。","融资参与处于历史高位；需结合净买入及价格，不能据此直接判断顶部。"],
  growth20:["余额变化速度处于历史低位；先看实际增幅的正负。","余额变化速度偏低；正值仍是扩张，负值才是收缩。","余额增速接近历史中间水平，不代表风险为零。","余额增速处于较高位置；结合净买入持续性观察。","余额增速处于历史高位；若为正值，说明扩张较快，并非自动卖出信号。"],
};
export function MarginReference(){
  const {points,index,snapshot,ladderKey:key,setLadderKey:setKey}=useMargin();
  const ladder=useMemo(()=>marginLadder(points,index,key),[points,index,key]);
  const display=(v:number)=>key==="balance"?`${wan(v)} 万亿`:`${numeric(v,2)}%`;
  return <section className="margin-reference" id="margin-reference"><div className="margin-ref-heading"><div><p className="eyebrow">DATA LADDER / 数据阶梯</p><h4>融资与杠杆 · 阶梯参考</h4></div><span>{points[index]?.date??"等待数据"} · 与上方所选日期同步</span></div>
    <p className="fine">根据选定日前最多三年的历史数据划分五档，直接显示实际金额或百分比区间。分档用于观察相对历史位置，尚未验证买卖胜率；规模高不直接等于市场热。</p>
    <div className="chart-tabs margin-reference-tabs" role="group" aria-label="融资阶梯指标">{([["balance","融资规模"],["intensity20","融资参与 · 20 日平滑"],["growth20","20 日增速"]] as const).map(([metric,label])=><button key={metric} aria-pressed={key===metric} className={key===metric?"active":""} onClick={()=>setKey(metric)}>{label}</button>)}</div>
    {ladder?<><div className="margin-ladder-current">当前 <strong>{display(ladder.value)}</strong><span>{ladderLabels[key][ladder.band]}</span></div>
      <ol className="margin-ladder">{ladderLabels[key].map((label,i)=>{const range=i===0?`＜ ${display(ladder.bounds[0])}`:i===4?`≥ ${display(ladder.bounds[3])}`:`${display(ladder.bounds[i-1])} — ＜ ${display(ladder.bounds[i])}`;
        return <li key={label} className={i===ladder.band?"active":""}><div><span className="margin-step">{i+1}</span><strong>{range}</strong><b>{label}</b>{i===ladder.band&&<em>所选日</em>}</div><p>{explanations[key][i]}</p></li>;})}</ol>
    </>:<p className="empty">至少需要所选日前 252 个有效交易日，才展示阶梯。{snapshot?"可拖动上方滑轨选择近期日期。":"数据通过核验后显示。"}</p>}
    <details className="margin-research"><summary>分档方法与历史样本</summary><p>使用所选日前最多三年的有效历史数据，至少需要 252 个交易日；以 P20／P40／P60／P80 为边界划分五档。P80 表示高于约八成历史观测，不是上涨概率或买卖信号。</p>{ladder&&<p>校准样本 {ladder.start}—{ladder.end}，{ladder.count} 个有效交易日。所选值的历史位置为 P{ladder.rank.toFixed(1)}。</p>}<p>样本不含所选日及之后的数据，历史查看不使用未来数据。区间显示值四舍五入，分档使用原始精度。</p></details>
    <div className="margin-method" id="margin-method"><strong>指标与边界</strong><p>融资净买入＝融资买入额－偿还额；近 5／20 日为完整交易日累计。净偿还可能是现金还款；两融汇总不覆盖全部场外杠杆。融资交易强度采用上方明示的代理口径，仅在相同口径历史内比较。正增幅才是余额扩张，不能仅因增速处于高档就称为“快速扩张”。</p><p>原有指南针、北极星和资金温度计属于经验观察规则；新增阶梯是相对历史刻度，均不直接生成买卖指令。政策和融资标的范围变化会影响历史可比性。</p></div>
    <details className="margin-research"><summary>研究依据与来源</summary>{marginResearch.map(r=><p key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.date} · {r.page}<br/>{r.note}</p>)}<p><a href="https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20260114_10805178.shtml" target="_blank" rel="noreferrer">2026 年融资保证金政策调整</a>：制度变化可能影响不同阶段的指标水平，历史分位不保证预测能力。</p></details>
  </section>;
}
