/* Badges + the Overachiever crown (Pulse Board 2). PAPER-ONLY, for fun and for reading the scoreboard at a glance.
   Everything here is earned ONLY from real scored calls (Kalshi's settlement): replay mode, shadow (benched) calls, skips and Flippy's "no flip seen" never count.
   Own storage key: pulseboard3.badges.v1. It keeps its own small per-caller counters, so it never reads or changes the callers' scores, and the Grokky Archive never reads it.
   OVERACHIEVER (one holder at a time): the caller with the highest current win percentage over their scored calls, with at least MINLEAD (10) scored calls.
   Tie on win%: the one with more scored calls; still tied: whoever already holds it keeps it. Re-checked after every settlement. A benched caller stays eligible: it's based on scored calls only.
   Badges (re-checked live; "Hot streak" tiers drop the moment the streak breaks, the rest are held while the numbers still back them up):
     Hot Streak 3 / On Fire 5 / Unstoppable 10 right in a row · Honest Meter (20+ calls and average confidence within 5 points of the real win rate) · Specialist (10 wins when my own signal group led my call)
     Crowd Breaker (5 correct calls against the majority of earlier callers) · Comeback Kid (3 right in a row after returning from the bench) · Night Owl / Early Bird / Wall Street (60%+ over 10+ calls in the Asia / Europe / US session)
     Flip Master (Flippy: 3 correct flip calls) · Big Picture (The Chief: 10 correct calls where most of the five callers he read were wrong or split) · Veteran (50 scored calls) */
