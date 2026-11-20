/* ===== pulse3-engine: the always-on host for Pulse Board 3 (PAPER ONLY: no orders, no keys, no secrets). =====
   Cron every minute (UTC, 24/7). Each run is stateless and idempotent: load state from D1 → fetch candles/Kalshi → fire any due beats → score settled windows → save.
   Beats that fall inside the minute (8:30, 9:30, 12:30, 13:30, 14:30) are handled by waiting for them inside the same run. */
var ORIGIN='https://rydawg2026.github.io',VERSION='1.0',SERIES='KXBTC15M',Q=900;
var KALSHI=['https://api.elections.kalshi.com/trade-api/v2','https://kalshi-relay.rydawg2026.workers.dev'];
var K_CORE='callers.core',K_ROUNDS='callers.rounds',K_BADGES='badges',K_HEALTH='health',K_LOCK='lock',K_LASTERR='lasterr';
var KEEP_ROUNDS=6,LEASE_S=58;
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function nowS(){return Math.floor(Date.now()/1000)}
async function dbGetMany(env,keys){
  var st=keys.map(function(k){return env.DB.prepare('SELECT k,v FROM kv WHERE k=?').bind(k)});var rs=await env.DB.batch(st),o={};
  rs.forEach(function(r,i){var row=r.results&&r.results[0];o[keys[i]]=row?row.v:null});return o}
function upsert(env,k,v){return env.DB.prepare('INSERT INTO kv(k,v,t) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,t=excluded.t').bind(k,v,Date.now())}
async function takeLease(env){
  await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v,t) VALUES('lock','0',0)").run();
  var r=await env.DB.prepare("UPDATE kv SET v=?,t=? WHERE k='lock' AND CAST(v AS INTEGER)<?").bind(String(nowS()+LEASE_S),Date.now(),nowS()).run();
  return !!(r.meta&&r.meta.changes===1)}
