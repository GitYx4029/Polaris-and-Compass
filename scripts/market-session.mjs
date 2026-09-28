// Pure checks shared by the collector and its offline regression test.
export function unchangedClosedSession(latest,beijing,prior,sh,sz){
  const last=prior.history?.at(-1);
  return latest<beijing&&prior.asOf===latest&&last?.date===latest&&
    last.sh===sh&&last.sz===sz;
}

export function alignedQuoteDates(latest,shAt,szAt){
  const expected=latest.replaceAll('-','');
  return [shAt,szAt].every(stamp=>/^\d{14}$/.test(stamp??'')&&stamp.slice(0,8)===expected);
}
