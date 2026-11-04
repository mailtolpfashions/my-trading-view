// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { positionMargin } from '@mtv/options';
import { spanOn } from '../../src/fno/span';
const U='NIFTY', SLIP=100;
const meta=await prisma.fnoDayMeta.findMany({where:{underlying:U},select:{date:true,spotPaise:true,lotSize:true},orderBy:{date:'asc'}});
const dates=meta.map(m=>m.date), idx=new Map(dates.map((d,i)=>[d,i])), M=new Map(meta.map(m=>[m.date,m]));
const today=meta.at(-1)!, todayN=today.spotPaise!*65, T=today.spotPaise!/100;
const exps=(await prisma.fnoEod.findMany({where:{underlying:U,kind:'CE'},distinct:['expiry'],select:{expiry:true}})).map(r=>r.expiry).filter(e=>idx.has(e)).sort();
const last=new Map<string,string>();for(const e of exps)last.set(e.slice(0,7),e);const monthly=[...last.values()];
const weekly=exps.filter(e=>e>='2019-03-01');
type R={kind:string,strikePaise:number,closePaise:number,traded:boolean};
const load=async(d:string,e:string)=>(await prisma.fnoEod.findMany({where:{underlying:U,date:d,expiry:e,kind:{in:['CE','PE']},traded:true,closePaise:{gt:0}},select:{kind:true,strikePaise:true,closePaise:true,traded:true}})) as R[];
function build(rows:R[],spot:number,shortPct:number,wingPct:number,capPct:number|null){
 const legs:{r:R,q:number}[]=[];
 for(const [k,s] of [['CE',1],['PE',-1]] as const){
  const c=rows.filter(r=>r.kind===k), near=(t:number)=>[...c].sort((a,b)=>Math.abs(a.strikePaise-t)-Math.abs(b.strikePaise-t))[0];
  const sh=near(spot*(1+s*shortPct)), w=near(sh?.strikePaise+s*spot*wingPct);
  if(!sh||!w||w===sh) return null;
  const beyond=c.filter(r=>s*(r.strikePaise-w.strikePaise)>0).sort((a,b)=>Math.abs(a.closePaise-w.closePaise/2)-Math.abs(b.closePaise-w.closePaise/2));
  const two=beyond[0]; if(!two) return null;
  legs.push({r:sh,q:-1},{r:w,q:1},{r:two,q:-2});
  if(capPct!=null){const cap=near(two.strikePaise+s*spot*capPct); if(!cap||cap===two) return null; legs.push({r:cap,q:2});}
 }
 return legs;
}
const shortPct=400/T;
const variants=[['no final hedge',null],['final 2x hedge 500 pts out',500/T]] as const;
for(const [name,list,before] of [['Weekly, 4 days',weekly,4],['Monthly, 10 days',monthly,10],['Monthly, 20 days',monthly,20]] as const){
 // moves over the holding period, as % then in today's points
 const mv:number[]=[];
 for(const e of list){const i=idx.get(e)!-before;if(i<0)continue;const a=M.get(dates[i])!.spotPaise,b=M.get(e)!.spotPaise;if(a&&b)mv.push(Math.abs(b/a-1));}
 mv.sort((a,b)=>a-b);const q=(p:number)=>Math.round(mv[Math.floor(mv.length*p)]*T);
 console.log(`\n${name}: move in today's points  median ${q(.5)} | 80% ${q(.8)} | 90% ${q(.9)} | 99% ${q(.99)} | worst ${Math.round(mv.at(-1)!*T)} | average ${Math.round(mv.reduce((a,b)=>a+b,0)/mv.length*T)}`);
 for(const wingPts of [200,400]) for(const [vn,cap] of variants){
  const out:number[]=[];const years:Record<string,number>={};let skip=0,inside=0,creditSum=0;
  for(const e of list){
   const i=idx.get(e)!-before;if(i<0)continue;const d=dates[i],m=M.get(d)!,ST=M.get(e)!.spotPaise;if(!m.spotPaise||!m.lotSize||!ST){skip++;continue}
   const rows=await load(d,e);const legs=build(rows,m.spotPaise,shortPct,wingPts/T,cap);if(!legs){skip++;continue}
   const lot=m.lotSize;let gross=0,ch=0,credit=0;
   for(const {r,q} of legs){const qty=Math.abs(q)*lot,side=q<0?'SELL':'BUY';const px=q<0?Math.max(5,r.closePaise-SLIP):r.closePaise+SLIP;
    const intr=Math.max(0,r.kind==='CE'?ST-r.strikePaise:r.strikePaise-ST);
    gross+=(q<0?1:-1)*qty*(px-intr);credit+=(q<0?1:-1)*qty*px;
    ch+=computeOptionCharges({side:side as any,qty,premiumPaise:px,date:d}).total;if(q>0)ch+=exerciseStt(qty,intr,e);}
   const net=(gross-ch)*(todayN/(m.spotPaise*lot));out.push(net);creditSum+=credit*(todayN/(m.spotPaise*lot));(years[e.slice(0,4)]??=0);years[e.slice(0,4)]+=net;
  }
  const R=(p:number)=>Math.round(p/100),w=out.filter(x=>x>0),l=out.filter(x=>x<=0),sum=(a:number[])=>a.reduce((x,y)=>x+y,0);
  const aw=sum(w)/w.length,al=-sum(l)/l.length;
  const yrs=Object.values(years),bad=yrs.filter(x=>x<0).length;
  console.log(`  wing ${wingPts}, ${vn}: n ${out.length} skip ${skip} | won ${(w.length/out.length*100).toFixed(0)}% | avg credit ₹${R(creditSum/out.length)} | avg win ₹${R(aw)} | avg loss ₹${R(al)} (${(al/aw).toFixed(1)}x) | worst ₹${R(Math.min(...out))} | net ₹${R(sum(out))} | losing years ${bad}/${yrs.length}`);
 }
}
const D=today.date,span=(await spanOn(D,U))?.data?.[U];
for(const e of ['2026-11-17','2026-11-23']){
 const rows=await load(D,e);
 for(const cap of [null,500/T]){const legs=build(rows,today.spotPaise!,shortPct,200/T,cap);if(!legs){console.log(e,'cannot build');continue}
  const credit=legs.reduce((s,{r,q})=>s-q*r.closePaise,0)/100;
  console.log(`\n${e} ${cap?'with':'no'} final hedge, spot ${T}: `+legs.map(({r,q})=>`${q<0?'S':'B'}${Math.abs(q)} ${r.strikePaise/100}${r.kind}@${r.closePaise/100}`).join(', ')+` | credit ${credit.toFixed(2)} = ₹${Math.round(credit*65)}`);
  if(span){const res=positionMargin(span,legs.map(({r,q})=>({kind:r.kind,expiry:e,strike:r.strikePaise/100,qty:q*65,pricePaise:r.closePaise})) as any,today.spotPaise!,D);console.log('  margin ₹',Math.round(res.marginPaise/100),'missing',res.missing.length)}
 }
}
await prisma.$disconnect();process.exit(0);
