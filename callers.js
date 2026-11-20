/* The callers — Dash, Zippy, Mellow, Ripple, Sage (v2) + Flippy + The Chief (Pulse Board 3: same logic as Pulse Board 2, new beat schedule). PAPER-ONLY: no money, no Kalshi orders, ever.
   BEATS for Pulse Board 3 (seconds into each 15-minute Kalshi window). Zippy and Sage are FIXED (Ryann, 20 Nov): Zippy 4:00 8:00 12:00, Sage 5:00 10:00 13:00.
   Everyone else is unique, never on a Zippy/Sage beat, and at least 60 s from each other:
     Dash 1:00 6:00 11:00 · Ripple 2:00 9:30 13:30 · Mellow 3:00 7:00 12:30 · The Chief 8:30 (after Dash 6, Mellow 7, Zippy 8, Ripple 2, Sage 5) · Flippy 14:30 (last call, 30 s before settlement)
   EQUAL CAPABILITY: every caller gets the same shared reading vector (indicators.js) + what Grokky 1 & 2 picked and why, and runs the same decide()/confidence()/memory code. Only the emphasis differs: each has a fixed 1.00 weight budget over seven groups
   (momentum, volume, chart, revert, flow, strike, grokky):
     Dash   mom .26 vol .20 chart .12 revert .04 flow .08 strike .20 grokky .10   (leans on what is available early; bolder: K 6, confidence x1.08)
     Zippy  mom .36 vol .06 chart .06 revert .04 flow .08 strike .30 grokky .10
     Mellow mom .06 vol .36 chart .06 revert .08 flow .04 strike .30 grokky .10   (volume surges, CVD, taker-buy share, plus some bounce-back)
     Ripple mom .06 vol .06 chart .36 revert .08 flow .04 strike .30 grokky .10   (EMA cross, VWAP, RSI, support/resistance, candles)
     Sage   mom .10 vol .12 chart .14 revert .06 flow .08 strike .40 grokky .10   (waits for the strike gap and crowd to confirm; K 3, confidence x0.92)
   FLIPPY is different on purpose: a risk-taker who ONLY calls when he is highly confident (>= 70/100, +5 per recent miss) that price is about to cross the strike AGAINST the current leader in the last minute; otherwise he sits out ("no flip seen"), and sitting out is never scored as a loss (it is tracked separately: did a flip really not come?). He reads the same shared vector (distance to strike in ATRs, momentum, acceleration, CVD/taker swing, order-book shift, Kalshi crowd price move) plus his own per-phase memory of which flip setups paid off. He is exempt from the 'skipped: too fast' gate (fast tape near the strike is what he hunts) but shows its reading.
   Every call has a confidence 0–100 (confidence()), short memory (last 5 settled calls; a group that leaned the wrong way in the last 2 is damped x0.7), a per-phase long memory (bounded group trust 0.8–1.2 after 15+ observations, reset when the market phase changes),
   and passes the volatility gate (indicators.js GATE): caution badge (confidence x0.75) or "skipped: too fast" (not scored, not a loss).
   Storage: pulseboard3.callers.v2 (new). pulseboard3.callers.v1 is only ever READ (archived view), never written. The Grokky Archive (archive.js) is fed one-way and never read by any decision code. */
(function(){
'use strict';
var KEY='pulseboard3.callers.v2',KEY1='pulseboard3.callers.v1',Q=900,GRACE=45,CAPR=60,SNAP=[4,8,12],CHIEF_MARGIN=0.15,PH_HOLD=600,PH_MIN=1800,DAMP=0.7,TRUST_MIN=15,FLIP_THR=70,FLIP_PICKY=5,FLIP_BASE=0.25,FLIP_NMIN=8;
var BEATS={dash:[60,360,660],zippy:[240,480,720],mellow:[180,420,750],ripple:[120,570,810],sage:[300,600,780],flippy:[870],chief:[510]};
var IDS=['dash','zippy','mellow','ripple','sage','flippy','chief'],REG=['dash','zippy','mellow','ripple','sage'];
var GL={momentum:'price momentum',volume:'volume & buyers vs sellers',chart:'chart shape',revert:'bounce-back',flow:'order flow',strike:'distance to strike & crowd',grokky:'the Grokkys’ evidence'};
var GI={momentum:'🚀',volume:'📊',chart:'🕯️',revert:'🔁',flow:'🌊',strike:'🎯',grokky:'🤝'};
var PROFILES={
  dash:{id:'dash',name:'Dash',style:'aggressive early',tag:'I call first and I call bold',lens:'momentum',blurb:'I’m the early bird. I make the first call of every window, so I lean on what I can already see: momentum and volume.',col:'#ff7a59',K:6,shape:1.08,w:{momentum:.26,volume:.20,chart:.12,revert:.04,flow:.08,strike:.20,grokky:.10}},
  zippy:{id:'zippy',name:'Zippy',style:'momentum',tag:'I ride the wave',lens:'momentum',blurb:'I love a trend. I give the most weight to which way price has been moving.',col:'#ffb454',K:4,shape:1,w:{momentum:.36,volume:.06,chart:.06,revert:.04,flow:.08,strike:.30,grokky:.10}},
  mellow:{id:'mellow',name:'Mellow',style:'volume',tag:'I follow the volume',lens:'volume',blurb:'I watch who’s really trading: volume surges, buyers vs sellers and taker-buy share, with a little bounce-back sense.',col:'#7bd88f',K:4,shape:1,w:{momentum:.06,volume:.36,chart:.06,revert:.08,flow:.04,strike:.30,grokky:.10}},
  ripple:{id:'ripple',name:'Ripple',style:'chart reader',tag:'I read the chart',lens:'chart',blurb:'I read the shape of the chart: EMA cross, VWAP, RSI, support and resistance, and candle patterns.',col:'#6cc3ff',K:4,shape:1,w:{momentum:.06,volume:.06,chart:.36,revert:.08,flow:.04,strike:.30,grokky:.10}},
  sage:{id:'sage',name:'Sage',style:'conservative confirmation',tag:'I wait for confirmation',lens:'strike',blurb:'I’m the careful one. I make my last call late and weigh the gap to the strike and the crowd most, so I only get confident when things line up.',col:'#c9a3ff',K:3,shape:0.92,w:{momentum:.10,volume:.12,chart:.14,revert:.06,flow:.08,strike:.40,grokky:.10}}};
PROFILES.flippy={id:'flippy',name:'Flippy',style:'late-flip gambler',tag:'I only bet on a late flip',lens:'strike',blurb:'I’m the big gambler. I sit out almost every window, and only speak up at 14:30 when I’m highly confident price is about to cross the strike against whoever is leading. No flip, no call.',col:'#ff5fb0',K:4,shape:1,w:{near:.30,mom:.18,acc:.10,cvd:.12,book:.08,crowd:.10,hist:.12}};
PROFILES.chief={id:'chief',name:'The Chief',style:'overall status',tag:'I weigh in once, after the early calls',lens:'strike',blurb:'I’m the one who reads the room. At minute 8:30 I look at the latest call from Dash, Zippy, Mellow, Ripple and Sage, weigh each of them by how sure it sounds and how it has been doing lately, and give one overall call. If it’s too close to call, I say so.',col:'#ffd35e',K:4,shape:1,w:{}};
var FEAT={trust:1,tod:1,news:1,gate:1,damp:1,bench:1};var REPLAY=false;
var FLW={near:'distance to the strike',mom:'late momentum against the leader',acc:'acceleration',cvd:'buyers-vs-sellers swing (CVD / taker share)',book:'order-book shift',crowd:'Kalshi crowd price moving',hist:'how similar flip setups paid off before'};
var H=null,ST=null,V1=null,LIVE=null,liveAt=0,_now=null,lastSave=0,SWAPPED=false;
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function num(x){var v=parseFloat(x);return isFinite(v)?v:NaN}
function nowS(){return _now!=null?_now:Math.floor(Date.now()/1000)}
function mmss(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2)}
function usd(x,d){return isFinite(x)?'$'+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:d==null?0:d,maximumFractionDigits:d==null?0:d}):'—'}
function arrow(d){return d==='UP'?'▲ UP':'▼ DOWN'}
function cls(d){return d==='UP'?'up-t':'dn-t'}
function opp(d){return d==='UP'?'DOWN':'UP'}
function sigm(x){return 1/(1+Math.exp(-x))}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function liUl(a){return a.length?'<ul>'+a.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':''}
function beatTxt(sec){return sec%60?Math.floor(sec/60)+':'+('0'+sec%60).slice(-2):String(sec/60)}
function grace(sec){return Math.max(10,Math.min(GRACE,Q-5-sec))}
function clock(t){return new Date(t*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}
function ago(s){s=Math.max(0,s);return s<90?'moments':s<5400?Math.round(s/60)+' min':(s/3600).toFixed(1)+' h'}

/* ---------- storage (own key only; v1 is read-only) ---------- */
function mkTot(id){var b=[];BEATS[id||'dash'].forEach(function(){b.push({n:0,w:0})});return {a:{n:0,w:0},b:b,g1:{n:0,w:0},g2:{n:0,w:0},sk:0,sit:{n:0,ok:0}}}
function fresh(){var t={},m={};IDS.forEach(function(i){t[i]=mkTot(i);m[i]=[]});return {v:2,since:nowS(),rounds:{},tot:t,ps:{},mem:m,sig:{},cb:{},phase:{n:0,cur:null,cand:null,hist:[]},rk:{},cal:{},tod:{},bench:{},hl:[]}}
function load(){if(ST)return ST;try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.v===2&&s.rounds&&s.tot){var f=fresh();IDS.forEach(function(i){if(!s.tot[i])s.tot[i]=f.tot[i];if(!s.tot[i].sit)s.tot[i].sit={n:0,ok:0};if(!s.mem||!s.mem[i]){s.mem=s.mem||{};s.mem[i]=[]}});['ps','sig','cb','rk','cal','tod','bench'].forEach(function(k){if(!s[k])s[k]={}});if(!s.hl)s.hl=[];if(!s.phase)s.phase=f.phase;ST=s;return s}}catch(e){}ST=fresh();return ST}
function save(force){if(REPLAY||SWAPPED)return;var t=Date.now();if(!force&&t-lastSave<1500)return;lastSave=t;try{localStorage.setItem(KEY,JSON.stringify(ST))}catch(e){}}
function loadV1(){if(V1!==null)return V1;V1=false;try{var s=JSON.parse(localStorage.getItem(KEY1)||'null');if(s&&s.tot&&s.rounds)V1=s}catch(e){}return V1}
function mkRound(W){var c={};IDS.forEach(function(i){c[i]=BEATS[i].map(function(){return null})});return {W:W,calls:c,miss:{},snaps:{},res:null,scored:false}}
function round(W,mk){var s=load();if(!s.rounds[W]&&mk){s.rounds[W]=mkRound(W);var ks=Object.keys(s.rounds).map(Number).sort(function(a,b){return a-b});while(ks.length>(REPLAY?600:CAPR))delete s.rounds[ks.shift()]}return s.rounds[W]||null}

/* ---------- inputs: the same for every caller ---------- */
function gks(){return (H&&H.state&&H.state().groks)||{}}
function kal(W){var kp=window.KalshiPanel,l=kp&&kp.last&&kp.last(),m=l&&l.current;if(!m)return {strike:NaN,mid:NaN};
  var w=Math.round(Date.parse(m.close_time)/1000)-Q;if(w!==W)return {strike:NaN,mid:NaN};
  var b=num(m.yes_bid_dollars),a=num(m.yes_ask_dollars),p=num(m.last_price_dollars),mid=(b>0&&a>0&&a<=1)?(b+a)/2:p;if(!(mid>0))mid=NaN;return {strike:num(m.floor_strike),mid:mid}}
function inputs(W,now){
  var D=window.PulseIndicators?PulseIndicators.feed():{cb:[],bn:[]},rec=gks()[W],g=null,k=kal(W),book=NaN;
  if(rec)g={g1:rec.g1,g2:rec.g2,pUp:rec.pUp,items:(rec.why&&rec.why.items||[]).filter(function(x){return x.src!=='ind'})};
  try{var sn=window.ContextPanel&&ContextPanel.snapshot&&ContextPanel.snapshot(W);if(sn&&sn.book&&isFinite(sn.book.imb))book=sn.book.imb}catch(e){}
  var fut=null;try{fut=window.PulseIndicators&&PulseIndicators.futView?PulseIndicators.futView():null}catch(e){}
  return {now:now,W:W,strike:k.strike,kmid:k.mid,cb:D.cb,bn:D.bn,g:g,ctx:{book:book},fut:fut};
}
function liveVec(W,now,force){if(!window.PulseIndicators)return null;if(!force&&LIVE&&LIVE.W===W&&now-liveAt<5)return LIVE;LIVE=PulseIndicators.compute(inputs(W,now));LIVE.W=W;liveAt=now;return LIVE}
function latest(W){return LIVE&&LIVE.ok&&LIVE.W===W?LIVE:null}

/* ---------- one shared decision function, five weight profiles ---------- */
function leansOf(sigs){return PulseIndicators.groupLean(sigs)}
/* mods: {damp:{group:factor}, trust:{group:factor}} from this caller's own memory. Weights are renormalised over the groups that can be read. */
function decide(leans,prof,d0,mods){
  mods=mods||{};var G=PulseIndicators.GROUPS,av=G.filter(function(g){return leans[g]&&leans[g].n>0});if(!av.length)return null;
  var w={},ws=0;av.forEach(function(g){w[g]=prof.w[g]*((mods.trust&&mods.trust[g])||1)*((mods.damp&&mods.damp[g])||1);ws+=w[g]});
  var sc=0,gc={},wn={};G.forEach(function(g){if(av.indexOf(g)>=0){wn[g]=w[g]/ws;var c=wn[g]*leans[g].lean;gc[g]=+c.toFixed(4);sc+=c}else{gc[g]=0;wn[g]=0}});
  var dir=sc>0?'UP':sc<0?'DOWN':(d0>=0?'UP':'DOWN');
  return {dir:dir,sc:+sc.toFixed(4),p:+sigm((prof.K||4)*sc).toFixed(4),gc:gc,w:wn};
}
/* confidence 0–100, from four visible drivers: strength of my score (55), agreement between the groups that have a view (30), how many groups I could read (15),
   then +/-8 for the earlier callers' calls this window (herding is NOT in the direction, only in how sure I feel), x0.75 if the volatility gate says caution, x my temperament (Dash 1.08, Sage 0.92). Clamped 5–95. */
function confidence(dec,leans,prof,gateLvl,crowd,tod){
  var G=PulseIndicators.GROUPS,av=G.filter(function(g){return leans[g]&&leans[g].n>0}),str=Math.min(1,Math.abs(dec.sc)/0.5);
  var vot=av.filter(function(g){return Math.abs(leans[g].lean)>=0.1}),tw=0,aw=0;vot.forEach(function(g){tw+=dec.w[g];if((leans[g].lean>0)===(dec.dir==='UP'))aw+=dec.w[g]});
  var agree=tw>0?aw/tw:0.5,cov=av.length/G.length,pStr=55*str,pAg=30*agree,pCov=15*cov;
  var adj=crowd&&crowd.tot>=2?Math.round((crowd.same/crowd.tot-0.5)*16):0,gf=gateLvl==='caution'?0.75:1,sh=prof.shape||1;
  tod=tod||0;var conf=clamp(Math.round((pStr+pAg+pCov+adj+tod)*gf*sh),5,95);
  return {conf:conf,parts:{str:+pStr.toFixed(1),agree:+pAg.toFixed(1),cov:+pCov.toFixed(1),adj:adj,tod:tod,gate:gf,shape:sh,strN:+Math.abs(dec.sc).toFixed(2),agreeN:vot.filter(function(g){return (leans[g].lean>0)===(dec.dir==='UP')}).length,agreeT:vot.length,covN:av.length,covT:G.length}};
}
function confWord(c){return c<35?'a shaky guess':c<55?'a lean':c<75?'fairly sure':'quite sure'}

