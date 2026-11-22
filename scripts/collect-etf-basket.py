"""Deterministic exchange shares + two independently delivered NAV sources.
No account, browser, AKShare, third-party Python package or LLM is required.
Bootstrap reads five years once. Subsequent runs only refresh recent shares;
old numerical records are kept and all NAV histories are date-reconciled.
"""
import concurrent.futures as futures
import datetime as dt
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

BJ=dt.timezone(dt.timedelta(hours=8))
REF='https://wwww1998.github.io/national-team-etf-flow/'
SSE='http://query.sse.com.cn/commonQuery.do'
SZSE='http://www.szse.cn/api/report/ShowReport'
SINA='https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/CaihuiFundInfoService.getNav'
EM='https://fund.eastmoney.com/pingzhongdata/'
CORE=set('510300 510310 510330 159919 510050 510100 510500 512500 159922 512100 159845 560010 159629 159915 159952 159977 588080 588050 159901 510180 510230 515800 560050'.split())
FUND_ROWS=[
 ('510300','沪深300ETF华泰柏瑞','沪深300'),('510310','沪深300ETF易方达','沪深300'),('510330','沪深300ETF华夏','沪深300'),('159919','沪深300ETF嘉实','沪深300'),('515330','沪深300ETF天弘','沪深300'),
 ('510050','上证50ETF华夏','上证50'),('510100','上证50ETF易方达','上证50'),('510500','中证500ETF南方','中证500'),('512500','中证500ETF华夏','中证500'),('159922','中证500ETF嘉实','中证500'),
 ('512100','中证1000ETF南方','中证1000'),('159845','中证1000ETF华夏','中证1000'),('560010','中证1000ETF广发','中证1000'),('159629','中证1000ETF富国','中证1000'),('159633','中证1000ETF易方达','中证1000'),
 ('159915','创业板ETF易方达','创业板'),('159952','创业板ETF广发','创业板'),('159977','创业板ETF天弘','创业板'),('588080','科创50ETF易方达','科创50'),('588050','科创50ETF工银','科创50'),('588000','科创50ETF华夏','科创50'),
 ('563360','A500ETF华泰柏瑞','中证A500'),('512050','A500ETF华夏','中证A500'),('563800','A500ETF广发','中证A500'),('563220','A500ETF富国','中证A500'),('159338','中证A500ETF国泰','中证A500'),('159352','A500ETF南方','中证A500'),('159361','A500ETF易方达','中证A500'),('159351','A500ETF嘉实','中证A500'),
 ('510180','上证180ETF华安','上证180'),('510230','上证180金融ETF国泰','上证180金融'),('159901','深证100ETF易方达','深证100'),('515800','中证800ETF汇添富','中证800'),('560050','MSCI中国A50ETF汇添富','MSCI中国A50')]
PROOFS={
 '510300':('2026-03-31','75',73513073833,'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-31/510300_20260331_W6CZ.pdf'),
 '510310':('2026-03-31','75',56148085529,'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-31/510310_20260331_K996.pdf'),
 '510330':('2026-03-31','68',42028022295,'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-31/510330_20260331_X8KM.pdf'),
 '159919':('2026-03-30','66',35498494985,'https://static.cninfo.com.cn/finalpage/2026-03-30/1225041523.PDF'),
 '510050':('2026-03-31','53',48759031776,'https://fund.chinaamc.com/upload/resources/file/2026/03/31/307c51be27a94352a14dde5399c89a81.pdf')}
CODES={f[0] for f in FUND_ROWS}
class Unavailable(RuntimeError):pass
def check(ok,message):
 if not ok:raise ValueError('ETF basket: '+message)
def number(value):
 n=float(str(value).replace(',','').strip());check(math.isfinite(n) and n>=0,'invalid amount');return n
def date(value):
 s=str(value).strip()[:10]
 if re.fullmatch(r'\d{8}',s):s=s[:4]+'-'+s[4:6]+'-'+s[6:]
 check(re.fullmatch(r'\d{4}-\d\d-\d\d',s) is not None and dt.date.fromisoformat(s).isoformat()==s,'invalid date');return s

class Client:
 def __init__(self):self.requests=0;self.lock=threading.Lock()
 def get(self,url,referer='https://www.sse.com.cn/'):
  error=None
  for attempt in range(2):
   try:
    with self.lock:self.requests+=1
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':referer,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=12) as response:
     check(int(response.headers.get('Content-Length','0'))<80_000_000,'response too large')
     body=response.read(80_000_001);check(len(body)<=80_000_000,'response too large');return body
   except (OSError,TimeoutError) as e:error=e
  raise Unavailable(f'{urllib.parse.urlsplit(url).hostname}: {error}')
 def json(self,url,referer='https://www.sse.com.cn/'):return json.loads(self.get(url,referer).decode('utf-8-sig'))

def parse_em(raw):
 match=re.search(r'\b(?:var\s+)?Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;',raw)
 check(match is not None,'unit NAV array missing')
 values={}
 for row in json.loads(match[1]):
  d=dt.datetime.fromtimestamp(number(row['x'])/1000,BJ).date().isoformat();v=number(row['y']);check(v>0,'nonpositive NAV')
  check(d not in values,'duplicate unit NAV date');values[d]=v
 check(len(values)>=2,'unit NAV history too short');return values

