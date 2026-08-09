# Luna Island

An emergent-civilization simulation. A population of autonomous agents is dropped on an island and from that point on **nothing is scripted** — they eat, sleep, work, trade, befriend, scheme, and (eventually) invent money, rules, and institutions on their own.

- The **engine** owns ground truth: the world, time, resources, physics of daily life, ownership, inventories.
- The **agents** own their minds: needs, memories, personalities, goals, plans, relationships.
- The **observer (you)** owns time itself: pause, fast-forward, scrub back to any date, click any agent and replay their life like a RollerCoaster Tycoon guest inspector.

Phase 1–2 agents run on a deterministic utility brain. Phase 3 swaps in **LunaBrain** — an LLM adapter behind the same interface — so each villager's decisions come from their own language-model instance with persona and memory.

## Run it

```bash
npm install
npm run dev   # http://127.0.0.1:5175
```

## Checks

```bash
npm run check   # typecheck + determinism/unit tests
npm run e2e     # Playwright smoke (real-GPU headless)
```

See `plans/roadmap.md` for the three-phase plan.