/* ---------- memory: short (last 5) and per-phase long-term ---------- */
function memMods(id){
  var s=load(),m=(s.mem[id]||[]).slice(-5),last2=m.slice(-2),damp={},trust={},dl=[],tl=[],G=PulseIndicators.GROUPS;
  if(FEAT.damp&&last2.length===2)G.forEach(function(g){var wrong=last2.every(function(e){var l=e.gl&&e.gl[g];if(!l||Math.abs(l)<0.15)return false;var resUp=(e.dir==='UP')===e.ok;return (l>0)!==resUp});
    if(wrong){damp[g]=DAMP;dl.push({g:g,f:DAMP,why:'I leaned the wrong way on '+GL[g]+' in both of my last 2 settled calls, so I’m trusting it ×'+DAMP+' until it’s right again'})}});
  var ps=s.ps[id];if(ps&&ps.gr)G.forEach(function(g){var o=ps.gr[g];if(!o||o.n<TRUST_MIN)return;var a=(o.h+4)/(o.n+8),f=+clamp(1+2*(a-0.5),0.8,1.2).toFixed(2);if(Math.abs(f-1)>=0.02){trust[g]=f;tl.push({g:g,f:f,why:GL[g]+' has been right '+Math.round(o.h/o.n*100)+'% of the time in this phase ('+o.h+'/'+o.n+'), so I weigh it ×'+f})}});
  return {damp:damp,trust:trust,dl:dl,tl:tl,mem:m};
}

/* ---------- market phases ---------- */
var VOLW={calm:'Calm',normal:'Steady',wild:'Wild'},TRW={up:'uptrend',down:'downtrend',range:'sideways market'};
function phaseLabel(key){var p=key.split('/');return VOLW[p[0]]+' '+TRW[p[1]]}
function startPhase(reason,now,key){var P=load().phase,s=load();key=key||'normal/range';
  if(P.cur){P.hist.unshift({id:P.cur.id,start:P.cur.start,end:now,label:P.cur.label,reason:P.cur.reason,stats:(function(){var o={};IDS.forEach(function(i){var p=s.ps[i];o[i]=p?{n:p.n,w:p.w}:{n:0,w:0}});return o})()});while(P.hist.length>12)P.hist.pop()}
  s.ps={};P.n++;P.cur={id:P.n,start:now,key:key,label:phaseLabel(key),reason:reason};P.cand=null;save(true);return P.cur}
function detectPhase(reg,now){
  var P=load().phase,key=reg.vol+'/'+reg.trend;
  if(!P.cur){startPhase('first start with this feature',now,key);return {changed:true}}
  if(key===P.cur.key){if(P.cand){P.cand=null;save()}return {changed:false}}
  if(!P.cand||P.cand.key!==key){P.cand={key:key,since:now};save();return {changed:false}}
  if(now-P.cand.since>=PH_HOLD&&now-P.cur.start>=PH_MIN){var a=P.cur.key.split('/'),b=key.split('/'),r=[];
    if(a[0]!==b[0])r.push('volatility went from '+a[0]+' to '+b[0]+(reg.atrRatio?' (ATR '+reg.atrRatio+'× its median)':''));
    if(a[1]!==b[1])r.push('the trend went from '+TRW[a[1]]+' to '+TRW[b[1]]+(reg.trendZ!=null?' ('+(reg.trendZ>=0?'+':'−')+Math.abs(reg.trendZ)+'σ over the last hour)':''));
    startPhase(r.join(' and ')+', and it held for '+Math.round(PH_HOLD/60)+'+ minutes',now,key);return {changed:true}}
  return {changed:false}}
function newPhase(why,now){var v=LIVE&&LIVE.regime,key=v?v.vol+'/'+v.trend:(load().phase.cur?load().phase.cur.key:'normal/range');return startPhase(why||'started by hand',now==null?nowS():now,key)}

/* ---------- crowd ---------- */
function band(sec){var m=sec/60;return m<=5?'early':m<=10?'mid':'late'}
function bucket(reg,d,sec){return (reg&&reg.vol||'normal')+'|'+(isFinite(d)?(d>=0?'above':'below'):'none')+'|'+band(sec)}
function earlier(r,id,at){var o=[];REG.forEach(function(j){if(j===id||!r)return;var l=null;r.calls[j].forEach(function(c){if(c&&c.dir&&!c.shadow&&c.at<at&&(!l||c.at>l.at))l=c});if(l)o.push({id:j,dir:l.dir})});return o}
function crowdOf(list,dir){var same=list.filter(function(x){return x.dir===dir}).length;return {same:same,tot:list.length}}
function hist(bk,dir){var b=load().cb[bk];if(!b||!b.n)return {n:0};var k=dir==='UP'?'up':'dn';return {n:b.n,share:b[k]/b.n,right:b[k]?b[k+'Ok']/b[k]:null,rn:b[k]}}


/* ---------- Pulse Board 2 upgrades: trust weights, sessions, bench, calibration ---------- */
function memAcc(id){var m=(load().mem[id]||[]).slice(-5),w=m.filter(function(e){return e.ok}).length;return (w+1)/(m.length+2)}
/* trust weight 0.5x–1.5x from the last 5 settled calls (Laplace-smoothed: no history = 1.0x) */
function trustOf(id){return FEAT.trust?clamp(0.5+memAcc(id),0.5,1.5):1}
function sessionOf(W){var d=new Date(W*1000),m=d.getUTCHours()*60+d.getUTCMinutes();return m<120?'asia':(m>=420&&m<540)?'europe':(m>=810&&m<930)?'us':'off'}
var SESN={asia:'Asia hours',europe:'Europe hours',us:'US open',off:'Off-hours'};
function todNudge(id,W){if(!FEAT.tod)return {n:0,v:0,ses:sessionOf(W)};var ses=sessionOf(W),o=(load().tod[id]||{})[ses]||{n:0,w:0};
  return {ses:ses,n:o.n,w:o.w,v:o.n>=10?Math.round(clamp((o.w/o.n-0.5)*20,-5,5)):0}}
function benchOf(id){var b=load().bench[id];return b&&b.on?b:null}
function benchBegin(s,id,at,why){var b=s.bench[id]=s.bench[id]||{on:false,sh:[],log:[]};b.on=true;b.since=at;b.sh=[];b.why=why;b.log.unshift({at:at,why:why});while(b.log.length>8)b.log.pop()}
function calKey(c){return c<50?'lt50':c<60?'50':c<70?'60':c<80?'70':'80'}

/* ---------- firing a call ---------- */
function packTop(sigs,leans,w,dir,wantSame,n){return sigs.filter(function(x){return !x.na&&x.group!=='info'&&leans[x.group]&&leans[x.group].n&&Math.abs(w[x.group]*x.vote/leans[x.group].n)>0.002&&((x.vote>0)===(dir==='UP'))===wantSame})
  .sort(function(a,b){return Math.abs(w[b.group]*b.vote/leans[b.group].n)-Math.abs(w[a.group]*a.vote/leans[a.group].n)}).slice(0,n).map(function(x){return String(x.desc).slice(0,200)})}
function fire(W,id,i,now,inp){
  var r=round(W,true);if(r.calls[id][i]||(r.miss[id]&&r.miss[id][i]))return null;
  var v=inp?PulseIndicators.compute(inp):liveVec(W,now,true);if(!v||!v.ok)return null;
  var vis=v.signals.filter(function(s){return !s.na&&s.group!=='info'});if(!vis.length)return null;
  var P=PROFILES[id],sec=BEATS[id][i],leans=leansOf(v.signals),g=inp?inp.g:(function(){var rec=gks()[W];return rec?{g1:rec.g1,g2:rec.g2}:null})(),d0=isFinite(v.d)?v.d:0,gate0=v.gate||{level:'ok',triggers:[]},gate={level:gate0.level,triggers:gate0.triggers.slice(),range:gate0.range,rv:gate0.rv,cross:gate0.cross};
  if(!FEAT.gate){gate.level='ok';gate.triggers=[]}
  var nw=(FEAT.news&&window.PulseNews&&id!=='flippy')?PulseNews.near(now):null;
  if(nw){var dm=Math.round((nw.t-now)/60);gate.triggers.unshift('big news: '+nw.name+' '+(dm>=0?'comes out in '+dm+' min':'came out '+(-dm)+' min ago')+' ('+PulseNews.et(nw.t)+'), so this half hour can swing hard');if(gate.level==='ok')gate.level='caution'}
  var td=todNudge(id,W);
  var ph=load().phase.cur,reg=v.regime||{vol:'normal',trend:'range'};
  var c={i:i,sec:sec,at:now,px:+v.px.toFixed(2),strike:isFinite(v.strike)?v.strike:null,kmid:isFinite(v.kmid)?+v.kmid.toFixed(3):null,secs:W+Q-now,d:isFinite(v.d)?+v.d.toFixed(2):null,src:v.pxSrc,
    gate:{lvl:gate.level,tr:gate.triggers.slice(0,3),rg:gate.range,rv:gate.rv,cr:gate.cross},ph:ph?ph.id:0,reg:{vol:reg.vol,trend:reg.trend},bk:bucket(reg,v.d,sec),gk:g?{g1:g.g1,g2:g.g2}:null,news:nw?nw.k:null,td:id==='flippy'?null:{ses:td.ses,n:td.n,v:td.v}};
  if(id==='flippy'){flipEval(c,v,r,now,g)}
  else if(id==='chief'){chiefEval(c,v,r,now,g,gate,td)}
  else if(gate.level==='skip'){c.dir=null}
  else{
    var mm=memMods(id),dec=decide(leans,P,d0,{damp:mm.damp,trust:mm.trust});if(!dec)return null;
    var cr=crowdOf(earlier(r,id,now),dec.dir),cf=confidence(dec,leans,P,gate.level,cr,td.v);
    c.dir=dec.dir;c.sc=dec.sc;c.p=dec.p;c.gc=dec.gc;c.conf=cf.conf;c.cp=cf.parts;c.backs=g?(dec.dir===g.g1?1:2):0;c.crowd=cr;
    c.leans={};PulseIndicators.GROUPS.forEach(function(k){var l=leans[k];c.leans[k]=l&&l.n?{lean:+l.lean.toFixed(3),n:l.n}:{lean:0,n:0}});
    c.top=packTop(v.signals,leans,dec.w,dec.dir,true,4);c.opp=packTop(v.signals,leans,dec.w,dec.dir,false,3);
    c.cnt={all:v.signals.length,voted:vis.length,info:v.signals.filter(function(s){return !s.na&&s.group==='info'}).length,na:v.signals.filter(function(s){return s.na}).length};
    c.nas=v.signals.filter(function(s){return s.na&&s.group!=='info'}).slice(0,5).map(function(s){return s.name+': '+String(s.desc).slice(0,80)});
    c.damp=mm.dl;c.trust=mm.tl;c.mem=mm.mem.map(function(e){return {dir:e.dir,ok:e.ok}});
    c.sv={};vis.forEach(function(s){if(Math.abs(s.vote)>=0.1)c.sv[s.k]=+s.vote.toFixed(2)});
    var lensL=leans[P.lens],noG=0,wsn=0,sO=0;PulseIndicators.GROUPS.forEach(function(k){if(k!=='grokky'&&leans[k]&&leans[k].n){wsn+=P.w[k]}});PulseIndicators.GROUPS.forEach(function(k){if(k!=='grokky'&&leans[k]&&leans[k].n&&wsn)noG+=P.w[k]/wsn*leans[k].lean});
    c.alt={lens:lensL&&lensL.n&&Math.abs(lensL.lean)>=0.02?(lensL.lean>0?'UP':'DOWN'):null,nogk:wsn?(noG>=0?'UP':'DOWN'):null,strike:leans.strike&&leans.strike.n?(leans.strike.lean>=0?'UP':'DOWN'):null};
  }
  if(id!=='flippy'&&c.dir&&FEAT.bench&&benchOf(id)){c.shadow=1}
  r.calls[id][i]=c;save(true);
  if(!REPLAY)try{window.GrokkyArchive&&GrokkyArchive.logCall(W,id,sec,c.dir,c.sit?c.fconf:c.conf,c.sit?'sit':c.gate.lvl)}catch(e){}
  return c;
}

