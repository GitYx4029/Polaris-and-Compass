export type EtfFlowRow={rank:number;code:string;name:string;fullName:string;netInflowYi:number;
  turnoverYi:number;turnoverDate:string;providerQuoteDate:string;turnoverSourceUrl:string;sameDateCrossCheck:boolean};
export type EtfFlowSnapshot={schemaVersion:1;asOf:string;generatedAt:string;source:string;sourceUrl:string;
  method:string;universeCount:number;rankingDigest:string;
  checks:{rankingMatched:number;turnoverDateMatched:number;fundTypeConfirmed:number;sameDateCrossChecks:number};
  rows:EtfFlowRow[];collection:{requests:number;seconds:number}};

// Browser gate: a malformed or cross-date snapshot must never look like a valid ranking.
export function validEtfFlows(value:unknown):value is EtfFlowSnapshot{
  const x=value as EtfFlowSnapshot;
  const today=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  if(!x||x.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}$/.test(x.asOf)||x.asOf>today||
    !Number.isFinite(Date.parse(x.generatedAt))||x.source!=="证券之星 ETF 数据宝"||
    x.sourceUrl!=="https://fund.stockstar.com/etf/detail"||x.universeCount<500||
    x.checks?.rankingMatched!==20||x.checks?.turnoverDateMatched!==20||x.checks?.fundTypeConfirmed!==20||
    !Array.isArray(x.rows)||x.rows.length!==20)return false;
  const seen=new Set<string>();let previous=Infinity;
  return x.rows.every((row,i)=>{
    if(row.rank!==i+1||!/^(?:1[56]\d{4}|5\d{5})$/.test(row.code)||seen.has(row.code)||
      typeof row.name!=="string"||!row.name||typeof row.fullName!=="string"||!row.fullName||
      typeof row.netInflowYi!=="number"||!Number.isFinite(row.netInflowYi)||row.netInflowYi<=0||
      row.netInflowYi>previous||typeof row.turnoverYi!=="number"||!Number.isFinite(row.turnoverYi)||
      row.turnoverYi<=0||row.turnoverDate!==x.asOf)return false;
    previous=row.netInflowYi;seen.add(row.code);return true;
  });
}
