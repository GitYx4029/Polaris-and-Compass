"use client";
import {useEffect,useState} from "react";
import EtfFlows from "./EtfFlows";
import EtfBasket from "./EtfBasket";
export default function EtfSection(props:{refreshKey?:string;marketDate?:string}){
  const [view,setView]=useState<"ranking"|"basket">("ranking"),[opened,setOpened]=useState(false);
  useEffect(()=>{if(location.hash==="#etf-basket"){setOpened(true);setView("basket");}const reveal=(event:Event)=>{const id=(event as CustomEvent<string>).detail;if(id==="etf-basket"){setOpened(true);setView("basket");}if(id==="etf-inflows")setView("ranking");};document.addEventListener("polaris:reveal",reveal);return()=>document.removeEventListener("polaris:reveal",reveal);},[]);
  return <div className="etf-explorer"><div className="etf-section-tabs" role="tablist" aria-label="ETF资金流观察"><button id="etf-ranking-tab" role="tab" aria-selected={view==="ranking"} aria-controls="etf-ranking-panel" onClick={()=>setView("ranking")}>净流入前20</button><button id="etf-basket-tab" role="tab" aria-selected={view==="basket"} aria-controls="etf-basket-panel" onClick={()=>{setOpened(true);setView("basket");}}>汇金相关宽基</button></div><div id="etf-ranking-panel" role="tabpanel" aria-labelledby="etf-ranking-tab" hidden={view!=="ranking"}><EtfFlows {...props}/></div><div id="etf-basket-panel" role="tabpanel" aria-labelledby="etf-basket-tab" hidden={view!=="basket"}>{opened?<EtfBasket/>:<div id="etf-basket"/>}</div></div>;
}