/* ---------- The Chief: one overall call at 8:30, built from the five callers' latest calls ---------- */
function chiefEval(c,v,r,now,g,gate,td){
  c.nc=1;c.dir=null;c.conf=0;c.vt=[];c.thr=CHIEF_MARGIN;
  REG.forEach(function(j){var l=null;r.calls[j].forEach(function(x){if(x&&x.dir&&!x.shadow&&x.at<now&&(!l||x.at>l.at))l=x});
    if(l){var tr=trustOf(j),a=memAcc(j);c.vt.push({id:j,dir:l.dir,conf:l.conf,sec:l.sec,acc:+a.toFixed(2),tr:+tr.toFixed(2),w:+(l.conf/100*tr).toFixed(3),ok5:(load().mem[j]||[]).slice(-5).filter(function(e){return e.ok}).length,n5:Math.min(5,(load().mem[j]||[]).length)})}});
  if(gate.level==='skip'){c.reason='gate';c.why='The market is moving too fast right now ('+gate.triggers.slice(0,2).join('; ')+'), so I’m not reading the room.';return}
  if(c.vt.length<3){c.reason='few';c.why='Only '+c.vt.length+' of the five callers have a usable call so far, and I want at least 3 before I weigh in.';return}
  var up=0,dn=0,hu=0,hd=0;c.vt.forEach(function(x){if(x.dir==='UP'){up+=x.w;hu++}else{dn+=x.w;hd++}});
  var tot=up+dn,sc=tot>0?(up-dn)/tot:0;c.score=+sc.toFixed(3);c.up=+up.toFixed(3);c.dn=+dn.toFixed(3);c.hu=hu;c.hd=hd;c.margin=+Math.abs(sc).toFixed(3);
  c.heads=hu===hd?null:(hu>hd?'UP':'DOWN');
  if(Math.abs(sc)<CHIEF_MARGIN){c.reason='split';c.why='The weighted vote is too close: UP '+Math.round(up/tot*100)+'% vs DOWN '+Math.round(dn/tot*100)+'% (a '+Math.round(Math.abs(sc)*100)+'-point gap, and I need '+Math.round(CHIEF_MARGIN*100)+').';return}
  var dir=sc>0?'UP':'DOWN',ag=c.vt.filter(function(x){return x.dir===dir}),dis=c.vt.filter(function(x){return x.dir!==dir});
  var sup=ag.reduce(function(a,x){return a+x.conf/100*x.tr/1.5},0)/ag.length;
  var pM=50*Math.min(1,Math.abs(sc)/0.6),pA=25*ag.length/c.vt.length,pS=25*Math.min(1,sup/0.6),gf=gate.level==='caution'?0.75:1;
  var conf=clamp(Math.round((pM+pA+pS+td.v)*gf),5,95);
  c.dir=dir;c.nc=0;c.conf=conf;c.p=+(dir==='UP'?0.5+conf/250:0.5-conf/250).toFixed(3);c.backs=g?(dir===g.g1?1:2):0;c.crowd={same:ag.length,tot:c.vt.length};
  c.cp={margin:+pM.toFixed(1),agree:+pA.toFixed(1),sup:+pS.toFixed(1),tod:td.v,gate:gf,agreeN:ag.length,agreeT:c.vt.length};
  c.disagree=dis.map(function(x){return x.id});c.agreeIds=ag.map(function(x){return x.id});
  var top=ag.slice().sort(function(a,b){return b.w-a.w})[0];
  c.why=PROFILES[top.id].name+(ag.length>1?' (and '+(ag.length-1)+' more)':'')+' lead the '+dir+' side'+(ag.length>1?'':'')+', carrying '+Math.round((dir==='UP'?up:dn)/tot*100)+'% of the weighted vote'+(dis.length?'; '+dis.map(function(x){return PROFILES[x.id].name}).join(' and ')+' disagree'+(dis.length===1?'s':''):'; nobody disagrees')+'.';
}
/* ---------- Flippy: the late-flip gambler ---------- */
function flipBucket(L,ad,momAgainst,reg){return (L>0?'lead-up':'lead-down')+'|'+(ad<0.3?'tight':ad<0.7?'close':'far')+'|'+(momAgainst?'mom-against':'mom-flat')+'|'+((reg&&reg.vol)||'normal')}
function flipPick(){var m=(load().mem.flippy||[]).slice(-2),miss=m.filter(function(e){return !e.ok}).length;return m.length===2?miss*FLIP_PICKY:(m.length&&!m[m.length-1].ok?FLIP_PICKY:0)}
function flipHist(bk){var p=load().ps.flippy,o=p&&p.fl&&p.fl[bk]||{n:0,h:0};return {n:o.n,h:o.h,p:(o.h+FLIP_BASE*4)/(o.n+4)}}
function flipEval(c,v,r,now,g){
  var S={};v.signals.forEach(function(s){S[s.k]=s});function vt(k){return S[k]&&!S[k].na?S[k].vote:0}
  c.thr=FLIP_THR+flipPick();c.pick=flipPick();c.leader=isFinite(v.d)?(v.d>=0?'UP':'DOWN'):null;c.sit=1;c.dir=null;c.fd=[];c.fconf=0;
  if(!c.leader||!isFinite(v.atrDist)){c.why='I can’t measure how far price is from the strike right now, so there’s nothing to flip.';return}
  var L=v.d>=0?1:-1,ad=Math.abs(v.atrDist),W=PROFILES.flippy.w,f={};
  f.near=clamp(1-ad/1,0,1);f.mom=clamp(-L*vt('mom'),0,1);f.acc=clamp(-L*vt('accel'),0,1);f.cvd=clamp(-L*(vt('cvd')+vt('tshare'))/2,0,1);f.book=clamp(-L*vt('book'),0,1);
  var k0=null;IDS.forEach(function(j){r.calls[j].forEach(function(x){if(x&&x.kmid!=null&&x.at<now&&(!k0||x.at<k0.at))k0=x})});
  var shift=k0&&isFinite(v.kmid)?v.kmid-k0.kmid:null;f.crowd=shift==null?0:clamp(-L*shift/0.10,0,1);
  c.bk2=flipBucket(L,ad,-L*vt('mom')>0.3,v.regime);c.mem=(load().mem.flippy||[]).slice(-5).map(function(e){return {dir:e.dir,ok:e.ok}});var hh=flipHist(c.bk2);f.hist=clamp(hh.p/0.5,0,1);
  var tot=0;c.fd=Object.keys(W).map(function(k){var pts=+(W[k]*f[k]*100).toFixed(1);tot+=pts;var note=
    k==='near'?'Price is '+usd(Math.abs(v.d),0)+' '+(L>0?'above':'below')+' the strike = '+ad.toFixed(2)+' ATR away with '+mmss(c.secs)+' left'+(ad>=1?' (too far to cross)':'')
    :k==='mom'?(S.mom?S.mom.desc:'no momentum reading'):k==='acc'?(S.accel?S.accel.desc:'no acceleration reading')
    :k==='cvd'?(S.cvd&&!S.cvd.na?S.cvd.desc:'no CVD reading')+(S.tshare&&!S.tshare.na?'; '+S.tshare.desc:'')
    :k==='book'?(S.book?S.book.desc:'no order-book reading')
    :k==='crowd'?(shift==null?'no earlier Kalshi price this window to compare with':'Kalshi’s UP price moved '+(shift>=0?'+':'−')+Math.abs(Math.round(shift*100))+'¢ since '+beatTxt(k0.sec)+' ('+(f.crowd>0?'toward the flip':'not toward a flip')+')')
    :'In this phase, setups like this one ('+bk2txt(c.bk2)+') flipped '+hh.h+' of '+hh.n+' times'+(hh.n<FLIP_NMIN?' (too few to trust, so I use a '+Math.round(FLIP_BASE*100)+'% starting guess)':'')+' → I rate it '+Math.round(hh.p*100)+'%';
    return {k:k,pts:pts,max:+(W[k]*100).toFixed(1),note:String(note).slice(0,230)}});
  c.fconf=clamp(Math.round(tot),0,95);c.fh={n:hh.n,h:hh.h,p:+hh.p.toFixed(3)};c.shift=shift;
  c.kmid2=isFinite(v.kmid)?+v.kmid.toFixed(3):null;
  if(f.near>0&&c.fconf>=c.thr){c.dir=L>0?'DOWN':'UP';c.sit=0;c.conf=c.fconf;c.p=+(c.dir==='UP'?0.5+c.conf/200:0.5-c.conf/200).toFixed(3);c.backs=g?(c.dir===g.g1?1:2):0}
  else c.why=f.near<=0?'Price is more than '+ad.toFixed(1)+' ATR from the strike, too far to cross in the time left.':'My flip score is '+c.fconf+'/100 and I need '+c.thr+' to speak up.';
}
function bk2txt(b){return b.replace(/\|/g,' · ')}
function tickMarks(now){
  var W=Math.floor(now/Q)*Q,changed=false;
  IDS.forEach(function(id){BEATS[id].forEach(function(sec,i){var due=W+sec;if(now<due)return;var rr=round(W,true);if(rr.calls[id][i]||(rr.miss[id]&&rr.miss[id][i]))return;
    if(now<=due+grace(sec)){if(fire(W,id,i,now))changed=true}
    else{(rr.miss[id]=rr.miss[id]||{})[i]='the page wasn’t open (or the feeds weren’t ready) in time';changed=true}})});
  SNAP.forEach(function(m){var due=W+m*60;if(now<due||now>due+GRACE)return;var rr=round(W,true);if(rr.snaps[m])return;var s=load(),o={};
    IDS.forEach(function(id){var t=s.tot[id],p=s.ps[id];o[id]={n:t.a.n,w:t.a.w,pn:p?p.n:0,pw:p?p.w:0}});rr.snaps[m]=o;changed=true});
  if(changed)save(true);
  try{if(window.GrokkyArchive)GrokkyArchive.tick(now,function(w,n){return liveVec(w,n,true)})}catch(e){}
  return changed;
}


/* after a REAL scored call: calibration bucket, session record, last-10 results (bench rule), badge counters */
function post(s,id,c,ok,r,ses,up){
  var cl=s.cal[id]||(s.cal[id]={}),k=calKey(c.conf),o=cl[k]||(cl[k]={n:0,w:0,sc:0});o.n++;if(ok)o.w++;o.sc+=c.conf;
  var td=s.tod[id]||(s.tod[id]={}),x=td[ses]||(td[ses]={n:0,w:0});x.n++;if(ok)x.w++;
  if(id!=='flippy'){var rk=s.rk[id]||(s.rk[id]=[]);rk.push(ok?1:0);while(rk.length>10)rk.shift();
    if(FEAT.bench&&!(s.bench[id]&&s.bench[id].on)){var l3=rk.slice(-3),sum=rk.reduce(function(a,b){return a+b},0);
      if(l3.length===3&&l3.join('')==='000')benchBegin(s,id,r.W+Q,'3 misses in a row');
      else if(rk.length>=10&&sum<4)benchBegin(s,id,r.W+Q,'under 40% over my last 10 ('+sum+'/10)')}}
  if(REPLAY||!window.PulseBadges)return;
  var led=false;if(c.gc&&PROFILES[id].lens){var mx=null,mk=null;Object.keys(c.gc).forEach(function(g){if(g==='grokky'&&false)return;var a=Math.abs(c.gc[g]);if(mx===null||a>mx){mx=a;mk=g}});led=mk===PROFILES[id].lens&&mx>0}
  var bp=false;if(id==='chief'&&c.vt){var right=c.vt.filter(function(v){return (v.dir==='UP')===up}).length;bp=right*2<=c.vt.length}
  PulseBadges.record({id:id,ok:ok,conf:c.conf,ses:ses==='off'?null:ses,led:led,vs:!!(c.crowd&&c.crowd.tot>=3&&id!=='chief'&&id!=='flippy'&&c.crowd.same*2<c.crowd.tot),bp:bp,flip:id==='flippy'})
}
function shadowScore(s,id,ok,r){var b=s.bench[id];if(!b)return;b.sh.push(ok?1:0);b.sh=b.sh.slice(-3);
  if(b.sh.length>=3&&b.sh.reduce(function(a,x){return a+x},0)>=2){b.on=false;b.sh=[];b.ret=r.W+Q;b.log.unshift({at:r.W+Q,why:'back from the bench (shadow calls went 2 for 3)'});while(b.log.length>8)b.log.pop();s.rk[id]=[];try{window.PulseBadges&&!REPLAY&&PulseBadges.returned(id)}catch(e){}}}
/* one plain-English line per settled window */
function histLine(r,up){
  var res=up?'UP':'DOWN',parts=[],right=[],tot=0,best=null;
  REG.forEach(function(j){var l=null;r.calls[j].forEach(function(c){if(c&&c.dir&&!c.shadow&&(!l||c.at>l.at))l=c});if(!l)return;tot++;var ok=(l.dir==='UP')===up;if(ok){right.push(PROFILES[j].name);if(!best||l.conf>best.conf)best={n:PROFILES[j].name,conf:l.conf,dir:l.dir}}});
  var ch=lastCall(r,'chief');
  parts.push('Kalshi settled '+res+'.');
  if(ch&&ch.dir&&!ch.shadow)parts.push('The Chief called '+ch.dir+' (confidence '+ch.conf+') and was '+((ch.dir==='UP')===up?'right ✓':'wrong ✗')+'.');
  else if(ch&&ch.nc)parts.push('The Chief said “no clear read”.');
  parts.push(tot?right.length+' of '+tot+' callers were right'+(right.length?' ('+right.join(', ')+')':'')+'.':'No regular caller made a scored call.');
  var fl=lastCall(r,'flippy');if(fl){if(fl.sit)parts.push('Flippy sat out'+(fl.leader?'; '+((up!==(fl.leader==='UP'))?'a flip did come, so he missed it':'no flip came, so he was right to wait'):'')+'.');else parts.push('Flippy bet on a flip and was '+((fl.dir==='UP')===up?'right 🎉':'wrong')+'.')}
  if(best)parts.push('Most confident right call: '+best.n+' ('+best.dir+', '+best.conf+').');
  return parts.join(' ');
}

/* ---------- scoring on Kalshi's real settlement (skips are never scored) ---------- */
function scoreRound(r){
  if(!r||r.scored||(r.res!=='yes'&&r.res!=='no'))return false;var s=load(),up=r.res==='yes',pid=s.phase.cur?s.phase.cur.id:0;
  var ses=sessionOf(r.W);
  IDS.forEach(function(id){var t=s.tot[id];r.calls[id].forEach(function(c,i){if(!c)return;
    if(c.shadow){if(c.dir)shadowScore(s,id,(c.dir==='UP')===up,r);return}
    if(id==='flippy'){var flipped=c.leader?(up!==(c.leader==='UP')):null,p0=null;if(c.ph===pid){p0=s.ps.flippy||(s.ps.flippy={n:0,w:0,b:[{n:0,w:0}],gr:{},fl:{},sit:{n:0,ok:0}});if(!p0.fl)p0.fl={};if(!p0.sit)p0.sit={n:0,ok:0}}
      if(c.sit){if(c.leader){t.sit.n++;if(!flipped)t.sit.ok++;if(p0){p0.sit.n++;if(!flipped)p0.sit.ok++}}}
      else{var okf=(c.dir==='UP')===up;t.a.n++;t.b[0].n++;if(okf){t.a.w++;t.b[0].w++}if(c.backs){var bf=t['g'+c.backs];bf.n++;if(okf)bf.w++}
        var mf=s.mem.flippy;mf.push({W:r.W,i:0,dir:c.dir,ok:okf,gl:{}});while(mf.length>5)mf.shift();post(s,id,c,okf,r,ses,up);if(p0){p0.n++;p0.b[0].n++;if(okf){p0.w++;p0.b[0].w++}}}
      if(p0&&c.bk2&&flipped!==null){var fo=p0.fl[c.bk2]||(p0.fl[c.bk2]={n:0,h:0});fo.n++;if(flipped)fo.h++}
      return}
    if(!c.dir){t.sk++;return}
    var ok=(c.dir==='UP')===up;t.a.n++;t.b[i].n++;if(ok){t.a.w++;t.b[i].w++}
    if(c.backs){var b=t['g'+c.backs];b.n++;if(ok)b.w++}
    var m=s.mem[id];m.push({W:r.W,i:i,dir:c.dir,ok:ok,gl:(function(){var o={};Object.keys(c.leans||{}).forEach(function(g){o[g]=c.leans[g].n?c.leans[g].lean:0});return o})()});while(m.length>5)m.shift();
    if(c.ph===pid){var p=s.ps[id]||(s.ps[id]={n:0,w:0,b:BEATS[id].map(function(){return {n:0,w:0}}),gr:{}});p.n++;p.b[i].n++;if(ok){p.w++;p.b[i].w++}
      Object.keys(c.leans||{}).forEach(function(g){var l=c.leans[g];if(!l.n||Math.abs(l.lean)<0.15)return;var o=p.gr[g]||(p.gr[g]={n:0,h:0});o.n++;if((l.lean>0)===up)o.h++})}
    post(s,id,c,ok,r,ses,up);
    if(c.bk){var b=s.cb[c.bk]||(s.cb[c.bk]={n:0,up:0,dn:0,upOk:0,dnOk:0});b.n++;var k=c.dir==='UP'?'up':'dn';b[k]++;if(ok)b[k+'Ok']++}
    Object.keys(c.sv||{}).forEach(function(k){var o=s.sig[k]||(s.sig[k]={n:0,h:0});o.n++;if((c.sv[k]>0)===up)o.h++})})});
  r.scored=true;
  if(!REPLAY){try{s.hl.unshift({W:r.W,t:histLine(r,up)});while(s.hl.length>96)s.hl.pop()}catch(e){}try{window.PulseBadges&&PulseBadges.finish(r.W+Q)}catch(e){}}
  return true;
}
function archSettle(W,res){try{window.GrokkyArchive&&GrokkyArchive.settle(W,res)}catch(e){}}
function onKalshi(d){var s=load(),ch=0;((d&&d.settled)||[]).forEach(function(m){var res=m.result;if(res!=='yes'&&res!=='no')return;var W=Math.round(Date.parse(m.close_time)/1000)-Q,r=s.rounds[W];archSettle(W,res);if(!r||r.scored)return;r.res=res;if(scoreRound(r))ch++});
  if(ch){save(true);update(true)}return ch}
function scoreFromGrokky(){var G=gks(),s=load(),ch=0;Object.keys(s.rounds).forEach(function(w){var r=s.rounds[w];if(r.scored)return;var g=G[w];if(g&&(g.kres==='yes'||g.kres==='no')){r.res=g.kres;archSettle(+w,g.kres);if(scoreRound(r))ch++}});if(ch)save(true);return ch}

/* ---------- plain-language explanation, grounded in the stored numbers ---------- */
function leanWord(l){return l>=.5?'strongly UP':l>=.15?'leans UP':l<=-.5?'strongly DOWN':l<=-.15?'leans DOWN':'is quiet'}
function sgnl(x){return (x>=0?'+':'−')+Math.abs(x).toFixed(2)}
function pcs(dir,p){return Math.round((dir==='UP'?p:1-p)*100)}
function lastCall(r,id){var l=null;if(r)r.calls[id].forEach(function(c){if(c&&(!l||c.at>l.at))l=c});return l}
function flipBubble(c){
  var h;if(c.sit)return '💤 <b>No flip seen.</b> '+esc(c.why||'')+' I sit this window out, and that’s never scored as a loss. I’ll be tracked on whether I was right to wait.';
  h='🎲 <b>I smell a flip!</b> '+c.leader+' is leading ('+usd(Math.abs(c.d),0)+' '+(c.d>=0?'above':'below')+' the strike), but I’m calling <b class="'+cls(c.dir)+'">'+arrow(c.dir)+'</b> at '+beatTxt(c.sec)+' with <b>confidence '+c.conf+'/100</b> (I needed '+c.thr+')';
  h+=c.backs?' and backing <b>Grokky '+c.backs+'</b>.':'. There’s no Grokky pick for this window, so I’m not backing anyone.';
  if(c.pick)h+=' I’ve been burned lately, so I raised my bar by '+c.pick+'.';return h}
function chiefBubble(c){
  var h;if(c.nc)return '🤷 <b>No clear read.</b> '+esc(c.why||'')+' I’m not scored on this one, and I’ll be back next window.';
  h='🧭 <b>Here’s my overall read: <span class="'+cls(c.dir)+'">'+arrow(c.dir)+'</span></b> at minute '+beatTxt(c.sec)+' with <b>confidence '+c.conf+'/100</b> ('+confWord(c.conf)+'). '+esc(c.why||'');
  h+=c.backs?' I’m backing <b>Grokky '+c.backs+'</b>.':' There’s no Grokky pick for this window, so I’m not backing anyone.';
  if(c.gate.lvl==='caution')h+=' ⚠️ '+(c.news?'Big US news is close':'The market is moving fast')+', so I’m less sure than usual.';
  if(c.shadow)h+=' 🪑 <b>I’m on the bench:</b> this call is a shadow call and doesn’t count yet.';
  return h}
