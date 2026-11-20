#!/usr/bin/env python3
"""Bundle shim + the site's indicators/news/badges/callers modules + glue.js into engine/dist/worker.js (pulse3-engine)."""
import os
here=os.path.dirname(os.path.abspath(__file__));root=os.path.dirname(here)
parts=[open(os.path.join(here,'shim.js')).read()]
for f in ['indicators.js','news.js','badges.js','callers.js']:
    parts.append('\n/* ===== '+f+' ===== */\n'+open(os.path.join(root,f)).read())
parts.append('\n'+open(os.path.join(here,'glue.js')).read())
os.makedirs(os.path.join(here,'dist'),exist_ok=True)
open(os.path.join(here,'dist','worker.js'),'w').write('\n'.join(parts))
print('built',os.path.getsize(os.path.join(here,'dist','worker.js')),'bytes')
