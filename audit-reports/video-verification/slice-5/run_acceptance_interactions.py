"""Drive the Phase 3 minds acceptance take through the rendered town UI."""
from __future__ import annotations
import sys, time
sys.path.insert(0, r"D:\MyProjects\Claude\browser-harness")
import helpers as h  # noqa: E402

def wait(n: float) -> None: h.wait(n)
def js(s: str): return h.js(s)
def wait_expr(s: str, timeout: float = 40) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if js(s): return
        except Exception: pass
        wait(.35)
    raise RuntimeError(s)
def centre(sel: str):
    p = js(f'''(()=>{{const e=document.querySelector({sel!r});if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}}}})()''')
    if not p: raise RuntimeError(sel)
    return p
def click(sel: str, pause: float = .8) -> None:
    p=centre(sel); h.human_click(p['x'],p['y'],duration=.3); wait(pause)

h.goto_owned('http://127.0.0.1:5175/town.html?brain=mock&mindWallFloorMs=0&mindMinGapTicks=5')
h.wait_for_load(); wait_expr('window.__townState?.ready===true'); click('[data-testid="speed-0"]'); wait(4)

# Deterministic scenario setup. It uses the same command, construction, growth,
# invitation, mind, conversation, institution, and replay paths as live play.
js('''(async()=>{
 const c=window.__townControl; let p=c.findBuildable('home'); c.issueBuild('home',p.x,p.y);
 p=c.findBuildable('well'); c.issueBuild('well',p.x,p.y); await c.ffwd(4500);
 p=c.findBuildable('notice-board'); c.issueBuild('notice-board',p.x,p.y); await c.ffwd(1200);
 const b=c.listPlaces().find(x=>x.kind==='notice-board'); c.upgradePlace(b.id); await c.ffwd(1200);
 p=c.findBuildable('home'); c.issueBuild('home',p.x,p.y); c.setWorkPriority('wood',3); c.setWorkPriority('build',3); await c.ffwd(8000);
 c.acceptInvitation('agent-0'); await c.ffwd(1); c.acceptInvitation('agent-2'); await c.ffwd(1200);
 return c.socialSnapshot();
})()''')
js('window.__townControl.setTimeOfDay(11);true'); wait_expr('window.__townControl.socialSnapshot().sayCount>0'); wait(7)

# Mira: biography, aspiration, explicit opinion about observed player facts, and
# the mind-authored action that is stored in the replay trace.
p=js("window.__townControl.screenForAgent('agent-0')")
h.human_click(p['x'],p['y'],duration=.4); wait(9)
ins=centre('[data-testid="resident-inspector"]'); h.scroll(ins['x'],ins['y'],dy=420); wait(6); h.scroll(ins['x'],ins['y'],dy=-420); wait(2)
click('button[aria-label="Close resident inspector"]')

# Speech is visible over the speaker in the world and selects that biography.
if js("document.querySelector('[data-testid=world-conversation]')!==null"):
    click('[data-testid="world-conversation"]'); wait(7); click('button[aria-label="Close resident inspector"]')

# Tama is a second distinct resident, not an anonymous population unit.
p=js("window.__townControl.screenForAgent('agent-2')")
h.human_click(p['x'],p['y'],duration=.4); wait(8); click('button[aria-label="Close resident inspector"]')

# Chronicle surfaces the story arc, transcripts, and trace-backed replay proof.
click('[data-testid="town-chronicle-toggle"]'); wait(9)
click('[data-testid="replay-latest-mind"]'); wait(9)
click('[data-testid="town-chronicle-toggle"]')

# Society uses the built civic venue; the board retains the assembly record.
click('[data-testid="town-board-toggle"]'); wait(10)
click('[data-testid="town-board-toggle"]'); wait(8)