function releaseLease(env){return env.DB.prepare("UPDATE kv SET v='0',t=? WHERE k='lock'").bind(Date.now()).run()}
/* ---- data in ---- */
async function J(u,ms){var c=new AbortController(),to=setTimeout(function(){c.abort()},ms||8000);try{var r=await fetch(u,{signal:c.signal,headers:{'accept':'application/json'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(to)}}
async function kalshiGet(path){var err='';for(var i=0;i<KALSHI.length;i++){try{var d=await J(KALSHI[i]+path,8000);return {d:d,via:i===0?'direct':'relay'}}catch(e){err=(e&&e.message)||'error'}}throw new Error('Kalshi unreachable ('+err+')')}
function pickOpen(ms){var n=nowS();return ms.filter(function(m){var o=Date.parse(m.open_time)/1000,c=Date.parse(m.close_time)/1000;return o<=n&&n<c})[0]||null}
function callSig(){var r=CallersPanel._store().rounds;return Object.keys(r).map(function(w){return Object.keys(r[w].calls).map(function(i){return r[w].calls[i].filter(Boolean).length}).join('')}).join('|')}
function needSettle(){var r=CallersPanel._store().rounds,n=nowS();return Object.keys(r).some(function(w){return !r[w].scored&&+w+900<=n&&n-w<7200})}
async function feeds(H,withSettled){
  var out={};
  await PulseIndicators.pollOnce();var D=PulseIndicators.feed();H.candles={coinbase:D.cbErr?('error: '+D.cbErr):'ok ('+D.cb.length+')',binance:D.bnErr?('error: '+D.bnErr):'ok ('+D.bn.length+')'};
  try{var k=await kalshiGet('/markets?series_ticker='+SERIES+'&status=open&limit=3');var cur=pickOpen(k.d.markets||[]);window.KalshiPanel={last:function(){return {current:cur}}};H.kalshi='ok via '+k.via+(cur?'':' (no open market)')}
  catch(e){H.kalshi='error: '+e.message;window.KalshiPanel={last:function(){return {current:null}}}}
  if(withSettled){try{var s=await kalshiGet('/markets?series_ticker='+SERIES+'&status=settled&limit=10');H.settled=(s.d.markets||[]).filter(function(m){return m.result==='yes'||m.result==='no'});H.settledErr=''}catch(e){H.settled=[];H.settledErr=e.message}}
}
/* all beats (and 4/8/12 snapshot marks) due strictly after `after` and before `until` */
function nextDue(after,until){var best=null,W0=Math.floor(after/Q)*Q;[W0,W0+Q].forEach(function(W){var B=CallersPanel.BEATS;Object.keys(B).forEach(function(id){B[id].forEach(function(sec){var d=W+sec;if(d>after&&d<until&&(best===null||d<best))best=d})})});return best}
/* ---- state in/out ---- */
function install(rows){
  var core=rows[K_CORE]?JSON.parse(rows[K_CORE]):null,rounds=rows[K_ROUNDS]?JSON.parse(rows[K_ROUNDS]):{};
  if(core){core.rounds=rounds;localStorage.setItem(CallersPanel.KEY,JSON.stringify(core))}else localStorage.removeItem(CallersPanel.KEY);
  if(rows[K_BADGES])localStorage.setItem(PulseBadges.KEY,rows[K_BADGES]);else localStorage.removeItem(PulseBadges.KEY);
  CallersPanel._resetCache();PulseBadges._drop();
}
function snapshot(){
  var s=CallersPanel._store(),ks=Object.keys(s.rounds).map(Number).sort(function(a,b){return a-b}),keep={};
  ks.slice(-KEEP_ROUNDS).forEach(function(w){keep[w]=s.rounds[w]});
  var core={};Object.keys(s).forEach(function(k){if(k!=='rounds')core[k]=s[k]});
  return {core:JSON.stringify(core),rounds:JSON.stringify(keep),badges:JSON.stringify(PulseBadges._state())}}
/* ---- health ---- */
function dayKey(t){return new Date(t*1000).toISOString().slice(0,10)}
function newHealth(){return {v:1,first:nowS(),lastRun:0,lastOk:0,lastError:null,lastErrorAt:0,runsToday:0,day:'',mins:[],errors:[],okRuns:0,failRuns:0,skippedOverlap:0,last:{}}}
function gapsOf(mins,now){var cut=Math.floor(now/60)-1440,m=mins.filter(function(x){return x>=cut}).sort(function(a,b){return a-b}),g=[];for(var i=1;i<m.length;i++)if(m[i]-m[i-1]>1)g.push({from:new Date((m[i-1]+1)*60000).toISOString(),to:new Date((m[i]-1)*60000).toISOString(),missedMinutes:m[i]-m[i-1]-1});return g.slice(-20)}
/* ---- one run ---- */
async function run(env){
  var t0=nowS(),h=newHealth(),H={},ok=false,err=null,fired=0,rows={},lease=false;
  try{
    lease=await takeLease(env);
    if(!lease){var hr=await dbGetMany(env,[K_HEALTH]);var hh=hr[K_HEALTH]?JSON.parse(hr[K_HEALTH]):newHealth();hh.skippedOverlap=(hh.skippedOverlap||0)+1;await upsert(env,K_HEALTH,JSON.stringify(hh)).run();return {skipped:true}}
    rows=await dbGetMany(env,[K_CORE,K_ROUNDS,K_BADGES,K_HEALTH]);
    if(rows[K_HEALTH])try{h=JSON.parse(rows[K_HEALTH])}catch(e){h=newHealth()}
    install(rows);
    var host={state:function(){return {groks:{}}}};
    var runEnd=t0-t0%60+58,cyc=0,now=t0;
    while(true){
      await feeds(H,cyc===0&&needSettle());now=nowS();CallersPanel._setNow(now);
      var before=callSig();
      if(cyc===0){CallersPanel.init(host);if(H.settled&&H.settled.length)CallersPanel.onKalshi({settled:H.settled})}
      else CallersPanel.update(true);
      cyc++;var after=callSig();
      if(before!==after)fired++;
      var nd=nextDue(now,runEnd);if(nd===null||cyc>=4)break;
      await sleep(Math.max(0,(nd+1)*1000-Date.now()));
    }
    try{if(PulseIndicators.futMark().at<now-170)await PulseIndicators.futOnce();var F=PulseIndicators.futMark();H.futures=F.err?('error: '+F.err):('ok ('+F.src+')')}catch(e){H.futures='error: '+e.message}
    var snap=snapshot(),w=[];
    if(snap.core!==rows[K_CORE])w.push(upsert(env,K_CORE,snap.core));
    if(snap.rounds!==rows[K_ROUNDS])w.push(upsert(env,K_ROUNDS,snap.rounds));
    if(snap.badges!==rows[K_BADGES])w.push(upsert(env,K_BADGES,snap.badges));
    ok=true;H.wrote=w.length;
    var done=nowS();
    h.lastRun=done;h.lastOk=done;h.okRuns=(h.okRuns||0)+1;H.fired=fired;H.secs=done-t0;
    h.mins=(h.mins||[]);h.mins.push(Math.floor(t0/60));var cut=Math.floor(t0/60)-1440;h.mins=h.mins.filter(function(x){return x>=cut});
    var dk=dayKey(t0);if(h.day!==dk){h.day=dk;h.runsToday=0}h.runsToday++;H.nSettled=H.settled?H.settled.length:0;delete H.settled;h.last=H;
    w.push(upsert(env,K_HEALTH,JSON.stringify(h)));await env.DB.batch(w);
  }catch(e){
    err=(e&&e.message)||String(e);
    try{h.lastRun=nowS();h.failRuns=(h.failRuns||0)+1;h.lastError=err;h.lastErrorAt=nowS();h.errors=(h.errors||[]);h.errors.push({at:nowS(),msg:err.slice(0,200)});h.errors=h.errors.slice(-10);
      h.mins=(h.mins||[]);h.mins.push(Math.floor(t0/60));var dk2=dayKey(t0);if(h.day!==dk2){h.day=dk2;h.runsToday=0}h.runsToday++;H.nSettled=H.settled?H.settled.length:0;delete H.settled;h.last=H;
      if(lease)await upsert(env,K_HEALTH,JSON.stringify(h)).run()}catch(e2){}
  }finally{if(lease){try{await releaseLease(env)}catch(e){}}}
  return {ok:ok,err:err}
}
/* ---- Pulse Board 3 condensed view: each caller's latest call (this window, else last window) + its own plain-language reasoning ---- */
function callsView(core,rounds,health){var n=nowS(),W=Math.floor(n/Q)*Q,CP=CallersPanel,out=[];
  function latest(w,id){var r=rounds[w];if(!r||!r.calls||!r.calls[id])return null;var l=null;r.calls[id].forEach(function(c){if(c&&(!l||c.at>l.at))l=c});return l}
  CP.IDS.forEach(function(id){var P=CP.PROFILES[id],c=latest(W,id),w=W;if(!c){c=latest(W-Q,id);w=W-Q}
    var o={id:id,name:P.name,style:P.style,beats:CP.BEATS[id],call:null};
    if(c){var st=c.sit?'noflip':c.nc?'noread':c.dir?'call':'skip',why='';try{why=CP._bubble(id,c)}catch(e){why=''}
      o.call={W:w,cur:w===W,sec:c.sec,at:c.at,dir:c.dir||null,state:st,conf:c.conf||null,why:why,top:(c.top||[]).slice(0,3)}}
    out.push(o)});
  return {W:W,serverTime:n,engine:{ok:!!(health&&health.lastOk&&n-health.lastOk<=180),lastOk:health&&health.lastOk||0},paperOnly:true,callers:out}}
/* ---- HTTP ---- */
function cors(extra){var h={'access-control-allow-origin':ORIGIN,'vary':'Origin','content-type':'application/json; charset=utf-8','cache-control':'public, max-age=10','x-content-type-options':'nosniff'};if(extra)Object.keys(extra).forEach(function(k){h[k]=extra[k]});return h}
function jr(o,st,extra){return new Response(JSON.stringify(o),{status:st||200,headers:cors(extra)})}
async function loadAll(env){var rows=await dbGetMany(env,[K_CORE,K_ROUNDS,K_BADGES,K_HEALTH]);return {core:rows[K_CORE]?JSON.parse(rows[K_CORE]):null,rounds:rows[K_ROUNDS]?JSON.parse(rows[K_ROUNDS]):{},badges:rows[K_BADGES]?JSON.parse(rows[K_BADGES]):null,health:rows[K_HEALTH]?JSON.parse(rows[K_HEALTH]):null}}
function healthView(h){var n=nowS();if(!h)return {ok:false,status:'no run yet'};var age=h.lastRun?n-h.lastRun:null;
  return {ok:!!(h.lastOk&&n-h.lastOk<=180),status:!h.lastRun?'no run yet':(n-h.lastOk<=180?'running':'stale'),version:VERSION,serverTime:new Date(n*1000).toISOString(),lastRun:h.lastRun?new Date(h.lastRun*1000).toISOString():null,lastRunAgeSeconds:age,lastOk:h.lastOk?new Date(h.lastOk*1000).toISOString():null,lastError:h.lastError,lastErrorAt:h.lastErrorAt?new Date(h.lastErrorAt*1000).toISOString():null,recentErrors:(h.errors||[]).slice(-5),runsToday:h.day===dayKey(n)?h.runsToday:0,runsLast24h:(h.mins||[]).filter(function(x){return x>=Math.floor(n/60)-1440}).length,expectedRunsLast24h:Math.min(1440,Math.floor((n-(h.first||n))/60)),gaps:gapsOf(h.mins||[],n),okRuns:h.okRuns||0,failedRuns:h.failRuns||0,skippedOverlap:h.skippedOverlap||0,lastCycle:h.last||{},cron:'* * * * * (UTC, every minute, 24/7)',paperOnly:true}}
async function handle(request,env,ctx){
  var u=new URL(request.url),origin=request.headers.get('origin');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'86400','vary':'Origin'}});
  if(request.method!=='GET')return jr({error:'GET only'},405);
  var cache=caches.default,key=new Request(u.origin+u.pathname,{method:'GET'}),hit=await cache.match(key);if(hit)return hit;
  var res;
  try{
    if(u.pathname==='/health'){var a=await dbGetMany(env,[K_HEALTH]);res=jr(healthView(a[K_HEALTH]?JSON.parse(a[K_HEALTH]):null),200,{'cache-control':'public, max-age=5'})}
    else if(u.pathname==='/state'){var s=await loadAll(env);if(!s.core)res=jr({ready:false,engine:healthView(s.health)},200);else{s.core.rounds=s.rounds;res=jr({ready:true,engine:healthView(s.health),store:s.core,badges:s.badges},200)}}
    else if(u.pathname==='/history'){var s2=await loadAll(env);var core=s2.core||{},B=s2.badges||{lead:{hist:[]}};
      var wins=Object.keys(s2.rounds).map(Number).sort(function(a,b){return b-a}).map(function(w){var r=s2.rounds[w],c={};Object.keys(r.calls).forEach(function(id){c[id]=r.calls[id].map(function(x){return x?(x.sit?{sit:1,fconf:x.fconf}:x.nc?{nc:1}:x.dir?{dir:x.dir,conf:x.conf,shadow:x.shadow?1:0,gate:x.gate&&x.gate.lvl}:{skip:1}):null})});return {W:w,time:new Date(w*1000).toISOString(),result:r.res,scored:!!r.scored,calls:c}});
      res=jr({windows:wins,lines:(core.hl||[]).map(function(e){return {W:e.W,time:new Date(e.W*1000).toISOString(),text:e.t}}),leaderChanges:(B.lead&&B.lead.hist||[]).map(function(e){return {id:e.id,from:e.from,at:new Date(e.at*1000).toISOString(),w:e.w,n:e.n}}),leader:B.lead&&B.lead.cur,benched:Object.keys(core.bench||{}).filter(function(k){return core.bench[k].on}),totals:core.tot?Object.keys(core.tot).reduce(function(o,k){o[k]={n:core.tot[k].a.n,w:core.tot[k].a.w};return o},{}):{}})}
    else if(u.pathname==='/calls'){var s3=await loadAll(env);res=jr(callsView(s3.core,s3.rounds,s3.health),200,{'cache-control':'public, max-age=5'})}
    else if(u.pathname==='/'||u.pathname==='')res=jr({name:'pulse3-engine',paperOnly:true,endpoints:['/calls','/state','/history','/health']});
    else res=jr({error:'not found'},404,{'cache-control':'no-store'});
  }catch(e){return jr({error:'engine storage error'},500,{'cache-control':'no-store'})}
  if(res.status===200)ctx.waitUntil(cache.put(key,res.clone()));
  return res}
export default {
  async fetch(request,env,ctx){return handle(request,env,ctx)},
  async scheduled(event,env,ctx){ctx.waitUntil(run(env))},
  _run:run
};
