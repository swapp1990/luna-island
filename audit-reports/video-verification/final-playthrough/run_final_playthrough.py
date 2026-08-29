"""15-minute final genre-literacy playthrough through rendered player controls."""
from __future__ import annotations
import os, sys, time
sys.path.insert(0, r"D:\MyProjects\Claude\browser-harness")
import helpers as h  # noqa: E402

WAIT_SCALE=float(os.environ.get('PLAYTHROUGH_WAIT_SCALE','1'))
def wait(n: float) -> None: h.wait(n if n < 1 else n * WAIT_SCALE)
def js(s: str): return h.js(s)
def wait_expr(s: str, timeout: float = 45) -> None:
    end=time.time()+timeout
    while time.time()<end:
        try:
            if js(s): return
        except Exception: pass
        wait(.4)
    raise RuntimeError(s)
def centre(sel: str):
    p=js(f'''(()=>{{const e=document.querySelector({sel!r});if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}}}})()''')
    if not p: raise RuntimeError(sel)
    return p
def click(sel: str, pause: float=1) -> None:
    p=centre(sel); h.human_click(p['x'],p['y'],duration=.35); wait(pause)
def visible(sel: str) -> bool:
    return bool(js(f'''(()=>{{const e=document.querySelector({sel!r});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight}})()'''))
def set_selected_site_priority(level: int, hold: float=8) -> None:
    sel=f'[data-testid="construction-priority-{level}"]'
    if not js("document.querySelector('[data-testid=selection-panel]')!==null"): raise RuntimeError('missing selected construction site')
    if not visible(sel):
        ins=centre('[data-testid="selection-panel"]'); h.scroll(ins['x'],ins['y'],dy=420); wait(3)
    wait_expr(f'''(()=>{{const e=document.querySelector({sel!r});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight}})()''')
    click(sel); wait(hold)
    if js("document.querySelector('[data-testid=selection-panel]')!==null"):
        ins=centre('[data-testid="selection-panel"]'); h.scroll(ins['x'],ins['y'],dy=-420); wait(2)
def close_catalog() -> None:
    if js("document.querySelector('[data-testid=build-menu]')!==null"): click('[data-testid="build-toggle"]')
def select_construction(kind: str) -> None:
    p=js(f'''(()=>{{const c=window.__townControl,x=c.listConstruction().filter(p=>p.kind==={kind!r}).at(-1);return x?c.screenForPlace(x.id):null}})()''')
    if not p: raise RuntimeError('missing construction '+kind)
    h.human_click(p['x'],p['y'],duration=.4); wait(2)
def build(kind: str, hold: float=16) -> None:
    if not js("document.querySelector('[data-testid=build-menu]')!==null"): click('[data-testid="build-toggle"]')
    click(f'[data-testid="build-{kind}"]')
    p=js(f'''(()=>{{const c=window.__townControl,t=c.findBuildable({kind!r});return t?c.screenForTile(t.x,t.y):null}})()''')
    if not p: raise RuntimeError('no build tile '+kind)
    h.human_click(p['x'],p['y'],duration=.5); wait(hold); h.press_key('Escape'); wait(1)
def ffwd(n: int) -> None:
    js(f'''(()=>{{window.__finalFfwd=false;window.__townControl.ffwd({n}).then(()=>window.__finalFfwd=true);return true}})()''')
    wait_expr('window.__finalFfwd===true',60)
def select_place(kind: str) -> None:
    p=js(f'''(()=>{{const c=window.__townControl,x=c.listPlaces().find(p=>p.kind==={kind!r});return x?c.screenForPlace(x.id):null}})()''')
    if not p: raise RuntimeError('missing place '+kind)
    h.human_click(p['x'],p['y'],duration=.4); wait(2)
def inspect_agent(agent_id: str, hold: float=18) -> None:
    p=js(f"window.__townControl.screenForAgent({agent_id!r})")
    if not p: raise RuntimeError(agent_id)
    h.human_click(p['x'],p['y']+10,duration=.4); wait(2)
    wait_expr("document.querySelector('[data-testid=resident-inspector]')!==null || document.querySelector('[data-testid=world-conversation]')!==null",8)
    if not js("document.querySelector('[data-testid=resident-inspector]')!==null") and js("document.querySelector('[data-testid=world-conversation]')!==null"):
        click('[data-testid="world-conversation"]',2)
    wait_expr("document.querySelector('[data-testid=resident-inspector]')!==null",8)
    wait(hold)

