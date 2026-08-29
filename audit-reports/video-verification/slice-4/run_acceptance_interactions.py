"""Drive the Slice 4 acceptance take through real rendered town controls."""
from __future__ import annotations

import sys
import time

sys.path.insert(0, r"D:\MyProjects\Claude\browser-harness")
import helpers as h  # noqa: E402


def wait(seconds: float) -> None:
    h.wait(seconds)


def evaluate(expression: str):
    return h.js(expression)


def wait_expr(expression: str, timeout: float = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if evaluate(expression):
                return
        except Exception:
            pass
        wait(0.35)
    raise RuntimeError(f"condition timed out: {expression}")


def centre(selector: str) -> dict[str, float]:
    point = evaluate(f'''(() => {{
      const el = document.querySelector({selector!r});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
    }})()''')
    if not point:
        raise RuntimeError(f"missing visible control: {selector}")
    return point


def click(selector: str, pause: float = 0.8) -> None:
    point = centre(selector)
    h.human_click(point["x"], point["y"], duration=0.3)
    wait(pause)


def connected_path_points(limit: int = 6) -> list[dict[str, float]]:
    points = evaluate(f'''(() => {{
      const c = window.__townControl;
      const valid = new Map();
      for (let y = 1; y < 47; y++) for (let x = 1; x < 47; x++) {{
        if (!c.validatePath(x, y).ok) continue;
        const p = c.screenForTile(x, y);
        if (p && p.x > 335 && p.x < 880 && p.y > 110 && p.y < 455) valid.set(`${{x}},${{y}}`, {{x,y,p}});
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


def build_from_catalog(kind: str, settle: float = 4.0) -> None:
    # Open the catalog only when it is currently closed.
    if not evaluate('document.querySelector("[data-testid=build-menu]") !== null'):
        click('[data-testid="build-toggle"]', 0.7)
    click(f'[data-testid="build-{kind}"]', 0.7)
    point = evaluate(f'''(() => {{
      const c = window.__townControl;
      const tile = c.findBuildable({kind!r});
      return tile ? c.screenForTile(tile.x, tile.y) : null;
    }})()''')
    if not point:
        raise RuntimeError(f"no visible buildable {kind} plot")
    h.human_click(point["x"], point["y"], duration=0.45)
    wait(settle)
    h.press_key("Escape")
    wait(0.6)


def close_catalog() -> None:
    if evaluate('document.querySelector("[data-testid=build-menu]") !== null'):
        click('[data-testid="build-toggle"]', 0.8)


def ffwd(ticks: int, timeout: float = 45) -> None:
    evaluate(f'''(() => {{
      window.__slice4FastForwardDone = false;
      window.__townControl.ffwd({ticks}).then(() => {{ window.__slice4FastForwardDone = true; }});
      return true;
    }})()''')
    wait_expr("window.__slice4FastForwardDone === true", timeout)


h.goto_owned("http://127.0.0.1:5175/town.html?brain=mock&noNewConversations=1&mindWallFloorMs=0")
h.wait_for_load()
wait_expr("window.__townState?.ready === true", 25)
click('[data-testid="speed-0"]')

# 00: opening proof — the real scenario, resources, threat, objectives, and
# starter Appeal are all readable at once.
wait(5)
evaluate("window.__townControl.setTimeOfDay(11); true")
wait(2)

# Appeal is a six-part town state, with a milestone ladder and a storm gate.
click('[data-testid="town-growth-toggle"]')
wait(7)
click('[data-testid="town-growth-toggle"]')

# The catalog exposes the full ladder while explaining exact locked thresholds.
click('[data-testid="build-toggle"]')
wait(6)
click('[data-testid="build-toggle"]')

# Player planning overlays are world-readable, not spreadsheet-only.
for test_id in ("overlay-resources", "overlay-fertility", "overlay-water", "overlay-ownership"):
    click(f'[data-testid="{test_id}"]')
    wait(3)
click('[data-testid="overlay-none"]')

# Paint a real logistics route, then inspect the resulting route overlay.
click('[data-testid="path-tool"]')
for point in connected_path_points():
    h.human_click(point["x"], point["y"], duration=0.18)
    wait(0.25)
h.press_key("Escape")
click('[data-testid="overlay-paths"]')
wait(5)
click('[data-testid="overlay-none"]')

# Designate the concrete survival investments through the rendered catalog and
# world canvas. Villagers own delivery and construction.
build_from_catalog("home", 5)
build_from_catalog("well", 5)
close_catalog()

# Deterministic time compression only; the result is the same live simulation.
ffwd(4_500)
wait(5)

# The survived storm plus a civic building moves the town through the ladder.
build_from_catalog("notice-board", 5)
close_catalog()
ffwd(1_200)
wait(4)
click('[data-testid="town-growth-toggle"]')
wait_expr('document.querySelector("[data-testid=invitation-offer]") !== null', 15)
wait(8)

# The player chooses a named Luna instead of receiving anonymous population.
click('[data-testid="invitation-agent-0"] button')
wait(3)

# Five live ticks are enough for the attached production mind service to author
# and record Mira's first town-economy decision.
ffwd(5)
wait_expr('document.querySelector("[data-testid=resident-mind-decision]") !== null', 15)
wait(7)

# Scroll the actual inspector to show player-made facts observed by the resident.
inspector = centre('[data-testid="resident-inspector"]')
h.scroll(inspector["x"], inspector["y"], dy=430)
wait(7)
h.scroll(inspector["x"], inspector["y"], dy=-430)
wait(2)
click('button[aria-label="Close resident inspector"]')

# Select the civic building in-world and commission a materialized tier upgrade.
board_point = evaluate('''(() => {
  const c = window.__townControl;
  const board = c.listPlaces().find((place) => place.kind === "notice-board");
  return board ? c.screenForPlace(board.id) : null;
})()''')
if not board_point:
    raise RuntimeError("notice board is not visible")
h.human_click(board_point["x"], board_point["y"], duration=0.4)
wait(4)
click('[data-testid="upgrade-building"]')
wait(8)

# Complete the same materialized site and show its visible Level 2 result.
ffwd(1_200)
board_point = evaluate('''(() => {
  const c = window.__townControl;
  const board = c.listPlaces().find((place) => place.kind === "notice-board");
  return board ? c.screenForPlace(board.id) : null;
})()''')
if board_point:
    h.human_click(board_point["x"], board_point["y"], duration=0.4)
wait(10)