function bubble(id,c){
  if(id==='flippy')return flipBubble(c);
  if(id==='chief')return chiefBubble(c);
  var P=PROFILES[id],h;
  if(!c.dir)return 'I’m sitting this one out at minute '+beatTxt(c.sec)+' — <b>skipped: too fast</b>. '+esc(c.gate.tr.join('; '))+'. A skip is never scored as a loss; I’ll look again at my next beat.';
  h='I’m calling <b class="'+cls(c.dir)+'">'+arrow(c.dir)+'</b> at minute '+beatTxt(c.sec)+' with <b>confidence '+c.conf+'/100</b> ('+confWord(c.conf)+')';
  h+=c.backs?' and backing <b>Grokky '+c.backs+'</b>.':'. There’s no Grokky pick for this window, so I’m not backing anyone.';
  if(c.gate.lvl==='caution')h+=c.news?' ⚠️ Big US news ('+esc(c.news)+') is close, so I’m less sure than usual.':' ⚠️ The market is moving fast, so I’m less sure than usual.';
  if(c.shadow)h+=' 🪑 <b>I’m on the bench</b>, so this is a shadow call: it doesn’t count until I earn my place back.';
  if(isFinite(c.d)&&c.strike!=null)h+=' Price is '+usd(Math.abs(c.d),0)+' '+(c.d>=0?'above':'below')+' the strike with '+mmss(c.secs)+' left.';
  var l=c.leans&&c.leans[P.lens];if(l&&l.n){h+=' My '+P.style+' lens ('+GL[P.lens]+') '+leanWord(l.lean);if(Math.abs(l.lean)>=.15&&(l.lean>0)!==(c.dir==='UP'))h+=', but the rest of the evidence outweighed it';h+='.'}
  if(c.damp&&c.damp.length)h+=' I’m going easy on '+c.damp.map(function(x){return GL[x.g]}).join(' and ')+' after it let me down twice.';
  return h;
}
function confHtml(c){var p=c.cp;
  return '<h4>Where my '+c.conf+'/100 confidence comes from</h4><ul>'
   +'<li><b>+'+Math.round(p.str)+'</b> of 55: my score is '+sgnl(c.dir==='UP'?p.strN:-p.strN)+' (it takes ±0.50 to max this out)</li>'
   +'<li><b>+'+Math.round(p.agree)+'</b> of 30: '+p.agreeN+' of the '+p.agreeT+' kinds of evidence that had a view agree with my call</li>'
   +'<li><b>+'+Math.round(p.cov)+'</b> of 15: I could read '+p.covN+' of '+p.covT+' evidence groups</li>'
   +(p.adj?'<li><b>'+(p.adj>0?'+':'−')+Math.abs(p.adj)+'</b>: '+(c.crowd.same)+' of the '+c.crowd.tot+' callers before me this window '+(p.adj>0?'agree':'don’t agree')+' (this nudges how sure I am, never which way I call)</li>':'<li>±0: fewer than 2 callers before me this window, so no crowd nudge</li>')
   +(p.tod?'<li><b>'+(p.tod>0?'+':'−')+Math.abs(p.tod)+'</b>: time of day, I’ve been '+(p.tod>0?'better':'worse')+' than 50% in this session ('+esc(SESN[c.td&&c.td.ses]||'')+', '+(c.td?c.td.n:0)+' calls so far)</li>':'')
   +(p.gate<1?'<li><b>×'+p.gate+'</b>: caution, the market is moving fast'+(c.news?' (big US news is close)':'')+'</li>':'')
   +(p.shape!==1?'<li><b>×'+p.shape+'</b>: my temperament ('+(p.shape>1?'I’m bold':'I’m careful')+')</li>':'')+'</ul>';
}
function flipWhy(c){
  var h='<h4>'+(c.sit?'Why I saw no flip':'Why I’m betting on a flip')+'</h4><p>I only speak up when price looks about to cross the strike <b>against the current leader</b> ('+esc(c.leader||'nobody')+'), and only when my flip score reaches <b>'+c.thr+'/100</b> (my base bar is '+FLIP_THR+'; each of my last 2 settled flip calls that missed raises it by '+FLIP_PICKY+').</p>';
  h+='<p>My flip score is <b>'+c.fconf+'/100</b>, built from seven kinds of evidence:</p><ul>'+c.fd.map(function(x){return '<li><b>'+x.pts+'</b> / '+x.max+' · '+esc(FLW[x.k])+': '+esc(x.note)+'</li>'}).join('')+'</ul>';
  h+='<p>The score is also my confidence. '+(c.sit?'It’s under the bar, so I stay out: <b>no flip seen</b>.':'It’s over the bar, so I call the opposite of the leader.')+'</p>';
  h+='<h4>My memory</h4><p>I remember which flip setups paid off in this market phase (setup: '+esc(c.bk2?bk2txt(c.bk2):'—')+'), so I get bolder where flips kept coming and quieter where none did. That memory resets when the market phase changes.</p>';
  var m=c.mem||[];h+='<p>'+(m.length?'My last '+m.length+' settled flip calls: '+m.map(function(e){return e.ok?'✓':'✗'}).join(' ')+'.':'I have no settled flip calls yet.')+'</p>';
  return h}
function chiefWhy(c){
  if(c.nc)return '<h4>Why “no clear read”</h4><p>'+esc(c.why)+'</p><p>My rules: I need at least 3 of the five callers to have a usable call, the weighted vote has to win by at least '+Math.round(CHIEF_MARGIN*100)+' points, and the volatility gate must not say “skip”. If any of those fail I say so, and it is never scored.</p>'+(c.vt&&c.vt.length?'<p>Who I could hear:</p>'+liUl(c.vt.map(function(x){return PROFILES[x.id].name+': '+x.dir+', confidence '+x.conf+' (trust ×'+x.tr+')'})):'');
  var h='<h4>How I weighed the five callers</h4><p>Each caller’s vote counts for <b>their confidence × their trust</b>. Trust runs from ×0.5 to ×1.5 based on their last 5 settled calls (no history yet = ×1.0), so a caller who has been right lately counts more.</p><ul>'
   +c.vt.map(function(x){return '<li><b>'+PROFILES[x.id].name+'</b>: '+arrow(x.dir)+', confidence '+x.conf+' × trust '+x.tr+' ('+(x.n5?x.ok5+' of their last '+x.n5+' right':'no settled calls yet')+') = <b>'+x.w.toFixed(2)+'</b></li>'}).join('')+'</ul>'
   +'<p>▲ UP adds up to <b>'+c.up.toFixed(2)+'</b> and ▼ DOWN to <b>'+c.dn.toFixed(2)+'</b>: a score of <b>'+sgnl(c.score)+'</b> (0 is a dead heat; I need beyond ±'+CHIEF_MARGIN+' to speak up).</p>';
  var p=c.cp;h+='<h4>Where my '+c.conf+'/100 confidence comes from</h4><ul><li><b>+'+Math.round(p.margin)+'</b> of 50: how clearly one side wins the weighted vote</li><li><b>+'+Math.round(p.agree)+'</b> of 25: '+p.agreeN+' of the '+p.agreeT+' callers I heard agree with me</li><li><b>+'+Math.round(p.sup)+'</b> of 25: how sure and how trusted the agreeing callers are</li>'
   +(p.tod?'<li><b>'+(p.tod>0?'+':'−')+Math.abs(p.tod)+'</b>: time of day ('+esc(SESN[c.td&&c.td.ses]||'')+')</li>':'')+(p.gate<1?'<li><b>×'+p.gate+'</b>: caution'+(c.news?' (big US news is close)':', the market is moving fast')+'</li>':'')+'</ul>';
  h+='<h4>My memory</h4>'+(c.mem&&c.mem.length?'<p>My last '+c.mem.length+' settled calls: '+c.mem.map(function(e){return e.ok?'✓':'✗'}).join(' ')+'.</p>':'<p>I have no settled calls yet.</p>');
  if(c.backs&&c.gk)h+='<h4>Who I back</h4><p>Grokky 1 is on '+arrow(c.gk.g1)+' and Grokky 2 on '+arrow(c.gk.g2)+', so I back Grokky '+c.backs+' (paper only).</p>';
  return h}
function chiefAlt(c){
  if(c.nc)return '<h4>What else I considered</h4><p>Nothing was scored: '+esc(c.why)+'</p>';
  var h='<h4>What else I considered</h4><ul><li>'+(c.heads&&c.heads!==c.dir?'Counting heads equally ('+c.hu+' UP, '+c.hd+' DOWN) I’d have said '+arrow(c.heads)+'; the trust and confidence weights changed it.':c.heads?'Counting heads equally ('+c.hu+' UP, '+c.hd+' DOWN) gives the same answer.':'Counting heads equally it was a tie ('+c.hu+'–'+c.hd+'); the weights broke it.')+'</li>';
  var u=c.vt.filter(function(x){return x.tr<0.9}).map(function(x){return PROFILES[x.id].name});var tp=c.vt.filter(function(x){return x.tr>1.1}).map(function(x){return PROFILES[x.id].name});
  h+='<li>'+(tp.length?'Trusted more because they’ve been right lately: '+tp.join(', ')+'.':'No one earned extra trust yet.')+' '+(u.length?'Trusted less after misses: '+u.join(', ')+'.':'')+'</li>';
  h+='<li>'+(c.disagree.length?'Disagreeing with me: '+c.disagree.map(function(j){return PROFILES[j].name}).join(', ')+'.':'No caller disagrees with me.')+'</li>';
  var ho=REG.filter(function(j){return c.vt.every(function(x){return x.id!==j})});
  h+='<li>'+(ho.length?'I couldn’t hear '+ho.map(function(j){return PROFILES[j].name}).join(', ')+' (skipped, benched, or not called yet).':'I heard all five callers.')+'</li></ul>';
  h+='<h4>Gate and news</h4><p>'+(c.gate.lvl==='ok'?'The market pace was normal and no big US news was near.':esc(c.gate.tr.join('; ')))+'</p>';return h}
function whyHtml(id,c){
  if(id==='flippy')return flipWhy(c);
  if(id==='chief')return chiefWhy(c);
  var P=PROFILES[id];if(!c.dir)return '<h4>Why I skipped</h4><p>The volatility gate tripped: '+esc(c.gate.tr.join('; '))+'. Rules: one trigger = caution badge; two or more (or a candle over '+PulseIndicators.GATE.extreme+'× its average) = skipped and not scored.</p>';
  var h='<h4>Why I called '+arrow(c.dir)+'</h4><p>I’m '+P.style+'-minded, so '+Math.round(P.w[P.lens]*100)+'% of my say goes to '+GL[P.lens]+'. Here’s how the evidence added up for me:</p><ul>';
  PulseIndicators.GROUPS.forEach(function(g){var l=c.leans[g];if(!l||!l.n)h+='<li>'+GI[g]+' '+esc(GL[g])+': couldn’t be read right now, so I ignored it.</li>';
    else h+='<li>'+GI[g]+' '+esc(GL[g])+' '+leanWord(l.lean)+' ('+sgnl(l.lean)+') × my weight = '+sgnl(c.gc[g])+'</li>'});
  h+='</ul><p>Total <b>'+sgnl(c.sc)+'</b> (below 0 is DOWN, above 0 is UP), a rough <b>'+pcs(c.dir,c.p)+'%</b> chance for '+arrow(c.dir)+'. That’s an estimate, not a tested probability.</p>';
  h+=confHtml(c);
  if(c.top&&c.top.length)h+='<p>The readings that mattered most:</p>'+liUl(c.top);
  h+='<h4>My memory</h4>';
  h+=c.mem&&c.mem.length?'<p>My last '+c.mem.length+' settled calls: '+c.mem.map(function(e){return e.ok?'✓':'✗'}).join(' ')+'.</p>':'<p>I have no settled calls to remember yet.</p>';
  h+=(c.damp&&c.damp.length?liUl(c.damp.map(function(x){return x.why})):'<p>Nothing needed damping: no evidence group failed me twice in a row.</p>')+(c.trust&&c.trust.length?liUl(c.trust.map(function(x){return x.why})):'<p>My longer-term memory for this phase is still too small (under '+TRUST_MIN+' readings per group) to change my weights.</p>');
  if(c.backs&&c.gk)h+='<h4>Who I back</h4><p>Grokky 1 is on '+arrow(c.gk.g1)+' and Grokky 2 on '+arrow(c.gk.g2)+'. They’re always opposite, so backing just follows my call: my side matches Grokky '+c.backs+'.</p>';
  return h;
}
function altHtml(id,c,others){
  if(id==='chief')return chiefAlt(c);
  if(id==='flippy'){var h='<h4>What else I considered</h4><p>'+(c.sit?'I weighed a flip to '+(c.leader==='UP'?'▼ DOWN':'▲ UP')+' but the evidence only reached '+c.fconf+'/100.':'The leader '+esc(c.leader)+' might simply hold on; the flip is a gamble.')+'</p>';
    var wk=c.fd.slice().sort(function(a,b){return (a.pts/a.max)-(b.pts/b.max)}).filter(function(x){return x.max&&x.pts/x.max<0.34}).slice(0,3);
    h+='<h4>What argued against a flip</h4>'+(wk.length?liUl(wk.map(function(x){return FLW[x.k]+': '+x.note})):'<p>Nothing notable: every piece of evidence leaned toward a flip.</p>');
    h+='<h4>What the others have called this window</h4>'+(othersNow(id,load().rounds[Math.floor(c.at/Q)*Q]).length?liUl(othersNow(id,load().rounds[Math.floor(c.at/Q)*Q])):'<p>No one else has called.</p>');return h}
  var P=PROFILES[id];if(!c.dir)return '<h4>What else I considered</h4><p>Nothing was scored: the gate paused me before I weighed the evidence.</p>';
  var h='<h4>What else I considered</h4><p>I looked at <b>'+c.cnt.all+'</b> readings: <b>'+c.cnt.voted+'</b> voted, <b>'+c.cnt.info+'</b> are background context, and <b>'+c.cnt.na+'</b> couldn’t be read.</p>';
  h+='<h4>Pointing the other way ('+arrow(opp(c.dir))+')</h4>'+(c.opp&&c.opp.length?liUl(c.opp):'<p>Nothing notable: every reading that voted agreed with me or was neutral.</p>');
  var a=c.alt||{};h+='<h4>If I’d done it differently</h4><ul>'+(a.lens?'<li>Using only my '+P.style+' lens I’d have said '+arrow(a.lens)+'.</li>':'')+(a.nogk?'<li>Ignoring what the Grokkys think, I’d have said '+arrow(a.nogk)+'.</li>':'')+(a.strike?'<li>Following only the distance to the strike (and Kalshi’s crowd), I’d have said '+arrow(a.strike)+'.</li>':'')+'</ul>';
  var hc=hist(c.bk,c.dir);h+='<h4>The crowd</h4><ul><li>'+(c.crowd.tot?c.crowd.same+' of the '+c.crowd.tot+' callers before me this window said '+c.dir+'.':'I was the first to call this window.')+'</li><li>'+(hc.n>=8?'In similar conditions ('+esc(c.bk.replace(/\|/g,' · '))+'), '+Math.round(hc.share*100)+'% of past calls said '+c.dir+(hc.right!=null&&hc.rn>=5?' and they were right '+Math.round(hc.right*100)+'% of the time':'')+' (n='+hc.n+').':'Not enough history yet for conditions like these (n='+hc.n+', I want 8).')+'</li></ul>';
  if(others&&others.length)h+='<h4>What the others have called this window</h4>'+liUl(others);
  if(c.nas&&c.nas.length)h+='<h4>Couldn’t read right now</h4>'+liUl(c.nas);
  return h;
}
function othersNow(id,r){var o=[];IDS.forEach(function(j){if(j===id||!r)return;var c=lastCall(r,j);if(c)o.push(PROFILES[j].name+' (min '+beatTxt(c.sec)+'): '+(c.dir?arrow(c.dir)+', confidence '+c.conf:'skipped, too fast'))});return o}

