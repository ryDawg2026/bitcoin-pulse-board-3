#!/usr/bin/env python3
import os,json
here=os.path.dirname(os.path.abspath(__file__));root=os.path.dirname(here)
av=open(os.path.join(here,'avatars.json')).read()
t=open(os.path.join(here,'page.tpl.html')).read().replace('__AVATARS__',av)
open(os.path.join(root,'index.html'),'w').write(t);print('index.html',len(t))
