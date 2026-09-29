// Pure checks shared by the collector and its offline regression test.
export function unchangedClosedSession(latest,beijing,prior,sh,sz){
  const last=prior.history?.at(-1);
  return latest<beijing&&prior.asOf===latest&&last?.date===latest&&
    last.sh===sh&&last.sz===sz;
}

export function alreadyVerifiedClose(latest,beijing,prior,sh,sz){
  const last=prior.history?.at(-1);
  return latest===beijing&&prior.asOf===latest&&last?.date===latest&&
    last.sh===sh&&last.sz===sz&&last.star>0&&
    last.starSource==='上海证券交易所分类成交'&&last.etf>0&&
    last.etfSource==='腾讯财经全代码段报价'&&last.etfCount>500&&
    prior.quoteAt?.every(stamp=>stamp?.startsWith(latest)&&stamp.slice(11)>='15:15')&&
    prior.generatedAt&&new Date(prior.generatedAt).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(11,16)>='15:25';
}

export function alignedQuoteDates(latest,shAt,szAt){
  const expected=latest.replaceAll('-','');
  return [shAt,szAt].every(stamp=>/^\d{14}$/.test(stamp??'')&&stamp.slice(0,8)===expected);
}