h.goto_owned('http://127.0.0.1:5175/town.html?brain=mock&mindWallFloorMs=0&mindMinGapTicks=120')
h.wait_for_load(); wait_expr('window.__townState?.ready===true'); click('[data-testid="speed-0"]'); wait(20)
js('window.__townControl.setTimeOfDay(11);true'); wait(4)

# Read the threat, objectives, and growth gate before making a plan.
click('[data-testid="town-growth-toggle"]'); wait(14); click('[data-testid="town-growth-toggle"]')
click('[data-testid="build-toggle"]'); wait(14); click('[data-testid="build-toggle"]')

# Survival promises take precedence over growth demand: shelter and water first.
build('home',14)
select_construction('home')
set_selected_site_priority(3,10)
build('well',14)
select_construction('well')
set_selected_site_priority(3,10)
build('farm',15)
select_construction('farm')
set_selected_site_priority(1,12)
close_catalog(); wait(8)

# Diagnose the competing labour demand and explicitly prioritize food/building.
click('[data-testid="priorities-toggle"]'); wait(12)
click('[data-testid="work-priority-food-3"]'); click('[data-testid="work-priority-build-3"]'); wait(12)
click('[data-testid="priorities-toggle"]')

# Paint a visible logistics route.
click('[data-testid="path-tool"]')
pts=js('''(()=>{const c=window.__townControl,a=[];for(let y=1;y<47;y++)for(let x=1;x<47;x++){if(!c.validatePath(x,y).ok)continue;const p=c.screenForTile(x,y);if(p&&p.x>430&&p.x<820&&p.y>180&&p.y<430)a.push({p,d:Math.hypot(p.x-630,p.y-300)});}a.sort((u,v)=>u.d-v.d);return a.slice(0,7).map(x=>x.p)})()''')
for p in pts: h.human_click(p['x'],p['y'],duration=.2); wait(.35)
h.press_key('Escape'); click('[data-testid="overlay-paths"]'); wait(14); click('[data-testid="overlay-none"]')

# Let crews solve the earlier material/worker bottleneck, then inspect output.
ffwd(1_200); wait(10); select_place('farm'); wait(14)

# Growth investment competes with survival: designate storage at low priority.
build('storehouse',14)
select_construction('storehouse')
set_selected_site_priority(1,12)
close_catalog(); ffwd(1_900); wait(10)
select_place('storehouse'); wait(10)
if js("document.querySelector('[data-testid=stockpile-filter-food]')!==null"):
    click('[data-testid="stockpile-filter-food"]'); wait(7); click('[data-testid="stockpile-filter-food"]'); wait(7)

# Approach landfall, then visibly experience the live pressure interval.
ffwd(380); wait(14); ffwd(150); wait_expr("window.__townControl.growthSnapshot().scenarioStatus==='storm'"); wait(35)
for mode in ('needs','housing','water'):
    click(f'[data-testid="overlay-{mode}"]'); wait(9)
click('[data-testid="overlay-none"]'); ffwd(700); wait_expr("window.__townControl.growthSnapshot().scenarioStatus==='survived'"); wait(22)

# Build the civic/growth foundation before minds arrive. First stock material,
# then deliberately switch the same three settlers from gathering to building.
click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-3"]'); click('[data-testid="work-priority-wood-3"]'); click('[data-testid="work-priority-stone-3"]'); click('[data-testid="work-priority-build-1"]'); wait(10); click('[data-testid="priorities-toggle"]'); ffwd(10_000); wait(10)
click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-2"]'); click('[data-testid="work-priority-wood-1"]'); click('[data-testid="work-priority-stone-1"]'); click('[data-testid="work-priority-build-3"]'); wait(10); click('[data-testid="priorities-toggle"]')
build('notice-board',14); select_construction('notice-board'); set_selected_site_priority(3,8); close_catalog(); ffwd(5_000); wait(10)
select_place('notice-board'); click('[data-testid="upgrade-building"]'); wait(10)
# Restock after the civic build so the next home is a planned growth investment.
close_catalog(); click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-3"]'); click('[data-testid="work-priority-wood-3"]'); click('[data-testid="work-priority-stone-3"]'); click('[data-testid="work-priority-build-1"]'); wait(10); click('[data-testid="priorities-toggle"]'); ffwd(8_000); wait(10)
build('home',13)
select_construction('home')
set_selected_site_priority(3,8)
close_catalog()
# The inspector exposed the real bottleneck: every settler was tied to gathering.
# Protect the stocked materials, then put the town visibly on construction first.
click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-2"]'); click('[data-testid="work-priority-wood-1"]'); click('[data-testid="work-priority-stone-1"]'); click('[data-testid="work-priority-build-3"]'); wait(12); click('[data-testid="priorities-toggle"]'); ffwd(14_000); wait(14)
# Finish the low-priority storage/upgrade backlog before residents move in.
click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-3"]'); click('[data-testid="work-priority-wood-3"]'); click('[data-testid="work-priority-stone-3"]'); click('[data-testid="work-priority-build-1"]'); wait(10); click('[data-testid="priorities-toggle"]'); ffwd(8_000); wait(10)
click('[data-testid="priorities-toggle"]'); click('[data-testid="work-priority-food-2"]'); click('[data-testid="work-priority-wood-1"]'); click('[data-testid="work-priority-stone-1"]'); click('[data-testid="work-priority-build-3"]'); wait(10); click('[data-testid="priorities-toggle"]'); ffwd(10_000); wait(12)
wait_expr("window.__townControl.listPlaces().filter(p=>p.kind==='home').length>=3")
wait_expr("!window.__townControl.listConstruction().some(p=>p.kind==='storehouse')")