/* ---------- avatars (same family as the Grokkys) ---------- */
function avatar(id,k){
  var c={chief:['#ffe9a8','#e3a72a'],flippy:['#ffb3dc','#e0489b'],dash:['#ffb199','#ff5f4a'],zippy:['#ffd36b','#ff9a3d'],mellow:['#b9f0a8','#4fbf8f'],ripple:['#a9e4ff','#4a9be8'],sage:['#dcc8ff','#9b7be0']}[id],gid='cg'+id+(k||'');
  var top=id==='chief'?'<path d="M13 21 Q32 -2 51 21 L51 25 L13 25Z" fill="#243049" stroke="#ffd35e" stroke-width="1.6"/><rect x="10" y="22" width="44" height="5" rx="2.5" fill="#1a2336" stroke="#ffd35e" stroke-width="1.2"/><path d="M32 6 l2.6 5.2 l5.8 .8 l-4.2 4 l1 5.7 l-5.2 -2.8 l-5.2 2.8 l1 -5.7 l-4.2 -4 l5.8 -.8Z" fill="#ffd35e" stroke="#c9921a" stroke-width=".8"/>':id==='flippy'?'<path d="M16 18 L22 3 L42 3 L48 18Z" fill="#2a1d3a" stroke="#ffd35e" stroke-width="1.4"/><rect x="14" y="15" width="36" height="6" rx="3" fill="#ffd35e"/><path d="M32 6 l2.4 3 l-2.4 3 l-2.4 -3Z" fill="#ff5f7a"/>':id==='dash'?'<path d="M10 20 Q32 4 54 20 L54 26 Q32 12 10 26Z" fill="#fff4e8" stroke="#d94a36" stroke-width="1.4"/><path d="M2 22 L12 24 M3 29 L11 28" stroke="#ffd0c4" stroke-width="2.4" stroke-linecap="round"/>'
        :id==='zippy'?'<path d="M34 2 L26 15 L32 15 L28 26 L40 11 L33 11 Z" fill="#ffe27a" stroke="#d9822b" stroke-width="1.4" stroke-linejoin="round"/>'
        :id==='mellow'?'<path d="M32 15 Q32 7 32 4" stroke="#3f9a6d" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M32 8 Q43 1 46 9 Q38 13 32 8Z" fill="#6fd49a"/><path d="M32 9 Q22 3 19 10 Q26 14 32 9Z" fill="#8fe3b2"/>'
        :id==='sage'?'<path d="M32 14 Q27 6 32 2 Q37 6 32 14Z" fill="#e9dcff" stroke="#7a5bc4" stroke-width="1.2"/><circle cx="32" cy="9" r="1.6" fill="#7a5bc4"/>'
        :'<path d="M16 14 Q24 4 32 12 Q40 4 48 14" stroke="#e6f6ff" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="32" cy="5" r="3" fill="#e6f6ff"/>';
  var mouth=id==='chief'?'<path d="M24 46 L40 46" stroke="#2a1d16" stroke-width="3" stroke-linecap="round"/>':id==='flippy'?'<path d="M21 45 Q34 54 45 41" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M45 41 l3 -3" stroke="#2a1d16" stroke-width="2.4" stroke-linecap="round"/>':id==='dash'?'<path d="M21 43 Q32 56 43 43 Z" fill="#2a1d16"/><path d="M25 46 Q32 50 39 46" stroke="#ff9aa2" stroke-width="2" fill="none"/>':id==='zippy'?'<path d="M22 44 Q32 53 42 44" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>':id==='mellow'?'<path d="M24 46 Q32 50 40 46" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>':id==='sage'?'<path d="M26 46 Q32 49 38 46" stroke="#2a1d16" stroke-width="2.8" fill="none" stroke-linecap="round"/>':'<path d="M24 45 Q32 51 40 45" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/>';
  var brow=id==='chief'?'<path d="M14 27 L27 29 M50 27 L37 29" stroke="#2a1d16" stroke-width="3.2" stroke-linecap="round"/>':id==='zippy'?'<path d="M15 21 L27 24 M49 21 L37 24" stroke="#2a1d16" stroke-width="2.6" stroke-linecap="round"/>':id==='dash'?'<path d="M14 24 L27 27 M50 24 L37 27" stroke="#2a1d16" stroke-width="3" stroke-linecap="round"/>':id==='mellow'?'<path d="M16 25 Q22 22 28 25 M36 25 Q42 22 48 25" stroke="#2a1d16" stroke-width="2.4" fill="none" stroke-linecap="round"/>':'';
  var eyes=id==='flippy'?'<g class="eyes"><rect x="13" y="26" width="17" height="11" rx="5" fill="#1b1226"/><rect x="34" y="26" width="17" height="11" rx="5" fill="#1b1226"/><path d="M30 31 L34 31" stroke="#1b1226" stroke-width="2"/><path d="M16 29 l5 0" stroke="#ff9ad1" stroke-width="2" stroke-linecap="round"/><path d="M37 29 l5 0" stroke="#ff9ad1" stroke-width="2" stroke-linecap="round"/></g><circle cx="52" cy="52" r="5" fill="#fff" stroke="#2a1d16" stroke-width="1.2"/><circle cx="50.5" cy="50.5" r="0.9" fill="#2a1d16"/><circle cx="53.5" cy="53.5" r="0.9" fill="#2a1d16"/>':id==='mellow'?'<g class="eyes"><path d="M17 33 Q23 28 29 33" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M35 33 Q41 28 47 33" stroke="#2a1d16" stroke-width="3" fill="none" stroke-linecap="round"/></g>'
    :id==='sage'?'<g class="eyes"><circle cx="23" cy="32" r="7.4" fill="#fff" stroke="#6b4fb3" stroke-width="2"/><circle cx="41" cy="32" r="7.4" fill="#fff" stroke="#6b4fb3" stroke-width="2"/><path d="M30 32 L34 32" stroke="#6b4fb3" stroke-width="2"/><circle cx="23" cy="33" r="2.8" fill="#2a1d16"/><circle cx="41" cy="33" r="2.8" fill="#2a1d16"/></g>'
    :'<g class="eyes"><ellipse cx="23" cy="31" rx="6.2" ry="7" fill="#fff"/><ellipse cx="41" cy="31" rx="6.2" ry="7" fill="#fff"/><circle cx="'+(id==='zippy'||id==='dash'?'25':'23')+'" cy="32" r="3.1" fill="#2a1d16"/><circle cx="'+(id==='zippy'||id==='dash'?'43':'41')+'" cy="32" r="3.1" fill="#2a1d16"/></g>';
  return '<svg class="av avc av-'+id+'" viewBox="0 0 64 64" role="img" aria-label="'+PROFILES[id].name+' avatar"><defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+c[0]+'"/><stop offset="1" stop-color="'+c[1]+'"/></linearGradient></defs>'+top+'<rect x="7" y="12" width="50" height="47" rx="23" fill="url(#'+gid+')"/>'+brow+eyes+mouth+'<circle cx="14" cy="43" r="4" fill="#ff9aa2" opacity=".5"/><circle cx="50" cy="43" r="4" fill="#ff9aa2" opacity=".5"/></svg>';
}
window.__callersAvatar=avatar;

/* ---------- views ---------- */
function acc(t){return t.n?t.w/t.n*100:0}
function pctTxt(t){return t.n?Math.round(t.w/t.n*100)+'%':'—'}
function curRound(now){var W=Math.floor(now/Q)*Q;return {W:W,r:load().rounds[W]||null}}
function markChips(id,r,now,W){
  return '<div class="mchips">'+BEATS[id].map(function(sec,i){var c=r&&r.calls[id][i],due=W+sec,lab=beatTxt(sec);
    if(c&&c.sit){var rs=r.res,fl=(rs==='yes'||rs==='no')&&c.leader?((rs==='yes')!==(c.leader==='UP')):null;return '<span class="mchip sit" title="Minute '+lab+': no flip seen (flip score '+c.fconf+'/100, I needed '+c.thr+'). Not scored as a loss.'+(fl===true?' A flip DID come — I missed it.':fl===false?' No flip came — right to wait.':'')+'"><small>'+lab+'</small><b>💤</b><em>'+c.fconf+'</em>'+(fl===false?'<i>✓</i>':fl===true?'<i>↺</i>':'')+'</span>'}
    if(c&&c.nc)return '<span class="mchip nc" title="Minute '+lab+': no clear read — '+esc(c.why||'')+' Not scored."><small>'+lab+'</small><b>🤷</b></span>';
    if(c&&!c.dir)return '<span class="mchip skip" title="Minute '+lab+': skipped, the market was moving too fast. Not scored."><small>'+lab+'</small><b>⏸</b></span>';
    if(c){var res=r.res,ok=(res==='yes'||res==='no')?((c.dir==='UP')===(res==='yes')):null;
      return '<span class="mchip '+(c.dir==='UP'?'up':'dn')+(ok===true?' win':ok===false?' loss':'')+(c.gate.lvl==='caution'?' caution':'')+(c.shadow?' bench':'')+'" title="'+(c.shadow?'Shadow call (on the bench, not counted). ':'')+'Minute '+lab+': '+arrow(c.dir)+', confidence '+c.conf+', backing Grokky '+c.backs+(c.gate.lvl==='caution'?', caution (market moving fast)':'')+(ok===null?' (waiting for Kalshi to settle)':ok?' — right ✓':' — wrong ✗')+'"><small>'+lab+'</small><b>'+(c.dir==='UP'?'▲':'▼')+'</b><em>'+c.conf+'</em>'+(ok===true?'<i>✓</i>':ok===false?'<i>✗</i>':(c.gate.lvl==='caution'?'<i>⚠</i>':''))+'</span>'}
    if(r&&r.miss[id]&&r.miss[id][i])return '<span class="mchip miss" title="Missed: '+esc(r.miss[id][i])+'"><small>'+lab+'</small><b>–</b></span>';
    return '<span class="mchip wait" title="Next call at minute '+lab+'"><small>'+lab+'</small><b>'+(now<due?'⏳':'…')+'</b></span>'}).join('')+'</div>';
}
function memDots(id){var m=load().mem[id].slice(-5);return '<div class="memrow" title="My last settled calls, oldest first">'+(m.length?m.map(function(e){return '<span class="md '+(e.ok?'ok':'bad')+'">'+(e.ok?'✓':'✗')+'</span>'}).join(''):'<span class="mut tiny">no settled calls yet</span>')+'</div>'}
/* purely cosmetic: Ryann’s pick. Pinned just under the Overachiever (or first if he holds it), gets a star and a highlighted leaderboard row. Changes no scoring, weights, badges or the Overachiever rule. */
var PICK='zippy';
var OVER_RULE='Overachiever: the caller with the highest win rate right now. Needs at least '+10+' scored calls; ties go to whoever has more scored calls. Benched callers stay eligible (it only counts scored calls). It moves by itself as soon as a settlement changes the standings.';
var BX={};
function badgeRow(id){var hb=window.PulseBadges?PulseBadges.held(id):[];if(!hb.length)return '';var show=hb.slice(0,3),x='';
  var h='<div class="bdgrow">'+show.map(function(b){var k=id+':'+b.k;if(BX[k])x+='<div class="bdgx"><b>'+esc(b.name)+'</b>: '+esc(b.why)+'</div>';return '<button type="button" class="bdg" data-bx="'+k+'" title="'+esc(b.name+': '+b.why)+'">'+b.icon+' '+esc(b.name)+'</button>'}).join('')+(hb.length>3?'<span class="mut tiny">+'+(hb.length-3)+' more</span>':'')+'</div>';
  return h+x}
function callerCard(id,now){
  var P=PROFILES[id],cr=curRound(now),r=cr.r,s=load(),T=s.tot[id],c=lastCall(r,id),ps=s.ps[id]||{n:0,w:0};
  var isLead=window.PulseBadges&&PulseBadges.leader()===id,bn=benchOf(id);
  var h='<div class="gkhead">'+avatar(id,'c')+'<div class="gkname"><b>'+P.name+'</b><small>'+esc(P.tag)+'</small><span class="pill sty" style="border-color:'+P.col+'66;color:'+P.col+'">'+esc(P.style)+'</span>'
    +(isLead?'<button type="button" class="crown" data-bx="crown:'+id+'" title="'+esc(OVER_RULE)+'">👑 Overachiever</button>':'')+(id===PICK?'<span class="yourpick" title="Ryann’s pick, just for fun: it changes no scores or rules">⭐ Your pick</span>':'')+(bn?'<button type="button" class="benchb" data-bx="bench:'+id+'" title="On the bench: 3 misses in a row or under 40% over the last 10. My calls are shadow calls until they go 2 for 3.">🪑 On the bench</button>':'')+'</div></div>';
  if(isLead&&BX['crown:'+id])h+='<div class="bdgx">'+esc(OVER_RULE)+'</div>';
  if(bn&&BX['bench:'+id])h+='<div class="bdgx">On the bench since '+clock(bn.since)+' ('+esc(bn.why)+'). My calls still show up but don’t count. Once 2 of my next 3 shadow calls are right, I’m back. Shadow calls so far: '+(bn.sh.length?bn.sh.map(function(x){return x?'✓':'✗'}).join(' '):'none yet')+'.</div>';
  h+=badgeRow(id);
  h+=markChips(id,r,now,cr.W);
  if(c){h+='<div class="bubble cb-'+id+'">'+bubble(id,c)+'</div>';
    if(id==='flippy'){h+=c.sit?'<div class="cmeter" title="My flip score versus the bar I need"><span class="mlab">Flip score <b>'+c.fconf+'</b>/100</span>'+UI.barc('cf'+id,c.fconf,'warnbar')+'<span class="mlab">need '+c.thr+'</span></div>':'<div class="cmeter" title="How sure I am (0–100), and what drives it is under “Why?”"><span class="mlab">Confidence <b>'+c.conf+'</b>/100</span>'+UI.barc('cf'+id,c.conf,'upbar')+'<span class="mlab">bar was '+c.thr+'</span></div>'}
    else if(c.dir){h+='<div class="cmeter" title="How sure I am (0–100), and what drives it is under “Why?”"><span class="mlab">Confidence <b>'+c.conf+'</b>/100</span>'+UI.barc('cf'+id,c.conf,c.conf>=55?'upbar':'warnbar')+'<span class="mlab">'+confWord(c.conf)+'</span></div>'
      +'<div class="cmeter" title="My rough estimate for this window"><span class="mlab">UP '+Math.round(c.p*100)+'%</span>'+UI.barc('cm'+id,Math.round(c.p*100),'upbar')+'<span class="mlab">DOWN '+Math.round((1-c.p)*100)+'%</span></div>'}
    h+='<div class="gkmeta">Called at '+new Date(c.at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+mmss(c.secs)+' left · BTC '+usd(c.px,0)+' ('+esc(c.src)+')</div>';
    if(c.dir&&id!=='flippy'&&id!=='chief'){var cr2=c.crowd,hc=hist(c.bk,c.dir);h+='<div class="crowdline">👥 '+(cr2.tot?cr2.same+' of '+cr2.tot+' earlier callers agree':'First to call this window')+' · '+(hc.n>=8?Math.round(hc.share*100)+'% of past calls in similar conditions agreed (n='+hc.n+')':'history still building')+'</div>'}
    h+=UI.xp('cw'+id,(id==='chief'?(c.nc?'Why? Why “no clear read”':'Why? How I weighed the five callers'):id==='flippy'?(c.sit?'Why? Why no flip':'Why? Why I’m betting on a flip'):'Why? How I called '+(c.dir?arrow(c.dir):'(skipped)')),whyHtml(id,c))+UI.xp('ca'+id,'What else I considered',altHtml(id,c,othersNow(id,r)));
  }else{var nx=BEATS[id].filter(function(sec,i){return cr.W+sec>now&&!(r&&(r.calls[id][i]||(r.miss[id]&&r.miss[id][i])))})[0];
    h+='<div class="bubble cb-'+id+'">Hi, I’m '+P.name+'! '+esc(P.blurb)+' '+(nx!=null?'I make my next '+(id==='flippy'?'look for a flip':'call')+' at minute '+beatTxt(nx)+' (in <b class="cnext" data-t="'+(cr.W+nx)+'">'+mmss(cr.W+nx-now)+'</b>).':'I’ve made all my calls for this window, so I’ll be back with the next one.')+'</div>'}
  if(benchOf(id))h+='<div class="benchbox">🪑 I’m on the bench since '+clock(benchOf(id).since)+'. My calls are shadow calls: '+(benchOf(id).sh.length?benchOf(id).sh.map(function(x){return x?'✓':'✗'}).join(' '):'none yet')+' (back after 2 of 3 right).</div>';
  h+='<div class="tiny mut" style="margin-top:8px">My last 5 settled calls</div>'+memDots(id);
  if(id==='flippy'){var sp=ps.sit||{n:0,ok:0},fc=T.a;
    h+='<div class="flipboard"><div class="fbh">🎰 My scoreboard</div><div class="fbg"><div><b>'+UI.cu('ff-n',fc.n)+'</b><small>flip calls made</small></div><div><b>'+(fc.n?UI.cu('ff-r',acc(fc),{d:0,suf:'%'}):'—')+'</b><small>flip hit rate ('+fc.w+'/'+fc.n+')</small></div><div><b>'+(T.sit.n?UI.cu('ff-s',T.sit.ok/T.sit.n*100,{d:0,suf:'%'}):'—')+'</b><small>right to sit out ('+T.sit.ok+'/'+T.sit.n+')</small></div></div><div class="tiny mut">This phase: '+ps.w+'–'+(ps.n-ps.w)+' on flip calls; sat out '+sp.n+' times, right '+sp.ok+'. Sitting out is never a loss.</div></div>'}
  else h+='<div class="gkfoot cfoot"><span>This phase <b>'+UI.cu('cw-'+id,ps.w)+' W</b> / <b>'+UI.cu('cl-'+id,ps.n-ps.w)+' L</b></span><span>All time <b>'+T.a.w+'–'+(T.a.n-T.a.w)+'</b>'+(T.a.n?' · <b>'+UI.cu('cr-'+id,acc(T.a),{d:0,suf:'%'})+'</b>':'')+'</span></div>';
  if(id!=='flippy')h+='<div class="mbars">'+BEATS[id].map(function(sec,i){var t=T.b[i];return '<div class="mb"><small>min '+beatTxt(sec)+'</small>'+UI.barc('mb'+i+id,Math.round(acc(t)),'mbar')+'<small>'+(t.n?pctTxt(t)+' ('+t.w+'/'+t.n+')':'—')+'</small></div>'}).join('')+'</div>';
  return h+'<div class="tiny mut" style="font-size:12px;margin-top:6px">Paper calls only: no money, and I never place anything on Kalshi.</div>';
}
function stanceMap(now){
  var cr=curRound(now),g=gks()[cr.W],o=[{id:'g1',name:'Grokky 1',dir:g?g.g1:null,ic:'g1'},{id:'g2',name:'Grokky 2',dir:g?g.g2:null,ic:'g2'}],r=cr.r;
  IDS.forEach(function(id){var c=lastCall(r,id);o.push({id:id,name:PROFILES[id].name,dir:c&&c.dir&&!c.shadow?c.dir:null,ic:id})});return o;
}
function timeline(now){
  var cr=curRound(now),el=Math.max(0,Math.min(Q,now-cr.W)),r=cr.r,dots='';
  IDS.forEach(function(id){BEATS[id].forEach(function(sec,i){var c=r&&r.calls[id][i],miss=r&&r.miss[id]&&r.miss[id][i],st=c?(c.dir?'done':'skip'):miss?'miss':cr.W+sec<=now?'due':'';
    dots+='<span class="bdot '+st+'" style="left:'+(sec/Q*100).toFixed(2)+'%;background:'+(st==='done'?PROFILES[id].col:'transparent')+';border-color:'+PROFILES[id].col+'" title="'+PROFILES[id].name+' · minute '+beatTxt(sec)+(c?(c.dir?' · '+c.dir+' ('+c.conf+')':' · skipped, too fast'):miss?' · missed':'')+'"></span>'})});
  var leg=IDS.map(function(id){return '<span class="lg"><i style="background:'+PROFILES[id].col+'"></i>'+PROFILES[id].name+' <small>'+BEATS[id].map(beatTxt).join(' · ')+'</small></span>'}).join('');
  var ticks=[0,5,10,15].map(function(m){return '<span class="bt" style="left:'+(m/15*100)+'%">'+m+'</span>'}).join('');
  return '<div class="mtl" aria-label="Window timeline"><div class="mtl-bar mtl2"><i style="width:'+(el/Q*100).toFixed(1)+'%"></i>'+dots+ticks+'</div>'
   +'<div class="mtl-txt tiny mut">Window '+clock(cr.W)+' · '+Math.floor(el/60)+' of 15 min gone · seventeen beats (Zippy shares minute 4 with Ripple and minute 8 with Mellow; the Chief weighs in at 7:30; minute 15 is settlement, so Sage’s last call is at 14:30; Flippy only calls at 14:15 if he sees a flip)</div><div class="lgrow">'+leg+'</div></div>';
}
function liveCrowd(now){
  var cr=curRound(now),r=cr.r,list=[];REG.forEach(function(id){var c=lastCall(r,id);if(c&&c.dir&&!c.shadow)list.push({id:id,dir:c.dir,sec:c.sec})});
  if(!list.length)return '<div class="crowd0">👥 Crowd check: no one has called yet this window — Dash goes first at minute 1.</div>';
  var up=list.filter(function(x){return x.dir==='UP'}).length,dn=list.length-up,lead=up>=dn?'UP':'DOWN',n=Math.max(up,dn),v=LIVE&&LIVE.ok&&LIVE.W===cr.W?LIVE:null,lastSec=Math.max.apply(null,list.map(function(x){return x.sec}));
  var hc=v?hist(bucket(v.regime,v.d,lastSec),lead):{n:0};
  return '<div class="crowd0">👥 <b>'+n+' of '+list.length+' callers so far say <span class="'+cls(lead)+'">'+arrow(lead)+'</span></b> ('+(100*n/list.length).toFixed(0)+'%)'+(up&&dn?' · '+Math.min(up,dn)+' say '+opp(lead):'')+' · '+(hc.n>=8?'in similar conditions '+Math.round(hc.share*100)+'% of past callers said '+lead+' (n='+hc.n+')':'history for similar conditions is still building (n='+(hc.n||0)+')')+'</div>'
   +'<div class="cmeter">'+'<span class="mlab">UP '+up+'</span>'+UI.barc('crw',Math.round(up/list.length*100),'upbar')+'<span class="mlab">DOWN '+dn+'</span></div>'
   +(function(){var w=crowdW(r,cr.W+0,now);return w?'<div class="tiny mut" title="Each caller counts ×0.5 to ×1.5 depending on how they did in their last 5 settled calls">⚖️ Weighted by recent form: <b>'+Math.round(w.up*100)+'% UP</b> · '+Math.round((1-w.up)*100)+'% DOWN'+(Math.abs(w.up-up/list.length)>=0.05?' (the plain headcount says '+Math.round(up/list.length*100)+'% UP)':'')+'</div>':''})();
}

/* trust-weighted share of UP among the five regular callers' latest scored calls */
function crowdW(r,W,now){if(!r)return null;var u=0,t=0;REG.forEach(function(id){var c=lastCall(r,id);if(c&&c.dir&&!c.shadow){var w=trustOf(id);t+=w;if(c.dir==='UP')u+=w}});return t?{up:u/t,n:t}:null}
function phaseBar(now){
  var P=load().phase,c=P.cur,v=LIVE&&LIVE.ok?LIVE:null,gt=v&&v.gate,h='';
  h+='<div class="phrow"><div><span class="phlab">🧭 Market phase</span> <b>'+(c?esc(c.label):'working it out…')+'</b>'+(c?' <span class="mut">· since '+clock(c.start)+' ('+ago(now-c.start)+' ago)</span>':'')+'</div><button type="button" class="btn sm" id="phaseNew" title="Start a fresh phase: my longer-term stats for this phase reset (all-time totals stay)">🔄 Start a new phase</button></div>';
  if(c)h+='<div class="tiny mut">'+esc(c.reason)+'. My longer-term memory restarts whenever the phase changes; the all-time totals and the Grokky Archive keep counting.'+(P.cand?' <b>Possible shift to '+esc(phaseLabel(P.cand.key))+' — holding it for '+Math.round(PH_HOLD/60)+' min before I switch.</b>':'')+'</div>';
  if(gt){h+=gt.level==='ok'?'<div class="gate ok">✅ Market pace looks normal · last candle '+gt.range+'× its average · volatility '+gt.rv+'× median</div>'
    :gt.level==='caution'?'<div class="gate caution">⚠️ <b>Moving fast:</b> '+esc(gt.triggers.join('; '))+'. Calls made right now carry a caution badge and lower confidence.</div>'
    :'<div class="gate skip">⏸ <b>Too fast to call:</b> '+esc(gt.triggers.join('; '))+'. Calls due right now are skipped (not scored as losses).</div>'}
  return h;
}
function scoreTable(){
  var s=load(),G=(H&&H.state&&H.state().groks)||{},gw={w1:0,w2:0,n:0};Object.keys(G).forEach(function(w){var r=G[w];if(r.winner){gw.n++;if(r.winner===1)gw.w1++;else gw.w2++}});
  function cell(t,key,sub){return '<td><b>'+(t.n?Math.round(t.w/t.n*100)+'%':'—')+'</b><small>'+(t.n?t.w+'/'+t.n:'')+(sub?(t.n?' · ':'')+sub:'')+'</small>'+(t.n?UI.barc(key,Math.round(acc(t)),'mbar'):'')+'</td>'}
  var rows=IDS.map(function(id){var T=s.tot[id],p=s.ps[id]||{n:0,w:0};if(id==='flippy')return '<tr><td class="l"><span class="cn">'+avatar(id,'t')+'<b>Flippy</b></span></td>'+cell(p,'sp'+id,'flip calls')+cell(T.a,'sa'+id,'flip calls')+cell(T.b[0],'sb0'+id,'min 14:15')+'<td class="mut" colspan="2"><small>one beat, only when a flip is seen</small></td><td class="mut" title="Sat out (no flip seen): right when no flip came. Never a loss."><small>sat out '+T.sit.n+'<br>right '+T.sit.ok+'</small></td></tr>';return '<tr'+(window.PulseBadges&&PulseBadges.leader()===id?' class="leadrow"':id===PICK?' class="pickrow"':'')+'><td class="l"><span class="cn">'+avatar(id,'t')+'<b>'+PROFILES[id].name+'</b>'+(window.PulseBadges&&PulseBadges.leader()===id?' <span title="Overachiever">👑</span>':'')+(id===PICK?' <span title="Your pick">⭐</span>':'')+'</span></td>'+cell(p,'sp'+id)+cell(T.a,'sa'+id)+BEATS[id].map(function(sec,i){return cell(T.b[i],'sb'+i+id,'min '+beatTxt(sec))}).join('')+(id==='chief'?'<td class="mut" colspan="2"><small>one beat, at 7:30</small></td>':'')+'<td class="mut">'+(T.sk||'—')+(id==='chief'?'<small> no clear read / skipped</small>':'')+'</td></tr>'}).join('');
  var gr=[1,2].map(function(n){var w=n===1?gw.w1:gw.w2;return '<tr class="ref"><td class="l"><span class="cn">'+window.GrokkyPanel.avatar(n,'t')+'<b>Grokky '+n+'</b></span></td><td class="mut">—</td>'+cell({n:gw.n,w:w},'sg'+n)+'<td class="mut" colspan="3"><small>one call per window, at the start</small></td><td class="mut">for comparison</td></tr>'}).join('');
  return '<div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who</th><th>This phase</th><th>All time</th><th>1st beat</th><th>2nd beat</th><th>3rd beat</th><th title="Skipped (too fast), sat out (no flip seen) or no clear read (The Chief). Never scored as losses.">Skipped / sat out</th></tr></thead><tbody>'+rows+gr+'</tbody></table></div>';
}
function marksTable(now){
  var s=load(),ks=Object.keys(s.rounds).map(Number).sort(function(a,b){return b-a}).filter(function(w){return s.rounds[w].snaps&&Object.keys(s.rounds[w].snaps).length}),W=ks[0];
  if(W==null)return '<p class="mut">No tally has been captured yet. At minute 4, 8 and 12 of each window I save each caller’s standing as of that moment; the first one appears once the page has been open at a mark.</p>';
  var sn=s.rounds[W].snaps;
  var h='<p>Window '+clock(W)+': each caller’s record (settled calls only) at the moment the clock hit that mark. These are snapshots; they don’t change later.</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who</th>'+SNAP.map(function(m){return '<th>At minute '+m+'</th>'}).join('')+'</tr></thead><tbody>';
  h+=IDS.map(function(id){return '<tr><td class="l"><span class="cn">'+avatar(id,'m')+'<b>'+PROFILES[id].name+'</b></span></td>'+SNAP.map(function(m){var x=sn[m]&&sn[m][id];return '<td>'+(x?(x.n?'<b>'+x.w+'–'+(x.n-x.w)+'</b> <small>'+Math.round(x.w/x.n*100)+'% all-time</small>':'<small>no settled calls yet</small>')+(x.pn?'<small>phase '+x.pw+'–'+(x.pn-x.pw)+'</small>':''):'<small class="mut">not captured</small>')+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>';
  return h;
}
function archiveView(){
  var a=window.GrokkyArchive&&GrokkyArchive.summary();if(!a)return '';
  var b=a.bench,pc=function(t){return t.n?Math.round(t.w/t.n*100)+'% ('+t.w+'/'+t.n+')':'—'};
  var h='<div class="archhead"><b>🗄️ Grokky Archive</b> <span class="mut">· never forgets, never changes, never feeds back</span></div>'
   +'<div class="archline">Since '+new Date(a.since*1000).toLocaleDateString([], {month:'short',day:'numeric'})+' it has logged <b>'+a.rounds+'</b> settled rounds. Its fixed benchmark (equal weight on every evidence group, no memory, no phases, no damping) calls at minute 4, 8 and 12: <b>'+pc(b)+'</b> right.</div>';
  var rows=[['Archive benchmark',b],['Dash',a.callers.dash],['Zippy',a.callers.zippy],['Mellow',a.callers.mellow],['Ripple',a.callers.ripple],['Sage',a.callers.sage],['Grokky 1',a.g1],['Grokky 2',a.g2]].map(function(x){return '<tr><td class="l">'+x[0]+'</td><td>'+pc(x[1]||{n:0,w:0})+'</td></tr>'}).join('');
  h+=UI.xp('archx','Compare everyone against the benchmark','<p>Every number here comes from the Archive’s own permanent log, not from the live board. It is for comparison only: nothing in it is ever used to make a call.</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who (all-time, Archive’s own record)</th><th>Right</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(a.note?'<p class="tiny mut">'+esc(a.note)+'</p>':'')+'<p class="tiny mut">Stored under its own separate key ('+esc(GrokkyArchive.KEY)+'), about '+Math.round(a.bytes/1024)+' KB so far.</p>');
  return h;
}
function v1View(){
  var v=loadV1();if(!v)return '';var rs=Object.keys(v.rounds).length,rows=['zippy','mellow','ripple'].map(function(id){var t=v.tot[id];if(!t)return '';return '<tr><td class="l">'+PROFILES[id].name+(id==='mellow'?' (then mean-reversion)':id==='ripple'?' (then order-flow)':'')+'</td><td>'+(t.a&&t.a.n?t.a.w+'/'+t.a.n+' ('+Math.round(t.a.w/t.a.n*100)+'%)':'—')+'</td>'+['m4','m8','m12'].map(function(k){var x=t[k];return '<td>'+(x&&x.n?x.w+'/'+x.n:'—')+'</td>'}).join('')+'</tr>'}).join('');
  return UI.xp('v1arch','Archived: the first three callers (v1, minute 4 / 8 / 12)','<p>Their original results are kept exactly as they were (read-only, '+rs+' rounds stored). The new callers keep their own record under a new key.</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Caller (v1)</th><th>Overall</th><th>Min 4</th><th>Min 8</th><th>Min 12</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
}
function checkBalance(now){
  var W=Math.floor(now/Q)*Q,v=liveVec(W,now),ents=stanceMap(now),vis=v&&v.ok?v.signals.filter(function(s){return s.group!=='info'&&!s.na}):[],nas=v&&v.signals?v.signals.filter(function(s){return s.na&&s.group!=='info'}):[],inf=v&&v.signals?v.signals.filter(function(s){return s.group==='info'&&!s.na}):[];
  if(!v||!v.ok||!vis.length)return '<div class="mut">I’m still gathering price candles for the readings ('+esc(v&&v.why||'loading')+'). They appear here as soon as there are about 25 closed minutes.</div>';
  var upN=vis.filter(function(s){return s.vote>=.15}).length,dnN=vis.filter(function(s){return s.vote<=-.15}).length,neu=vis.length-upN-dnN;
  var called=ents.filter(function(e){return e.dir}),eu=called.filter(function(e){return e.dir==='UP'}),ed=called.filter(function(e){return e.dir==='DOWN'});
  var agree={};vis.forEach(function(s){if(Math.abs(s.vote)<.15){agree[s.k]={a:0,d:0};return}var a=0,d=0;called.forEach(function(e){if((s.vote>0)===(e.dir==='UP'))a++;else d++});agree[s.k]={a:a,d:d}});
  var split=vis.filter(function(s){var x=agree[s.k];return x&&x.a&&x.d}).sort(function(a,b){return Math.min(agree[b.k].a,agree[b.k].d)-Math.min(agree[a.k].a,agree[a.k].d)}).slice(0,2);
  var agreed=vis.filter(function(s){var x=agree[s.k];return x&&called.length>1&&(x.a===called.length)}).slice(0,2);
  var h='<div class="cbsum"><div class="cbline"><b>'+(called.length?eu.length+' of '+called.length+' of us say <span class="up-t">▲ UP</span>':'Nobody has called yet')+'</b>'+(ed.length?' · '+ed.length+' say <span class="dn-t">▼ DOWN</span> ('+ed.map(function(e){return e.name}).join(', ')+')':'')+'</div>'
   +(called.length?'<div class="cmeter"><span class="mlab">UP</span>'+UI.barc('cbent',Math.round(eu.length/called.length*100),'upbar')+'<span class="mlab">DOWN</span></div>':'')
   +'<div class="cbline">Of <b>'+vis.length+'</b> price-action readings, <b class="up-t">'+upN+'</b> lean UP, <b class="dn-t">'+dnN+'</b> lean DOWN and '+neu+' are quiet.</div>'
   +'<div class="cmeter"><span class="mlab">UP</span>'+UI.barc('cbrd',Math.round(upN/Math.max(1,upN+dnN)*100),'upbar')+'<span class="mlab">DOWN</span></div>'
   +(agreed.length?'<div class="cbnote">✅ <b>We all agree on:</b> '+esc(agreed.map(function(s){return s.name}).join(' · '))+'</div>':'')
   +(split.length?'<div class="cbnote">⚖️ <b>Where we split:</b> '+esc(split.map(function(s){return s.name+' ('+agree[s.k].a+' with it, '+agree[s.k].d+' against)'}).join(' · '))+'</div>':'')+'</div>';
  var sg=load().sig;
  function rec(k){var e=sg[k];return e&&e.n?'<span title="across '+e.n+' scored calls">'+Math.round(e.h/e.n*100)+'%</span>':'<span class="mut">—</span>'}
  var grid='<div class="logwrap tw"><table class="ctab cbtab"><thead><tr><th class="l">Reading</th><th>Lean</th>'+ents.map(function(e){return '<th title="'+e.name+'">'+(e.ic==='g1'?window.GrokkyPanel.avatar(1,'h'):e.ic==='g2'?window.GrokkyPanel.avatar(2,'h'):avatar(e.id,'h'))+'<small>'+e.name+'</small></th>'}).join('')+'<th>Right so far</th></tr></thead><tbody>'
   +vis.map(function(s){var lean=Math.abs(s.vote)<.15?'quiet':s.vote>0?'UP':'DOWN';return '<tr><td class="l" title="'+esc(s.desc)+'">'+GI[s.group]+' '+esc(s.name)+'</td><td><span class="lean '+(lean==='UP'?'up':lean==='DOWN'?'dn':'q')+'">'+(lean==='UP'?'▲':lean==='DOWN'?'▼':'·')+' <i style="width:'+Math.round(Math.abs(s.vote)*100)+'%"></i></span></td>'
     +ents.map(function(e){if(!e.dir)return '<td class="mut">…</td>';if(lean==='quiet')return '<td class="mut">·</td>';var ok=(s.vote>0)===(e.dir==='UP');return '<td class="'+(ok?'ag':'dis')+'" title="'+e.name+' is on '+e.dir+(ok?' — agrees':' — disagrees')+'">'+(ok?'✓':'✗')+'</td>'}).join('')+'<td>'+rec(s.k)+'</td></tr>'}).join('')
   +'<tr class="tot"><td class="l"><b>Agrees with…</b></td><td></td>'+ents.map(function(e){if(!e.dir)return '<td class="mut">…</td>';var a=0,n=0;vis.forEach(function(s){if(Math.abs(s.vote)<.15)return;n++;if((s.vote>0)===(e.dir==='UP'))a++});return '<td><b>'+a+'/'+n+'</b></td>'}).join('')+'<td></td></tr></tbody></table></div>'
   +'<div class="tiny mut" style="margin-top:6px">✓ means that entity’s latest call matches the reading’s lean, ✗ means it goes against it, · means the reading is quiet. “Right so far” is how often a reading’s lean matched Kalshi’s result on scored calls (it fills in as rounds settle).</div>';
  var info=inf.length?'<h4>Background readings</h4>'+liUl(inf.map(function(s){return s.name+': '+s.desc})):'';
  var narr=nas.length?'<h4>Couldn’t read right now</h4>'+liUl(nas.map(function(s){return s.name+': '+s.desc})):'';
  var srcs='<p class="tiny mut">Computed from Coinbase BTC-USD 1-minute candles and Binance BTCUSDT 1-minute klines (free public data, no keys) plus Kalshi’s strike and price. Only the board’s own picks and these readings are used; nothing is invented.</p>';
  return h+UI.xp('cbgrid','Show me the reading-by-reading view',grid+info+narr+srcs);
}

/* ---------- news banner, futures lean, edge meter ---------- */
function newsBar(now){
  var b=window.PulseNews&&PulseNews.banner(now);if(!b)return '';
  return '<div class="newsbar'+(b.live?' live':'')+'" role="status">📰 <b>'+(b.live?'Big news window:':'Heads-up:')+'</b> '+esc(b.ev.name)+' '+(b.mins>0?'comes out at '+PulseNews.et(b.ev.t)+', in about <b>'+b.mins+' min</b>':b.mins>=-30&&b.mins<=0?'came out '+(b.mins===0?'just now':(-b.mins)+' min ago')+' ('+PulseNews.et(b.ev.t)+')':'')+'. Price can whip around, so '+(b.live?'calls right now carry a ⚠️ caution badge and lower confidence.':'any call within 30 minutes either side of it will carry a ⚠️ caution badge.')+'</div>'}
function futText(){
  var f=null;try{f=window.PulseIndicators&&PulseIndicators.futView&&PulseIndicators.futView()}catch(e){}
  if(!f)return '🔮 Futures: loading funding rate and open interest…';
  if(f.err)return '🔮 Futures data isn’t available right now ('+esc(f.err)+'), so the readings simply skip it. Nothing else is affected.';
  var fp=f.fund*100,lean=Math.abs(fp)<0.002?'balanced, no lean':fp>0?'longs are paying shorts (crowded long), a mild lean DOWN':'shorts are paying longs (crowded short), a mild lean UP';
  var oi=isFinite(f.oiChg)?'open interest '+(f.oiChg>=0?'up ':'down ')+Math.abs(f.oiChg*100).toFixed(2)+'% in '+Math.round(f.span/60)+' min'+(Math.abs(f.oiChg)<0.001?' (flat)':f.oiChg>0?' (new money backing the move)':' (the move is losing fuel)'):'open interest '+(isFinite(f.oiUsd)?'$'+(f.oiUsd/1e9).toFixed(2)+'B':'?')+' (change shows after ~5 min of watching)';
  return '🔮 Futures ('+esc(f.src)+'): funding '+(fp>=0?'+':'−')+Math.abs(fp).toFixed(4)+'% per 8 h: '+lean+' · '+oi+'.'}
function edgeInfo(now){
  var cr=curRound(now),r=cr.r,k=kal(cr.W),ch=lastCall(r,'chief'),cw=crowdW(r,cr.W,now),o={kmid:k.mid,chief:null,crowd:null};
  if(ch&&ch.dir&&!ch.shadow)o.chief=ch.p;if(cw)o.crowd=cw.up;
  o.ce=isFinite(k.mid)&&o.chief!=null?Math.round((o.chief-k.mid)*100):null;o.we=isFinite(k.mid)&&o.crowd!=null?Math.round((o.crowd-k.mid)*100):null;return o}
function statusBar(now){
  var e=edgeInfo(now),h='<div class="stline">'+futText()+'</div>';
  var nx=window.PulseNews&&PulseNews.next(now);
  h+='<div class="stline">🎯 <b>Edge check</b> <span class="mut">(information only, I never place bets)</span>: ';
  if(!isFinite(e.kmid))h+='Kalshi’s price isn’t loaded yet.';
  else{h+='Kalshi’s UP price is <b>'+Math.round(e.kmid*100)+'¢</b>. ';
    h+=(e.chief!=null?'The Chief says UP <b>'+Math.round(e.chief*100)+'%</b> → edge <b class="'+(e.ce>=0?'up-t':'dn-t')+'">'+(e.ce>=0?'+':'−')+Math.abs(e.ce)+' pts</b>. ':'The Chief hasn’t weighed in this window yet (8:30). ')+(e.crowd!=null?'The trust-weighted crowd says UP <b>'+Math.round(e.crowd*100)+'%</b> → edge <b class="'+(e.we>=0?'up-t':'dn-t')+'">'+(e.we>=0?'+':'−')+Math.abs(e.we)+' pts</b>. ':'No one has called yet. ')+'<span class="mut">Plus means we see more UP than Kalshi’s price does, minus means less. These are rough estimates, not tested odds (see the Confidence check).</span>'}
  h+='</div>';
  if(nx)h+='<div class="stline mut tiny">📅 Next big US news: '+esc(nx.name)+' · '+nx.date+' · '+PulseNews.et(nx.t)+'</div>';
  return h}

/* ---------- extra panels: leader changes, confidence check, time of day, bench, history, replay ---------- */
function pctOf(o){return o&&o.n?Math.round(o.w/o.n*100):null}
function leaderPanel(){
  var B=window.PulseBadges;if(!B)return '';var h=B.history(),cur=B.leader(),rows=B.IDS.map(function(id){var t=B.stats(id);return {id:id,n:t.n,w:t.w,p:t.n?t.w/t.n:0}}).sort(function(a,b){return b.p-a.p||b.n-a.n});
  var body='<p>'+esc(OVER_RULE)+'</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Standings</th><th>Win rate</th><th>Scored calls</th><th>Eligible?</th></tr></thead><tbody>'
   +rows.map(function(x){return '<tr'+(x.id===cur?' class="leadrow"':x.id===PICK?' class="pickrow"':'')+'><td class="l"><span class="cn">'+avatar(x.id,'o')+'<b>'+PROFILES[x.id].name+'</b>'+(x.id===cur?' 👑':'')+(x.id===PICK?' ⭐':'')+(benchOf(x.id)?' <small>🪑 benched</small>':'')+'</span></td><td><b>'+(x.n?Math.round(x.p*100)+'%':'—')+'</b></td><td>'+x.n+'</td><td>'+(x.n>=B.MINLEAD?'✓':'needs '+(B.MINLEAD-x.n)+' more')+'</td></tr>'}).join('')+'</tbody></table></div>'
   +'<h4>Leader changes</h4>'+(h.length?'<ul>'+h.slice(0,12).map(function(e){return '<li>'+(e.id?'<b>'+PROFILES[e.id].name+'</b> took the crown'+(e.from?' from '+PROFILES[e.from].name:'')+' at '+clock(e.at)+' ('+Math.round(e.w/e.n*100)+'% over '+e.n+' calls)':'Nobody holds the crown anymore')+'</li>'}).join('')+'</ul>':'<p class="mut">No one has reached '+B.MINLEAD+' scored calls yet, so the crown is still up for grabs.</p>');
  return UI.xp('ovx','👑 Overachiever and leader changes'+(cur?' · '+PROFILES[cur].name+' holds it':''),body)}
var CALK=[['lt50','Under 50'],['50','50–60'],['60','60–70'],['70','70–80'],['80','80+']];
function calPanel(){
  var s=load(),rows=IDS.concat(['all']).map(function(id){var cells=CALK.map(function(k){var n=0,w=0,sc=0;(id==='all'?IDS:[id]).forEach(function(j){var o=s.cal[j]&&s.cal[j][k[0]];if(o){n+=o.n;w+=o.w;sc+=o.sc}});
      if(!n)return '<td class="mut">—</td>';var act=w/n*100,cl=sc/n,d=act-cl;return '<td class="'+(n<5?'':(Math.abs(d)<=8?'calok':d<0?'calover':'calunder'))+'" title="'+n+' calls; they claimed about '+Math.round(cl)+' on average and won '+Math.round(act)+'%"><b>'+Math.round(act)+'%</b><small>claimed ~'+Math.round(cl)+' · n='+n+'</small></td>'});
    return '<tr'+(id==='all'?' class="tot"':'')+'><td class="l">'+(id==='all'?'<b>Everyone</b>':'<span class="cn">'+avatar(id,'k')+'<b>'+PROFILES[id].name+'</b></span>')+'</td>'+cells.join('')+'</tr>'}).join('');
  return UI.xp('calx','Confidence check: do their confidence numbers match reality?','<p>When a caller says “70 out of 100”, they should win about 70% of the time. Each cell shows how often calls in that confidence band actually won (bold) next to the confidence they claimed. <span class="calok">Green</span> is within 8 points, <span class="calover">amber</span> is overconfident, <span class="calunder">blue</span> is underconfident (cells with fewer than 5 calls stay grey).</p><div class="logwrap tw"><table class="ctab caltab"><thead><tr><th class="l">Who</th>'+CALK.map(function(k){return '<th>'+k[1]+'</th>'}).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div><p class="tiny mut">Flippy’s “confidence” is his flip score. Only real settled calls count here (never replay or benched shadow calls).</p>')}
function todPanel(now){
  var s=load(),cur=sessionOf(Math.floor(now/Q)*Q),ses=['asia','europe','us','off'];
  var rows=IDS.map(function(id){return '<tr><td class="l"><span class="cn">'+avatar(id,'z')+'<b>'+PROFILES[id].name+'</b></span></td>'+ses.map(function(k){var o=(s.tod[id]||{})[k];return '<td'+(k===cur?' class="curses"':'')+'>'+(o&&o.n?'<b>'+Math.round(o.w/o.n*100)+'%</b><small>'+o.w+'/'+o.n+'</small>':'<span class="mut">—</span>')+'</td>'}).join('')+'</tr>'}).join('');
  return UI.xp('todx','Time of day: who is better when?','<p>Win rate by trading session: Asia hours (windows starting 00:00–02:00 UTC), Europe hours (07:00–09:00 UTC), the US open (13:30–15:30 UTC) and everything else. Right now it’s <b>'+SESN[cur]+'</b>. Once a caller has 10+ settled calls in a session, their confidence gets a small nudge (at most ±5 points) toward how they usually do in it. Callers each keep their own record.</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who</th>'+ses.map(function(k){return '<th'+(k===cur?' class="curses"':'')+'>'+SESN[k]+'</th>'}).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>')}
function benchPanel(){
  var s=load(),on=IDS.filter(function(id){return benchOf(id)}),h='<p>The bench rule: a caller who misses 3 in a row, or wins under 40% of their last 10, sits on the bench. They keep making calls, but those are <b>shadow calls</b> that don’t count and nobody else listens to. Once 2 of their next 3 shadow calls are right, they’re back (and their last-10 slate is wiped clean). Flippy is exempt because he rarely calls.</p>';
  h+=on.length?'<ul>'+on.map(function(id){var b=benchOf(id);return '<li><b>'+PROFILES[id].name+'</b> has been on the bench since '+clock(b.since)+' ('+esc(b.why)+'). Shadow calls: '+(b.sh.length?b.sh.map(function(x){return x?'✓':'✗'}).join(' '):'none yet')+'.</li>'}).join('')+'</ul>':'<p class="mut">Nobody is on the bench right now.</p>';
  var lg=[];IDS.forEach(function(id){var b=s.bench[id];if(b&&b.log)b.log.forEach(function(e){lg.push({id:id,at:e.at,why:e.why})})});lg.sort(function(a,b){return b.at-a.at});
  if(lg.length)h+='<h4>Recent bench moves</h4><ul>'+lg.slice(0,8).map(function(e){return '<li>'+clock(e.at)+' · '+PROFILES[e.id].name+': '+esc(e.why)+'</li>'}).join('')+'</ul>';
  return UI.xp('benchx','🪑 The bench'+(on.length?' · '+on.length+' on it':''),h)}
function histPanel(){var hl=load().hl||[];
  return UI.xp('histx','📜 What happened in each window (plain English)',hl.length?'<ul class="hl">'+hl.slice(0,20).map(function(e){return '<li><b>'+clock(e.W)+'</b> · '+esc(e.t)+'</li>'}).join('')+'</ul>':'<p class="mut">Each settled window gets one plain-English line here once Kalshi settles it.</p>')}
/* ---------- replay: run the callers over stored past windows, in a sandbox that never touches the live scores ---------- */
var RP={res:null,busy:false,err:'',on:{trust:1,tod:1,news:1,gate:1,damp:1,bench:1}},FNAME={trust:'trust-weighted voting',tod:'time-of-day nudge',news:'news caution',gate:'volatility gate',damp:'short-memory damping',bench:'bench rule'};
function replayRun(cb,bn,feat){
  var sv={ST:ST,LIVE:LIVE,liveAt:liveAt,FEAT:FEAT,REPLAY:REPLAY,now:_now},out=null;
  try{
    ST=fresh();LIVE=null;FEAT=feat;REPLAY=true;if(window.PulseBadges)PulseBadges.suspend(true);
    var byT={};cb.forEach(function(k){byT[k.t]=k});var lastT=cb.length?cb[cb.length-1].t:0,t0=cb.length?cb[0].t:0,W=Math.ceil((t0+1800)/Q)*Q,nW=0;
    var ev=[];IDS.forEach(function(id){BEATS[id].forEach(function(sec,i){ev.push({sec:sec,id:id,i:i})})});ev.sort(function(a,b){return a.sec-b.sec});
    for(;W+Q<=lastT+60;W+=Q){var op=byT[W],cl=byT[W+Q-60];if(!op||!cl)continue;var strike=op.o,r=round(W,true);
      ev.forEach(function(e){var now=W+e.sec,c1=cb.filter(function(k){return k.t<=now&&k.t>=now-14400}),b1=bn.filter(function(k){return k.t<=now&&k.t>=now-14400});_now=now;
        fire(W,e.id,e.i,now,{now:now,W:W,strike:strike,kmid:NaN,cb:c1,bn:b1,g:null,ctx:{book:NaN},fut:null})});
      r.res=cl.c>=strike?'yes':'no';scoreRound(r);nW++}
    var s=load();out={windows:nW,from:nW?Math.ceil((t0+1800)/Q)*Q:null,rows:{},bench:{}};
    IDS.forEach(function(id){var t=s.tot[id];out.rows[id]={n:t.a.n,w:t.a.w,sk:t.sk};var b=s.bench[id];out.bench[id]=b&&b.log?b.log.length:0});
  }finally{ST=sv.ST;LIVE=sv.LIVE;liveAt=sv.liveAt;FEAT=sv.FEAT;REPLAY=sv.REPLAY;_now=sv.now;if(window.PulseBadges)PulseBadges.suspend(false)}
  return out}
var ALLOFF={trust:0,tod:0,news:0,gate:0,damp:0,bench:0};
function replayBoth(cb,bn){var a=replayRun(cb,bn,{trust:0,tod:0,news:0,gate:0,damp:0,bench:0}),f={};Object.keys(RP.on).forEach(function(k){f[k]=RP.on[k]?1:0});var b=replayRun(cb,bn,f);return {a:a,b:b,on:f,at:Date.now()}}
function replayPanel(){
  var chk=Object.keys(FNAME).map(function(k){return '<label class="rpk"><input type="checkbox" data-rp="'+k+'"'+(RP.on[k]?' checked':'')+'> '+FNAME[k]+'</label>'}).join('');
  var h='<p>Replay runs all seven callers over the last stretch of stored candle history (about 16 hours of Binance 1-minute candles), once with the new features all <b>off</b> and once with the ones you tick <b>on</b>, and compares them. It is a sandbox: it never touches the live scores, memories, badges or the Archive, and nothing from it is saved. Replay has no Kalshi price, Grokky picks or futures data, so it only tests the price-action parts, and the “strike” is the price when each window opened.</p><div class="rpkw">'+chk+'</div><button type="button" class="btn sm" id="rpRun"'+(RP.busy?' disabled':'')+'>'+(RP.busy?'Running…':'▶ Run replay')+'</button>';
  if(RP.err)h+='<p class="mut">⚠️ '+esc(RP.err)+'</p>';
  var R=RP.res;if(R){var on=Object.keys(R.on).filter(function(k){return R.on[k]}).map(function(k){return FNAME[k]});
    h+='<p class="tiny mut">Replayed '+R.a.windows+' windows. “With features” = '+(on.length?esc(on.join(', ')):'nothing ticked')+'.</p><div class="logwrap tw"><table class="ctab"><thead><tr><th class="l">Who</th><th>Features off</th><th>With features</th><th>Difference</th></tr></thead><tbody>'
     +IDS.map(function(id){var x=R.a.rows[id],y=R.b.rows[id];function f(o){return o.n?o.w+'/'+o.n+' ('+Math.round(o.w/o.n*100)+'%)':'—'}var d=x.n&&y.n?Math.round((y.w/y.n-x.w/x.n)*100):null;
       return '<tr><td class="l"><span class="cn">'+avatar(id,'r')+'<b>'+PROFILES[id].name+'</b></span></td><td>'+f(x)+'</td><td>'+f(y)+(R.b.bench[id]?'<small>benched '+R.b.bench[id]+'×</small>':'')+'</td><td>'+(d==null?'—':'<b class="'+(d>0?'up-t':d<0?'dn-t':'')+'">'+(d>0?'+':'')+d+' pts</b>')+'</td></tr>'}).join('')+'</tbody></table></div><p class="tiny mut">Small samples bounce around a lot, so treat this as a curiosity, not proof.</p>'}
  return UI.xp('rpx','🔁 Replay mode: try the new features on past windows',h)}
function replayFetch(){
  if(RP.busy)return;RP.busy=true;RP.err='';update(true);
  fetch('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){
    var bn=d.map(function(k){return {t:Math.floor(k[0]/1000),o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],tb:+k[9]}}).filter(function(k){return isFinite(k.o+k.c)}),cb=bn.map(function(k){return {t:k.t,o:k.o,h:k.h,l:k.l,c:k.c,v:k.v}});
    var now=nowS();bn=bn.filter(function(k){return k.t+60<=now});cb=cb.filter(function(k){return k.t+60<=now});
    setTimeout(function(){try{RP.res=replayBoth(cb,bn)}catch(e){RP.err='Replay failed: '+(e&&e.message||e)}RP.busy=false;update(true)},30)},function(e){RP.err='Couldn’t load candle history ('+(e&&e.message==='Failed to fetch'?'blocked or offline':e&&e.message||'error')+').';RP.busy=false;update(true)});
}
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
  var bx=t.closest('[data-bx]');if(bx){var k=bx.getAttribute('data-bx');if(BX[k])delete BX[k];else BX[k]=1;update(true);return}
  if(t.closest('#rpRun')){replayFetch();return}});
document.addEventListener('change',function(e){var t=e.target;if(t&&t.getAttribute&&t.getAttribute('data-rp')){RP.on[t.getAttribute('data-rp')]=t.checked?1:0;update(true)}});

/* compact for Ask AI: one short line per caller */
function summary(){var sw=engSwap();try{return summaryInner()}finally{engRestore(sw)}}
function summaryInner(){var s=load(),now=nowS(),cr=curRound(now),r=cr.r,P=s.phase.cur,o={phase:P?P.label+' since '+clock(P.start):null,gate:LIVE&&LIVE.gate?LIVE.gate.level:null,callers:[]},up=0,dn=0;
  IDS.forEach(function(id){var T=s.tot[id],c=lastCall(r,id),ps=s.ps[id]||{n:0,w:0};if(c&&c.dir){if(c.dir==='UP')up++;else dn++}
    o.callers.push({n:PROFILES[id].name,beats:BEATS[id].map(beatTxt).join('/'),last:c?(c.sit?'no flip seen ('+c.fconf+'/100)':c.nc?'no clear read':c.dir?c.dir+' c'+c.conf+(c.backs?' G'+c.backs:'')+(c.gate.lvl==='caution'?' ⚠':'')+(c.shadow?' bench':''):'skipped(fast)'):null,phase:ps.n?ps.w+'/'+ps.n:'-',all:T.a.n?T.a.w+'/'+T.a.n:'-'})});
  o.crowd=(up+dn)?up+' UP, '+dn+' DOWN so far':'no calls yet';
  try{var ld=PulseBadges.leader();o.overachiever=ld?PROFILES[ld].name:'none yet (needs 10 scored calls)';var bn=IDS.filter(function(i){return benchOf(i)}).map(function(i){return PROFILES[i].name});if(bn.length)o.bench=bn.join(', ');var e=edgeInfo(now);if(e.ce!=null)o.edge='Chief '+(e.ce>=0?'+':'')+e.ce+' pts vs Kalshi UP '+Math.round(e.kmid*100)+'c';var nb=PulseNews.banner(now);if(nb)o.news=nb.ev.k+' in '+nb.mins+'m';var fv=PulseIndicators.futView();if(fv&&!fv.err)o.futures='funding '+(fv.fund*100).toFixed(4)+'%/8h'}catch(e){}
  try{var a=GrokkyArchive.summary();o.archive='bench '+(a.bench.n?a.bench.w+'/'+a.bench.n:'-')+' over '+a.rounds+' rounds'}catch(e){}
  return o}


/* Overachiever pinned first; the others keep their usual order. Smooth FLIP animation when the order changes. */
var lastOrder='';
function reorder(){var ld=window.PulseBadges&&PulseBadges.leader();IDS.forEach(function(id){var el=$('caller-'+id);if(el)el.classList.toggle('leader',ld===id)});var pk=PICK,ord=(ld?[ld]:[]).concat(pk&&pk!==ld?[pk]:[]).concat(IDS.filter(function(i){return i!==ld&&i!==pk})),key=ord.join(',');if(key===lastOrder)return;
  var els=ord.map(function(id){return $('caller-'+id)}).filter(Boolean),first={};els.forEach(function(el){first[el.id]=el.getBoundingClientRect()});
  ord.forEach(function(id,i){var el=$('caller-'+id);if(el)el.style.order=i});
  if(lastOrder&&!UI.reduced()){els.forEach(function(el){var a=first[el.id],b=el.getBoundingClientRect(),dx=a.left-b.left,dy=a.top-b.top;if(!dx&&!dy)return;el.style.transition='none';el.style.transform='translate('+dx+'px,'+dy+'px)';
    requestAnimationFrame(function(){requestAnimationFrame(function(){el.style.transition='transform .7s cubic-bezier(.2,.8,.2,1)';el.style.transform='';setTimeout(function(){el.style.transition=''},800)})})})}
  lastOrder=key}
/* engine view: while the always-on server engine is healthy, render ITS store/badges (read-only swap); the local pass keeps ticking and saving as backup */
function engSwap(){var v=window.PulseServer&&PulseServer.view&&PulseServer.view();if(!v||REPLAY||!v.store)return null;var sv={ST:ST,B:null,hadB:false};
  ST=v.store;SWAPPED=true;if(window.PulseBadges&&PulseBadges.swap&&v.badges){sv.B=PulseBadges.swap(v.badges);sv.hadB=true}return sv}
function engRestore(sv){if(!sv)return;ST=sv.ST;SWAPPED=false;if(sv.hadB)PulseBadges.swap(sv.B)}
function update(force){
  if(!H||!window.PulseIndicators)return;var now=nowS(),W=Math.floor(now/Q)*Q;
  try{tickMarks(now);scoreFromGrokky();var v=liveVec(W,now);if(v&&v.ok&&v.regime)detectPhase(v.regime,now);var g=gks()[W];if(g&&window.GrokkyArchive)GrokkyArchive.observeG(W,g.g1,g.g2)}catch(e){}
  var body=$('callersBody');if(!body)return;
  var SW=engSwap();try{
  var nowEls=document.querySelectorAll('#callersCard .cnext');[].forEach.call(nowEls,function(e){e.textContent=mmss(+e.getAttribute('data-t')-now)});
  function put(id,h,fx){var el=$(id);if(!el)return;if(el._h!==h){el.innerHTML=h;el._h=h;UI.restore(el);if(fx){UI.countAll(el);UI.settleBars(el)}}}
  put('engineBar',window.PulseServer?PulseServer.bar():'');put('newsBar',newsBar(now));put('statusBar',statusBar(now));put('callersTl',timeline(now));put('phaseBar',phaseBar(now),true);put('crowdBar',liveCrowd(now),true);
  IDS.forEach(function(id){var el=$('caller-'+id);if(!el)return;var h=callerCard(id,now);if(el._h!==h){el.innerHTML=h;el._h=h;UI.restore(el);UI.countAll(el);UI.settleBars(el)}
    var cr=curRound(now),r=cr.r,c=lastCall(r,id),key=c?cr.W+':'+c.i:'';if(key&&el._k!==key){var first=el._k===undefined;el._k=key;if(!first){el.classList.add('reveal');setTimeout(function(){el.classList.remove('reveal')},1700)}}});
  reorder();put('callersScore',scoreTable(),true);put('callersExtra',leaderPanel()+calPanel()+todPanel(now)+benchPanel()+histPanel()+replayPanel());put('callersMarks',UI.xp('cmarks','Standing at the 4, 8 and 12-minute marks',marksTable(now)));put('callersArch',archiveView()+v1View(),true);
  var cb=$('cbBody');if(cb){var h3=checkBalance(now);if(cb._h!==h3){cb.innerHTML=h3;cb._h=h3;UI.restore(cb);UI.settleBars(cb)}}
  }finally{engRestore(SW)}
}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('#phaseNew');if(!b)return;
  if(window.PulseServer&&PulseServer.view&&PulseServer.view()){window.alert('The always-on engine is running the phases for you, so this button is paused while it is on. If the engine goes down, it comes back by itself.');return}
  if(window.confirm('Start a new market phase?\n\nThe callers’ longer-term (per-phase) stats reset. All-time totals, short memory and the Grokky Archive are not touched.')){newPhase('you started a new phase by hand',nowS());update(true)}});
function init(host){H=host;load();loadV1();try{scoreFromGrokky()}catch(e){}update(true)}
window.CallersPanel={init:init,update:update,onKalshi:onKalshi,latest:latest,summary:summary,fire:fire,decide:decide,confidence:confidence,tickMarks:tickMarks,scoreRound:scoreRound,detectPhase:detectPhase,newPhase:newPhase,
  PROFILES:PROFILES,IDS:IDS,REG:REG,BEATS:BEATS,FLIP_THR:FLIP_THR,GRACE:GRACE,grace:grace,SNAP:SNAP,avatar:avatar,hist:hist,bucket:bucket,memMods:memMods,KEY:KEY,KEY1:KEY1,
  _setNow:function(t){_now=t},_store:function(){return load()},_inputs:inputs,_leans:leansOf,_resetCache:function(){ST=null;V1=null;LIVE=null;lastOrder=''},FEAT:FEAT,trustOf:trustOf,memAcc:memAcc,sessionOf:sessionOf,todNudge:todNudge,benchOf:benchOf,replayRun:replayRun,replayBoth:replayBoth,edgeInfo:edgeInfo,crowdW:crowdW,histLine:histLine,CHIEF_MARGIN:CHIEF_MARGIN,OVER_RULE:OVER_RULE,_isReplay:function(){return REPLAY},_RP:RP,_bubble:bubble,_earlier:earlier,_live:function(){return LIVE}};
})();
