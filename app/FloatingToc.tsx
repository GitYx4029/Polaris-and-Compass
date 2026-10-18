"use client";

import { ChevronDown, List } from "lucide-react";
import { useEffect, useState } from "react";
import { navigationGroups } from "@/lib/navigation";

export default function FloatingToc() {
  const [active,setActive]=useState<string>(navigationGroups[0].id);
  useEffect(()=>{
    let frame=0,revealFrame=0;
    const track=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const seen=navigationGroups.filter(group=>(document.getElementById(group.id)?.getBoundingClientRect().top??Infinity)<=140);
        setActive((seen.at(-1)??navigationGroups[0]).id);
      });
    };
    const reveal=(hash:string)=>{
      let id:string;try{id=decodeURIComponent(hash.slice(1));}catch{return;}
      const target=document.getElementById(id);if(!target)return;
      for(let node:HTMLElement|null=target;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)node.open=true;
      document.dispatchEvent(new CustomEvent("polaris:reveal",{detail:id}));
      cancelAnimationFrame(revealFrame);
      revealFrame=requestAnimationFrame(()=>target.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"}));
    };
    const onHash=()=>reveal(window.location.hash);
    const onLink=(event:MouseEvent)=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const link=(event.target as Element).closest("a[href^='#']");
      if(link)reveal(link.getAttribute("href")!);
    };
    document.addEventListener("click",onLink,true);
    window.addEventListener("hashchange",onHash);
    window.addEventListener("scroll",track,{passive:true});window.addEventListener("resize",track);
    onHash();track();
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(revealFrame);document.removeEventListener("click",onLink,true);window.removeEventListener("hashchange",onHash);window.removeEventListener("scroll",track);window.removeEventListener("resize",track);};
  },[]);
  return <details className="floating-toc" onKeyDown={event => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="展开或收起页面目录"><List size={18}/><span>目录</span><ChevronDown size={16}/></summary>
    <nav aria-label="页面目录" onClick={event => {
      if ((event.target as HTMLElement).closest("a")) {
        const directory = event.currentTarget.closest("details");
        if (directory) directory.open = false;
      }
    }}>
      <p>快速跳转</p>
      <ol className="toc-groups">{navigationGroups.map(group => <li key={group.number}>
        <a href={`#${group.id}`} aria-current={active===group.id?"location":undefined}><span>{group.number}</span><strong>{group.title}</strong>{active===group.id&&<small>当前</small>}</a>
      </li>)}</ol>
    </nav>
  </details>;
}
