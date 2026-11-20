/* Macro-news heads-up (Pulse Board 2). INFORMATION ONLY.
   A hard-coded calendar of the big scheduled US releases that can whip Bitcoin around. Dates and times come from the official calendars:
     • FOMC rate decisions (statement 2:00 PM ET on the meeting's second day) .... federalreserve.gov/monetarypolicy/fomccalendars.htm (2026, tentative 2027)
     • CPI inflation (8:30 AM ET) ........................................... bls.gov/schedule/news_release/cpi.htm
     • Jobs report / Employment Situation (8:30 AM ET) ...................... bls.gov/schedule/news_release/empsit.htm
     • PCE inflation, in Personal Income and Outlays (8:30 AM ET) ........... bea.gov/news/schedule/full + the White House 2027 principal-indicator calendar
   Times are US Eastern; this file converts them to UTC with the US daylight-saving rule (2nd Sunday of March to 1st Sunday of November).
   Rule: a banner appears 60 minutes before an event; calls made within ±30 minutes of it carry a caution badge (and lower confidence). Off-calendar surprises are NOT covered.
   Update the table below when new dates are published. Nothing is fetched at runtime. */
(function(){
'use strict';
var T={
 FOMC:{n:'the Fed’s interest-rate decision (FOMC)',t:'14:00',d:['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09','2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-11-17']},
 CPI:{n:'the CPI inflation report',t:'08:30',d:['2026-11-10','2026-12-10','2027-01-13','2027-02-11','2027-03-10','2027-04-13','2027-05-12','2027-06-10','2027-07-14','2027-08-11','2027-09-14','2027-10-14','2027-11-10','2027-12-10']},
 JOBS:{n:'the US jobs report',t:'08:30',d:['2026-11-06','2026-12-04','2027-01-08','2027-02-05','2027-03-05','2027-04-02','2027-05-07','2027-06-04','2027-07-02','2027-08-06','2027-09-03','2027-10-08','2027-11-05','2027-12-03']},
 PCE:{n:'the PCE inflation report',t:'08:30',d:['2026-11-25','2026-12-23','2027-01-28','2027-02-25','2027-03-31','2027-04-29','2027-05-27','2027-06-25','2027-07-29','2027-08-25','2027-09-30','2027-10-28','2027-11-24','2027-12-22']}};
function nthSunday(y,m,n){var d=new Date(Date.UTC(y,m,1)),first=(7-d.getUTCDay())%7;return 1+first+7*(n-1)}
function etOffsetH(y,mo,d){ // mo 1..12 ; returns hours to ADD to ET to get UTC (4 in daylight time, 5 in standard time) — date-level approximation is exact for these release hours (changes happen at 2 AM Sunday)
  var s=nthSunday(y,2,2),e=nthSunday(y,10,1),k=mo*100+d;return (k>=300+s&&k<1100+e)?4:5}
function toUtc(ds,hm){var p=ds.split('-').map(Number),h=hm.split(':').map(Number);return Math.round(Date.UTC(p[0],p[1]-1,p[2],h[0]+etOffsetH(p[0],p[1],p[2]),h[1])/1000)}
var EV=[];Object.keys(T).forEach(function(k){T[k].d.forEach(function(ds){EV.push({k:k,name:T[k].n,t:toUtc(ds,T[k].t),date:ds})})});EV.sort(function(a,b){return a.t-b.t});
function et(t){try{return new Date(t*1000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET'}catch(e){return ''}}
var LEAD=3600,NEAR=1800;
/* the event happening within ±30 min of `now` (caution zone), or null */
function near(now){for(var i=0;i<EV.length;i++){if(Math.abs(EV[i].t-now)<=NEAR)return EV[i];if(EV[i].t-now>NEAR)break}return null}
/* the next event that is at most 60 minutes away (banner), or null; during the ±30 window it keeps showing until 30 min after */
function banner(now){for(var i=0;i<EV.length;i++){var e=EV[i];if(e.t+NEAR<now)continue;if(e.t-now<=LEAD)return {ev:e,mins:Math.round((e.t-now)/60),live:Math.abs(e.t-now)<=NEAR};return null}return null}
function nextEvent(now){for(var i=0;i<EV.length;i++)if(EV[i].t+NEAR>=now)return EV[i];return null}
window.PulseNews={EVENTS:EV,near:near,banner:banner,next:nextEvent,et:et,LEAD:LEAD,NEAR:NEAR,_toUtc:toUtc};
})();