(function(){
'use strict';
var KEY='pulseboard3.badges.v1',MINLEAD=10,IDS=['dash','zippy','mellow','ripple','sage','flippy','chief'],SES=['asia','europe','us'];
var S=null,suspended=false;
function mk(){var st={};IDS.forEach(function(i){st[i]={n:0,w:0,streak:0,best:0,sc:0,cn:0,ses:{asia:{n:0,w:0},europe:{n:0,w:0},us:{n:0,w:0}},spec:0,cb:0,fl:0,bp:0,cbk:{on:false,got:0,done:false}}});return {v:1,st:st,earned:{},lead:{cur:null,hist:[]}}}
function load(){if(S)return S;try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.v===1&&s.st){var f=mk();IDS.forEach(function(i){if(!s.st[i])s.st[i]=f.st[i]});if(!s.earned)s.earned={};if(!s.lead)s.lead=f.lead;S=s;return S}}catch(e){}S=mk();return S}
function save(){if(suspended)return;try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
/* one real, scored, non-shadow call. ev: {id, ok, conf, ses, led, vs, bp, flip} */
function record(ev){if(suspended||!ev||!ev.id)return;var s=load(),t=s.st[ev.id];if(!t)return;
  t.n++;if(ev.ok){t.w++;t.streak++;if(t.streak>t.best)t.best=t.streak}else t.streak=0;
  if(ev.conf!=null&&isFinite(ev.conf)){t.sc+=ev.conf;t.cn++}
  if(ev.ses&&t.ses[ev.ses]){t.ses[ev.ses].n++;if(ev.ok)t.ses[ev.ses].w++}
  if(ev.ok&&ev.led)t.spec++;if(ev.ok&&ev.vs)t.cb++;if(ev.ok&&ev.flip)t.fl++;if(ev.ok&&ev.bp)t.bp++;
  if(t.cbk.on){if(ev.ok){t.cbk.got++;if(t.cbk.got>=3){t.cbk.done=true;t.cbk.on=false}}else t.cbk.on=false}}
function returned(id){if(suspended)return;var t=load().st[id];if(t){t.cbk.on=true;t.cbk.got=0}}
function pct(t){return t.n?t.w/t.n:0}
function names(){return (window.CallersPanel&&CallersPanel.PROFILES)||{}}
/* what this caller currently holds: [{k,icon,name,why}] */
function held(id){var s=load(),t=s.st[id],o=[];if(!t)return o;var P=names()[id]||{name:id};
  if(t.streak>=10)o.push({k:'streak',icon:'🔥',name:'Unstoppable',why:t.streak+' right in a row (the tiers are Hot Streak 3, On Fire 5, Unstoppable 10; it drops the moment a call misses)'});
  else if(t.streak>=5)o.push({k:'streak',icon:'🔥',name:'On Fire',why:t.streak+' right in a row (Hot Streak is 3, On Fire is 5, Unstoppable is 10; it drops the moment a call misses)'});
  else if(t.streak>=3)o.push({k:'streak',icon:'🔥',name:'Hot Streak',why:t.streak+' right in a row (On Fire is 5; it drops the moment a call misses)'});
  if(t.cn>=20&&Math.abs(t.sc/t.cn-pct(t)*100)<=5)o.push({k:'honest',icon:'⚖️',name:'Honest Meter',why:'My average confidence ('+Math.round(t.sc/t.cn)+') is within 5 points of my real win rate ('+Math.round(pct(t)*100)+'%) over '+t.cn+' calls'});
  if(t.spec>=10)o.push({k:'spec',icon:'🎯',name:'Specialist',why:t.spec+' wins when my own signal group ('+(P.lens||'my lens')+') was the biggest voice in my call (badge at 10)'});
  if(t.cb>=5)o.push({k:'cb',icon:'🦅',name:'Crowd Breaker',why:t.cb+' correct calls against the majority of the callers before me (badge at 5)'});
  if(t.cbk.done)o.push({k:'comeback',icon:'💪',name:'Comeback Kid',why:'Came back from the bench and got 3 in a row right'});
  var sn={asia:['🦉','Night Owl','Asia session (about 00:00 UTC)'],europe:['🐦','Early Bird','Europe session (about 07:00–08:00 UTC)'],us:['🗽','Wall Street','US-open session (about 13:30–15:30 UTC)']};
  SES.forEach(function(k){var x=t.ses[k];if(x.n>=10&&x.w/x.n>=0.6)o.push({k:'ses-'+k,icon:sn[k][0],name:sn[k][1],why:Math.round(x.w/x.n*100)+'% over '+x.n+' calls in the '+sn[k][2]+' (badge at 60%+ over 10+ calls)'})});
  if(id==='flippy'&&t.fl>=3)o.push({k:'flip',icon:'🎰',name:'Flip Master',why:t.fl+' correct flip calls (badge at 3)'});
  if(id==='chief'&&t.bp>=10)o.push({k:'bigp',icon:'🧠',name:'Big Picture',why:t.bp+' correct calls where most of the five callers he read were wrong or split (badge at 10)'});
  if(t.n>=50)o.push({k:'vet',icon:'🎖️',name:'Veteran',why:t.n+' scored calls (badge at 50)'});
  return o}
/* leader: highest win% with >= MINLEAD scored calls; ties -> more scored calls -> the sitting holder keeps it */
function pick(s){var best=null;IDS.forEach(function(id){var t=s.st[id];if(t.n<MINLEAD)return;
    if(!best)best=id;else{var a=t,b=s.st[best],l=a.w*b.n,r=b.w*a.n;if(l>r||(l===r&&a.n>b.n)||(l===r&&a.n===b.n&&id===s.lead.cur))best=id}});return best}
function recompute(at){var s=load(),nb=pick(s),ch=false;at=at==null?Math.floor(Date.now()/1000):at;
  IDS.forEach(function(id){held(id).forEach(function(b){s.earned[id]=s.earned[id]||{};if(!s.earned[id][b.k]){s.earned[id][b.k]=at;ch=true}})});
  if(nb!==s.lead.cur){var t=nb?s.st[nb]:null;s.lead.hist.unshift({id:nb,from:s.lead.cur,at:at,w:t?t.w:0,n:t?t.n:0});while(s.lead.hist.length>30)s.lead.hist.pop();s.lead.cur=nb;ch=true}
  if(ch||true)save();return {leader:s.lead.cur,changed:ch}}
function finish(at){return recompute(at)}
function leader(){return load().lead.cur}
function history(){return load().lead.hist.slice()}
function stats(id){return load().st[id]}
function earnedAt(id,k){var e=load().earned[id];return e&&e[k]||null}
function reset(){S=mk();save()}
function suspend(b){suspended=!!b}
window.PulseBadges={KEY:KEY,MINLEAD:MINLEAD,IDS:IDS,record:record,returned:returned,held:held,recompute:recompute,finish:finish,leader:leader,history:history,stats:stats,earnedAt:earnedAt,reset:reset,suspend:suspend,_state:function(){return load()},swap:function(s){var p=S;S=s;return p},_drop:function(){S=null}};
})();
