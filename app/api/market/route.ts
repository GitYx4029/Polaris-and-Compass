import { composeDays, parseTencent, type MarketRow } from "@/lib/market";

export const runtime = "edge";
const API = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";
const SYMBOLS = ["sh000001", "sz399001"] as const;

async function get(symbol: typeof SYMBOLS[number]) {
  const url = new URL(API);
  url.searchParams.set("_var", `kline_${symbol}`);
  url.searchParams.set("param", `${symbol},day,,,300,qfq`);
  const response = await fetch(url, { cache:"no-store", signal: AbortSignal.timeout(7000), headers: {Accept:"*/*"} });
  if (!response.ok) throw new Error(`${symbol} upstream ${response.status}`);
  const raw = await response.text();
  const start = raw.indexOf("={");
  if (start < 0) throw new Error(`${symbol} response format`);
  return parseTencent(JSON.parse(raw.slice(start + 1).replace(/;\s*$/, "")), symbol);
}

export async function GET() {
  try {
    const [sh,sz] = await Promise.all(SYMBOLS.map(get));
    const dates = new Set([...sh.amounts.keys(),...sz.amounts.keys()]);
    const rows:MarketRow[] = [...dates].sort().map(date=>({date,sh:sh.amounts.get(date)??null,sz:sz.amounts.get(date)??null}));
    const days = composeDays(rows);
    const latest=days.at(-1);
    console.info("market-data-check",JSON.stringify({asOf:latest?.date,sh:latest?.sh,sz:latest?.sz,
      sessions:days.length,rolling20:latest?.roll20,quoteAt:[sh.quoteAt,sz.quoteAt]}));
    return Response.json({rows:rows.slice(-300),quoteAt:[sh.quoteAt,sz.quoteAt],source:"腾讯行情历史日线＋当日行情"},
      {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    console.warn("market-source-failed",String(error));
    return Response.json({error:"腾讯行情服务端连接失败；客户端将尝试直接读取。"},
      {status:503,headers:{"Cache-Control":"no-store"}});
  }
}
