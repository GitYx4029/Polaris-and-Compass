"use client";

import { ChevronDown, List } from "lucide-react";

const sections = [
  ["daily-quote", "今日投资观点"],
  ["overview", "成交额与资金温度"],
  ["rolling", "20 日累计与均量"],
  ["market-depth", "市场层级成交额"],
  ["etf-inflows", "ETF 净流入前 20"],
  ["market-trends", "各层级成交额趋势"],
  ["history", "近期交易日"],
  ["reference", "指标解读参考"],
  ["quote-library", "观点库下载"],
] as const;

export default function FloatingToc() {
  return <details className="floating-toc" onKeyDown={event => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="展开或收起页面目录"><List size={18}/><span>目录</span><ChevronDown size={16}/></summary>
    <nav aria-label="页面目录">
      <p>快速跳转</p>
      <ol>{sections.map(([id, label], index) => <li key={id}>
        <a href={`#${id}`} onClick={event => {
          const directory = event.currentTarget.closest("details");
          if (directory) directory.open = false;
        }}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>
      </li>)}</ol>
    </nav>
  </details>;
}
