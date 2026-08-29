"""Drive the Slice 3 acceptance take through real rendered controls."""
from __future__ import annotations

import sys
import time

sys.path.insert(0, r"D:\MyProjects\Claude\browser-harness")
import helpers as h  # noqa: E402


def wait(seconds: float) -> None:
    h.wait(seconds)


def evaluate(expression: str):
    return h.js(expression)


def wait_ready(timeout: float = 25) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if evaluate("window.__townState?.ready === true"):
                return
        except Exception:
            pass
        wait(0.5)
    raise RuntimeError("town never became ready")


def centre(selector: str) -> dict[str, float]:
    expression = f'''(() => {{
      const el = document.querySelector({selector!r});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
    }})()'''
    point = evaluate(expression)
    if not point:
        raise RuntimeError(f"missing visible control: {selector}")
    return point


def click(selector: str, pause: float = 0.8) -> None:
    point = centre(selector)
    h.human_click(point["x"], point["y"], duration=0.3)
    wait(pause)


def hover(point: dict[str, float], pause: float = 1.5) -> None:
    # human_click supplies the harness's smooth pointer path. A zero-click CDP
    # move is then used to leave the pointer in place for the hover label.
    h.cdp("Input.dispatchMouseEvent", type="mouseMoved", x=point["x"], y=point["y"])
    wait(pause)


def visible_tree_block() -> dict[str, float]:
    point = evaluate('''(() => {
      const c = window.__townControl;
      for (let y = 1; y < 47; y++) for (let x = 1; x < 47; x++) {
        if (c.validateBuild("home", x, y).reason !== "trees") continue;
        const p = c.screenForTile(x, y);
        if (p && p.x > 360 && p.x < 900 && p.y > 90 && p.y < 470) return p;
      }
      return null;
    })()''')
    if not point:
        raise RuntimeError("no visible tree-blocked footprint")
    return point


def connected_path_points(limit: int = 7) -> list[dict[str, float]]:
    points = evaluate(f'''(() => {{
      const c = window.__townControl;
      const valid = new Map();
      for (let y = 1; y < 47; y++) for (let x = 1; x < 47; x++) {{
        if (!c.validatePath(x, y).ok) continue;
        const p = c.screenForTile(x, y);
        if (p && p.x > 360 && p.x < 890 && p.y > 120 && p.y < 455) valid.set(`${{x}},${{y}}`, {{x,y,p}});
      }}
      for (const start of valid.values()) {{
        const queue = [start];
        const seen = new Set([`${{start.x}},${{start.y}}`]);
        const out = [];
        while (queue.length && out.length < {limit}) {{
          const cur = queue.shift(); out.push(cur.p);
          for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {{
            const key = `${{cur.x+dx}},${{cur.y+dy}}`;
            if (!seen.has(key) && valid.has(key)) {{ seen.add(key); queue.push(valid.get(key)); }}
          }}
        }}
        if (out.length >= {limit}) return out;
      }}
      return [];
    }})()''')
    if len(points) < limit:
        raise RuntimeError("could not find a connected visible path run")
    return points


h.goto_owned("http://127.0.0.1:5175/")
h.wait_for_load()
wait_ready()
click('[data-testid="speed-0"]')

# Prove the actual 06:00 opening is readable, with objective, alerts, stories,
# named residents, and resources all present at once.
wait(5)

# Daylight QA pose for interaction readability; only the lighting clock is
# overridden. Every gameplay interaction below goes through rendered controls.
evaluate("window.__townControl.setTimeOfDay(11); 1")
wait(2)

# Actionable alert -> one-click resident biography.
click('[data-testid="town-alert"]')
wait(6)
selected_id = evaluate("window.__townControl.interactionState().selectedAgentId")
click('button[aria-label="Close resident inspector"]')

# Hover label and direct world selection of that same named resident.
agent_point = evaluate(f'window.__townControl.screenForAgent({selected_id!r})')
hover(agent_point, 3)
h.human_click(agent_point["x"], agent_point["y"], duration=0.35)
wait(5)
click('button[aria-label="Close resident inspector"]')

# Useful world overlays, switched through the player-facing buttons.
for test_id in ("overlay-needs", "overlay-housing", "overlay-jobs"):
    click(f'[data-testid="{test_id}"]')
    wait(3)
click('[data-testid="overlay-none"]')

# Civic surface that Luna-mind proposals and standing rules will populate.
click('[data-testid="town-board-toggle"]')
wait(5)
click('[data-testid="town-board-toggle"]')

# Exact-footprint obstacle rule over the rendered canopy.
click('[data-testid="build-toggle"]')
click('[data-testid="build-home"]')
tree_point = visible_tree_block()
h.human_click(tree_point["x"], tree_point["y"], duration=0.45)
wait(5)
h.press_key("Escape")
wait(1)

# Paint a connected logistics path using repeated canvas clicks.
click('[data-testid="path-tool"]')
for point in connected_path_points():
    h.human_click(point["x"], point["y"], duration=0.18)
    wait(0.35)
wait(4)
h.press_key("Escape")

# Designate a real producer site. Its world badge, town alert, staged model,
# and building diagnostics appear from the same deterministic simulation.
click('[data-testid="build-toggle"]')
click('[data-testid="build-farm"]')
farm_point = evaluate('''(() => {
  const c = window.__townControl;
  const tile = c.findBuildable("farm");
  return tile ? c.screenForTile(tile.x, tile.y) : null;
})()''')
if not farm_point:
    raise RuntimeError("no visible farm plot")
h.human_click(farm_point["x"], farm_point["y"], duration=0.45)
wait(7)
h.press_key("Escape")
wait(4)

# Night visibility floor: buildings, residents, objective, and town pulse all
# remain readable without changing the simulation clock.
evaluate("window.__townControl.setTimeOfDay(1); 1")
wait(7)
evaluate("window.__townControl.setTimeOfDay(6); 1")
wait(5)