def parse_sina(payload):
 body=payload.get('result',{}).get('data',{});rows=body.get('data')
 check(isinstance(rows,list) and len(rows)>0,'Sina unit NAV response empty')
 total=int(body.get('total_num',len(rows)));check(total==len(rows),'Sina NAV history pagination incomplete')
 values={}
 for r in rows:
  d=date(r['fbrq']);check(d not in values,'duplicate Sina NAV date');v=number(r['jjjz']);check(v>0,'nonpositive Sina NAV');values[d]=v
 return values

def sse_day(client,day):
 out={};page=1
 while True:
  query={'sqlId':'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L','STAT_DATE':day,'isPagination':'true','pageHelp.pageSize':'2000','pageHelp.pageNo':str(page)}
  payload=client.json(SSE+'?'+urllib.parse.urlencode(query));rows=payload.get('result');check(isinstance(rows,list) and rows,'SSE shares empty: '+day)
  for r in rows:
   check(date(r['STAT_DATE'])==day,'SSE shares date mismatch');code=str(r['SEC_CODE']).strip().zfill(6)
   if code in CODES:
    value=number(r['TOT_VOL'])*10000;check(code not in out or abs(out[code]-value)<1,'conflicting SSE duplicate');out[code]=value
  meta=payload.get('pageHelp') or {};count=int(meta.get('pageCount',1));check(1<=count<=5,'SSE pagination abnormal')
  if page>=count:break
  page+=1
 check(out,'SSE target shares missing: '+day);return day,out

def read_xlsx(raw):
 ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
  sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));result=[]
  for row in sheet.findall('.//m:sheetData/m:row',ns):
   cells=[]
   for c in row.findall('m:c',ns):
    ref=re.match(r'[A-Z]+',c.attrib.get('r','A'))[0];index=0
    for char in ref:index=index*26+ord(char)-64
    while len(cells)<index:cells.append('')
    v=c.find('m:v',ns);text=v.text if v is not None else ''
    if c.attrib.get('t')=='s':text=strings[int(text)]
    elif c.attrib.get('t')=='inlineStr':text=''.join(c.find('m:is',ns).itertext())
    cells[index-1]=str(text or '').strip()
   result.append(cells)
 return result

def szse_range(client,start,end):
 query={'SHOWTYPE':'xlsx','CATALOGID':'scsj_fund_jjgm','TABKEY':'tab1','txtStart':start,'txtEnd':end,'jjlb':'ETF'}
 rows=read_xlsx(client.get(SZSE+'?'+urllib.parse.urlencode(query),'https://fund.szse.cn/'))
 header=next((r for r in rows[:8] if '基金代码' in r and '基金规模(份)' in r),None);check(header,'SZSE XLSX unit/columns changed')
 indices=[header.index(k) for k in ['日期','基金代码','基金规模(份)']];out={}
 for r in rows[rows.index(header)+1:]:
  if len(r)<=max(indices):continue
  code=r[indices[1]].strip().zfill(6)
  if code not in CODES:continue
  d=date(r[indices[0]]);check(start<=d<=end,'SZSE XLSX date mismatch');v=number(r[indices[2]])
  old=out.setdefault(d,{}).get(code);check(old is None or abs(old-v)<1,'conflicting SZSE duplicate');out[d][code]=v
 check(out,'SZSE target shares empty');return out

