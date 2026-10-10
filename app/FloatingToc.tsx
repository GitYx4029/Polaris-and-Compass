"use client";

import { ChevronDown, List } from "lucide-react";
import { navigationGroups } from "@/lib/navigation";

export default function FloatingToc() {
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
      <a className="toc-extra" href="#daily-quote">今日投资观点 · 分享</a>
      <ol className="toc-groups">{navigationGroups.map(group => <li key={group.number}>
        <div className="toc-group-title"><span>{group.number}</span><strong>{group.title}</strong></div>
        <ul>{group.links.map(link => <li key={link.id}><a href={`#${link.id}`}>{link.label}</a></li>)}</ul>
      </li>)}</ol>
      <a className="toc-extra toc-library" href="#quote-library">投资观点库 · 下载</a>
    </nav>
  </details>;
}
