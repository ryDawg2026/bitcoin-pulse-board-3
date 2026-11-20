#!/usr/bin/env python3
"""Write /workspace/deploy_pulse3.js: Cloudflare connector script that uploads dist/worker.js as pulse3-engine (own D1 pulse3-engine-db), cron every minute, workers.dev on."""
import json,os
here=os.path.dirname(os.path.abspath(__file__))
code=open(os.path.join(here,'dist','worker.js')).read()
DB='016abfc4-bbe3-4f33-ac93-1c09ed541b99'
js="""async () => {
const code = %s;
const metadata = { main_module: "worker.mjs", compatibility_date: "2025-09-01", bindings: [{ type: "d1", name: "DB", id: "%s" }], keep_bindings: [] };
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.append("worker.mjs", new Blob([code], { type: "application/javascript+module" }), "worker.mjs");
const up = await cloudflare.request({ method: "PUT", path: `/accounts/${accountId}/workers/scripts/pulse3-engine`, body: form });
const sch = await cloudflare.request({ method: "PUT", path: `/accounts/${accountId}/workers/scripts/pulse3-engine/schedules`, body: [{ cron: "* * * * *" }] });
const sub = await cloudflare.request({ method: "POST", path: `/accounts/${accountId}/workers/scripts/pulse3-engine/subdomain`, body: { enabled: true, previews_enabled: false } });
return { up: up.success, id: up.result && up.result.id, etag: up.result && up.result.etag, startup_ms: up.result && up.result.startup_time_ms, size: code.length, sch: sch.result, sub: sub.result };
}""" % (json.dumps(code), DB)
open('/workspace/deploy_pulse3.js','w').write(js);print(len(js))