def main():
 began=time.monotonic();client=Client();now=dt.datetime.now(BJ);today=now.date();start=today.replace(year=today.year-5).isoformat()
 output=Path(os.getenv('ETF_BASKET_OUTPUT_DIR','public/data'))/'etf-basket.json';prior=None
 if output.exists():
  try:prior=json.loads(output.read_text());check(prior is None or prior.get('schemaVersion')==1,'old snapshot schema')
  except json.JSONDecodeError:raise ValueError('Existing basket JSON is damaged')
 navs={};inceptions={};calendar=set();crosschecks=0
 def nav_job(f):
  code=f[0];em=parse_em(client.get(EM+code+'.js','https://fund.eastmoney.com/').decode('utf-8-sig'))
  url=SINA+'?'+urllib.parse.urlencode({'symbol':code,'datefrom':start,'dateto':today.isoformat(),'page':1,'num':2000})
  other=parse_sina(client.json(url,'https://stock.finance.sina.com.cn/'));common=sorted(d for d in other if d in em)
  check(len(common)>=min(10,len(other)),'NAV sources have insufficient common dates '+code)
  # All overlapping dates are cheap to check, not only a few handpicked ones.
  for d in common:check(abs(em[d]-other[d])<=.00011,'independent unit NAV mismatch '+code+' '+d)
  return code,{d:v for d,v in em.items() if start<=d<=today.isoformat()},min(em),set(other)|set(em),len(common)
 with futures.ThreadPoolExecutor(max_workers=6) as pool:
  for code,values,inception,days,count in pool.map(nav_job,FUND_ROWS):
   navs[code]=values;inceptions[code]=inception;crosschecks+=count
   if code=='510300':calendar={d for d in days if start<=d<=today.isoformat()}
 dates=sorted(d for d in calendar if dt.date.fromisoformat(d).weekday()<5)
 check(len(dates)>=20,'trading calendar insufficient')
 old={r[0]:r for r in (prior or {}).get('rows',[])};shares={d:{} for d in dates};official_sh=set((prior or {}).get('checks',{}).get('officialShDates',[]));official_sz=set((prior or {}).get('checks',{}).get('officialSzDates',[]))
 if prior:
  check([f['code'] for f in prior['funds']]==[f[0] for f in FUND_ROWS],'pool version change requires explicit migration')
  for d in dates:
   if d in old:shares[d]={f[0]:old[d][1][i] for i,f in enumerate(FUND_ROWS) if old[d][1][i] is not None}
 sh_days=[d for d in dates if d not in official_sh or d>=dates[-5]]
 # Each request covers all Shanghai targets on one date. Bootstrap in bounded
 # parallelism; later runs normally need five requests, not five years again.
 with futures.ThreadPoolExecutor(max_workers=6) as pool:
  for j,(d,values) in enumerate(pool.map(lambda d:sse_day(client,d),sh_days)):
   for code,value in values.items():shares[d][code]=value
   official_sh.add(d)
   if j%100==0:print(json.dumps({'stage':'exchange-shares','done':j+1,'total':len(sh_days)}),flush=True)
 sz_start=dates[0] if not prior else dates[-5];cursor=dt.date.fromisoformat(sz_start);chunks=[]
 while cursor<=dt.date.fromisoformat(dates[-1]):
  finish=min(cursor+dt.timedelta(days=89),dt.date.fromisoformat(dates[-1]));chunks.append((cursor.isoformat(),finish.isoformat()));cursor=finish+dt.timedelta(days=1)
 # 90-day exports stay small; each is a single whole-market workbook.
 with futures.ThreadPoolExecutor(max_workers=2) as pool:
  for values in pool.map(lambda pair:szse_range(client,*pair),chunks):
   for d,funds in values.items():
    if d in shares:shares[d].update(funds);official_sz.add(d)
 funds=[]
 for code,name,category in FUND_ROWS:
  fund={'code':code,'name':name,'category':category,'group':'core' if code in CORE else 'extended','inception':inceptions[code]}
  if code in PROOFS:
   published,page,amount,url=PROOFS[code];fund['evidence']=[{'holder':'中央汇金投资／中央汇金资产管理（报告内具名账户合计）','asOf':'2025-12-31','publishedAt':published,'url':url,'shares':amount,'page':'2025年报 §9.2 · PDF第'+page+'页'}]
  funds.append(fund)
 rows=[[d,[shares[d].get(f[0]) for f in FUND_ROWS],[navs[f[0]].get(d) for f in FUND_ROWS]] for d in dates]
 # Latest full day needs adjacent calendar records and same-day NAV for every
 # active fund. A partially published date never advances the headline.
 cut=None
 for j in range(len(rows)-1,0,-1):
  d,q,v=rows[j];prev=rows[j-1][1]
  if all(f['inception']>d or q[i] is not None and v[i] is not None and prev[i] is not None for i,f in enumerate(funds)) and d in official_sh and d in official_sz:cut=j;break
 check(cut is not None,'no complete independently dated basket session')
 rows=rows[:cut+1];asof=rows[-1][0];check(not prior or asof>=prior['asOf'],'basket date regressed')
 snapshot={'schemaVersion':1,'asOf':asof,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z'),'poolVersion':'2026-11-22-core23-extended11','referenceUrl':REF,'funds':funds,'rows':rows,'sources':{'sh':SSE+'?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L','sz':SZSE+'?SHOWTYPE=xlsx&CATALOGID=scsj_fund_jjgm','nav':EM},'checks':{'requests':client.requests,'seconds':round(time.monotonic()-began,2),'officialShDates':sorted(d for d in official_sh if d<=asof),'officialSzDates':sorted(d for d in official_sz if d<=asof),'historyMode':'official','sampleChecks':crosschecks}}
 if asof<dates[-1]:snapshot['pending']={'checkedAt':snapshot['generatedAt'],'reason':'最新交易日的份额或同日净值尚未全部发布'}
 output.parent.mkdir(parents=True,exist_ok=True);temp=output.with_suffix('.tmp.json');temp.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))+'\n')
 # Shared UI/server validator is the final gate before atomic replacement.
 import subprocess
 subprocess.run(['node','--experimental-strip-types','scripts/verify-etf-basket.mjs',str(temp)],check=True)
 temp.replace(output)
 print(json.dumps({'asOf':asof,'funds':len(funds),'sessions':len(rows),'requests':client.requests,'seconds':snapshot['checks']['seconds'],'navCrosschecks':crosschecks,'bytes':output.stat().st_size}),flush=True)

if __name__=='__main__':main()