# Characterful growth: choose Mira, then Tama from literal candidate cards.
click('[data-testid="town-growth-toggle"]'); wait_expr("document.querySelector('[data-testid=invitation-agent-0]')!==null"); wait(16)
click('[data-testid="invitation-agent-0"] button'); wait(12); click('button[aria-label="Close resident inspector"]')
wait_expr("window.__townControl.screenForAgent('agent-0')!==null")
click('[data-testid="town-growth-toggle"]'); wait_expr("document.querySelector('[data-testid=invitation-agent-2]')!==null"); wait(16)
click('[data-testid="invitation-agent-2"] button'); wait(12)
wait_expr("window.__townControl.screenForAgent('agent-2')!==null")
if js("document.querySelector('button[aria-label=\"Close resident inspector\"]')!==null"): click('button[aria-label="Close resident inspector"]')

# Minds live under the completed player economy; no social outcome is injected.
for _ in range(14):
    ffwd(80); wait(4)
    if js('window.__townControl.socialSnapshot().sayCount>0'): break
wait_expr('window.__townControl.socialSnapshot().sayCount>0')
wait_expr('window.__townControl.socialSnapshot().mindDecisionCount>0')
wait_expr('window.__townControl.socialSnapshot().proposalCount>0')
wait_expr('window.__townControl.socialSnapshot().assemblyAtNoticeBoard===true')
wait(16)
inspect_agent('agent-0',16)
ins=centre('[data-testid="resident-inspector"]'); h.scroll(ins['x'],ins['y'],dy=430); wait(10); h.scroll(ins['x'],ins['y'],dy=-430); wait(3); click('button[aria-label="Close resident inspector"]')
if js("document.querySelector('[data-testid=world-conversation]')!==null"): click('[data-testid="world-conversation"]'); wait(12); click('button[aria-label="Close resident inspector"]')
inspect_agent('agent-2',14); click('button[aria-label="Close resident inspector"]')

# Retellable story + deterministic replay + built-environment institution.
click('[data-testid="town-chronicle-toggle"]'); wait(14)
panel=centre('[data-testid="town-chronicle"]'); h.scroll(panel['x'],panel['y'],dy=420); wait(4)
wait_expr('''(()=>{const e=document.querySelector('[data-testid="replay-latest-mind"]');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()''')
click('[data-testid="replay-latest-mind"]'); wait_expr("document.querySelector('[data-testid=town-replay-proof]')?.textContent.includes('zero new mind calls')")
panel=centre('[data-testid="town-chronicle"]'); h.scroll(panel['x'],panel['y'],dy=220); wait(14)
wait_expr('''(()=>{const e=document.querySelector('[data-testid="town-replay-proof"]');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()''')
click('[data-testid="town-chronicle-toggle"]')
click('[data-testid="town-board-toggle"]'); wait(12)
panel=centre('[data-testid="town-board"]'); h.scroll(panel['x'],panel['y'],dy=460); wait(4)
wait_expr('''(()=>{const e=document.querySelector('[data-testid="town-board-gathering"]');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()''')
wait(14); click('[data-testid="town-board-toggle"]')

# Final readable town: routes, resources, residents, and completed challenge.
click('[data-testid="overlay-resources"]'); wait(14); click('[data-testid="overlay-none"]'); wait(30)
