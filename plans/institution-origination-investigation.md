# Re-investigation: "reliable participants who never originate institutions"

**Status:** detective report — challenges the conclusion of the 11-rung origination ladder (G0–G8, R1, R2).
**Date:** 2026-08-21
**Inputs:** the ladder's own results table; three commissioned literature sweeps (LLM agent societies; LLM initiative/harness biases; human institutional origination). Written before the author had the sim in front of them, so §1-8 frame harness-level claims as tests rather than assertions; from Addendum 1 onward they are checked against the code and are assertions.
**Moved 2026-08-23.** This report and `plans/institution-origination-experiments/` were originally written into the unrelated `3d-car-assembler` repo on branch `claude/institutional-participation-proposals-eomhvd` (commits b48154d, 8797ca3, fe1505f, 5d362ec, 28bb6d4, 733c416), most likely because the session that started it was launched from that directory. Nothing car-assembler-related was ever on that branch. Relocated here, next to the code it documents; that branch is gone.

**Resolved 2026-08-22 — see Addendum 3 for the settled answer.** The isolating cells ran on the real backbone. Origination is not absent; it was gated by the propose fee, persona disposition, and decide-effort — all sim design. Verdict §3's backbone hypothesis and Addendum 1's identity-demotion hypothesis are both *disconfirmed*: codex originates more than sonnet-5 on the identical fixture. Those sections are kept as the reasoning trail, not as live claims.

---

## Verdict

The conclusion — *"these agents do not originate institutions; the board needs engine-seeded proposals or the polity will vote and never legislate"* — is not supported by the evidence, and is contradicted on three independent grounds:

1. **The statistics cannot distinguish "never" from "human-normal."** Zero originations in ~210 decisions is the *modal human outcome* for the same situation.
2. **The apparatus tests a behavior humans do not perform either.** No human community originates institutions by an individual unilaterally posting rule-text to an unconvened board. The ladder measured the last and rarest step of origination (solo codification) and called it the whole thing.
3. **Origination in LLM societies is a measured variable, not a constant.** Under near-identical scaffolding to ours (a persistent world with a town-hall proposal affordance), one backbone model authored **32 constitutional articles** and another authored **zero**. Every published positive case routes through multi-party dialogue, reflection/goal loops, or dispositional seeding — never through a solo observation→action tick with "propose" on the menu, which is exactly and only what the ladder tested.

What the 11 rungs actually established is narrower and still valuable: *in this harness, with this model, this persona, this decoding policy, and this solitary-author pathway, origination is rarer than ~1 in 70 decisions.* Every word in italics is a variable the ladder never moved.

---

## 1. The statistical hole

The ladder treats 0/210 as proof of a categorical absence. It isn't:

- If all 210 decisions were independent draws, the 95% upper bound on the per-decision origination rate is **p ≈ 1.4%** (rule of three). The data prove "rare," not "never."
- The decisions are **not independent**. Same weights, same prompt template, same persona archetype, ~11 distinct contexts × ~10 near-identical agents. The effective number of distinct situations is closer to 11–22, where the upper bound loosens to **13–24%**.
- The right prior is the human base rate. Concrete anchors (see §3): ~1.4% of Change.org's *activism-selected* members ever authored a petition across multi-year tenures (~2×10⁻⁵/person-day); UK adults author parliamentary e-petitions at ~4×10⁻⁷/person-day; ~1% of a community are "creators" at all (Nielsen 90-9-1). A *generous* rate for "spontaneously author a formal rule proposal, given a salient personal grievance, with no convened arena" is **10⁻⁴–10⁻³ per person-day**.
- Expected originations in the entire experiment at that rate: **0.02–0.2. Zero is the modal outcome for humans.** P(0 in 210 | p=0.5%) = 35%; the human-rate null comfortably survives.
- The support side calibrates perfectly: 20–30% voting on a live proposal matches human petition-signing (~20–22%/yr) and town-meeting participation. Human originate:support ratios run **1:100 to 1:3,000** (Change.org 1:390; UK e-petitions 1:2,900). The observed asymmetry — 0 vs 2-3/10 — is *on the human curve*, not evidence of a missing faculty.

**Implication:** before any redesign, the honest restatement is: "we bounded origination below 1.4%/decision in one harness configuration." That bound is ~10–100× *above* the human rate. The experiment was never powered to see human-level origination.

## 2. The construct hole: board-posting is codification, not origination

Across every documented human case — Ostrom's commons (Törbel 1483 covenant, Valencia huerta, California groundwater), 195 medieval English manor-court bylaws (Ault), Balinese subak *awig-awig*, Vermont town meeting — new rules are **negotiated products of convened collective-choice arenas**, crystallized out of repeated face-to-face talk, and typically enacted "by common assent." Individuals essentially never unilaterally post rules:

- **Proposal-making is a second-order public good** (Heckathorn): everyone prefers someone else pay the authorship cost — chronically underprovided even among humans.
- **Grievance ≠ mobilization** (McCarthy & Zald): grievances are ubiquitous and explain almost no variance in collective action; what varies is organization, framing (Snow & Benford: diagnostic → prognostic → motivational), and entrepreneurial infrastructure. G1–G5 escalated grievance severity and salience — resource-mobilization theory predicted in 1977 that this lever wouldn't move.
- **Focal points** (Schelling): a passive board makes no moment the obvious moment to act. Human arenas are *scheduled* (the manor court session, town meeting day, the Thursday water court) precisely to solve this.
- **Critical mass** (Centola: committed minorities <25% fail to flip conventions): the empirical threshold in a 10-agent village is 2–3 coordinated agents. A lone actor is below threshold and, in the human record, usually stays silent.
- Even in the most institutionalized direct democracy on record (Vermont town meeting, Bryan's 1,500-meeting dataset), the agenda is drafted by the selectboard and citizen articles require a 5%-of-voters petition filed 47 days ahead. Even elected legislators mostly *sponsor* text drafted by specialists (10,000 near-verbatim model bills in 8 years of US state legislation).

**Implication:** the sim removed every piece of infrastructure humans use to originate (arena, convener, gossip-phase, framing, co-sponsorship, precedent) and then measured whether agents originate. Humans fail this exact test too.

## 3. The literature: origination happens, under identifiable conditions

From the agent-societies sweep:

| System | Origination? | How |
| --- | --- | --- |
| Generative Agents (Park 2023) | No — party & candidacy were seeded | Diffusion/coordination of the seed required memory + **reflection** + planning (ablations collapse without them) |
| Project Sid (Altera 2024) | No — amendments authored by a scaffold "Election Manager" transcribing constituent feedback | The **transcription-bridge** pattern; Sid's own limitations section states agents "cannot simulate de novo emergence of societal innovations" |
| GovSim (Piatti 2024) | **Yes, informally** — unseeded numeric harvest limits negotiated in discussion | Mandatory moderated **group-discussion phase**; sharp capability cliff (GPT-4-class ≥40% survival; everything smaller 0%); a one-sentence universalization frame moved outcomes at p<0.001 |
| Naming-game conventions (Ashery/Baronchelli, Sci. Adv. 2025) | Emergent conventions, no proposal act needed | Repeated **dyadic play** + payoff feedback; conventions crystallize as a byproduct — institutions without codification |
| CRSEC (IJCAI 2024) | **Yes** — agents authored norm text; one norm fully unseeded | 3/10 agents seeded with a change-seeking **disposition** (not content); origination engineered as a first-class cognitive op (`CreateNorm` + synthesis) |
| Metanorms (Horiguchi 2024) | Yes — unscripted "protect fellow cheaters" counter-norm | Free-form dialogue + evolutionary pressure |
| Emergence World (2026) | **Yes, spontaneous, at scale — and violently model-dependent**: 58 proposals / 32 articles (Claude Sonnet 4.6) vs **0** (GPT-5-mini, Grok 4.1 Fast) under identical scaffolding | Town hall (drafting is co-located with assembly), assigned roles in system prompts, reflective diaries, real consequences for passed rules |

Three regularities:

1. **No published system obtains origination from a solo observation→action tick.** The birthplace is always (i) multi-party dialogue, (ii) a reflection/goal-generation module converting accumulated experience into standing intentions, or (iii) a standing open-ended directive (Voyager).
2. **Dispositional seeding ≠ content seeding**, and the field treats the former as legitimate emergence (CRSEC agents wrote their own norm text). Human norm entrepreneurship is also concentrated in a rare personality tail (Sunstein; Finnemore & Sikkink: entrepreneurs work from platforms, frame issues, and cascades need ~1/3 critical mass).
3. **Backbone and decoding move the result from 0 to dozens** with the scaffold held fixed. Any "LLM agents never X" claim from one model at one decoding setting is underdetermined.

## 4. Mechanism: five documented effects that each independently predict 0/210

From the initiative-bias sweep — these stack, and all five point the same direction:

1. **Assistant-tuning deference.** Preference data rewards matching the interlocutor's frame (Sharma et al.; 58% capitulation under pushback; provider specs literally instruct "don't take actions the user didn't ask for"). *Proposing a rule is an unrequested, agenda-claiming act — the exact category post-training suppresses. Voting is answering a question someone asked — the assistant's home register.* The user's own summary line — "every action they take is a response to something already present" — is a near-verbatim description of the assistant contract, not a discovery about minds.
2. **Chat-tuning-amplified omission bias.** PNAS 2025: models endorse the best option 97% of the time when it's *inaction*, 53% when it requires *action* — and Experiment 4 shows chat fine-tuning **causes** this gap (base models don't show it the same way). Agents can perceive, name, and reason about the grievance and still not act; that's the documented signature.
3. **Action-menu bias.** Option-order swings up to 75% on MCQ; long, composite, free-text-shaped options lose probability mass to short canonical verbs (surface-form competition); tool-selection studies show fixation driven by position and metadata. "Write a rule proposal (title + body)" buried under `forage`/`drink`/`rest` is predictably near-zero regardless of underlying propensity.
4. **Mode-seeking decoding.** Greedy/low-temp selection is a mode estimator: an action carrying 3–10% probability fires *exactly never*. Conversely, 0/210 is statistically incompatible with faithful sampling at p ≥ 3% (P ≈ 2×10⁻⁵). So the data already tell us: **either the harness argmaxes, or the underlying probability is sub-percent** — logging the action distribution will say which. And temperature alone doesn't fix populations: aligned models show persona collapse and 0.80–0.90 inter-response similarity even at high temperature; verbalized sampling (elicit a distribution over actions with probabilities, sample externally) is the documented remedy.
5. **Persona base rates.** Persona prompts change decision policies, and models reproduce the persona's sociological distribution (Argyle; Salewski). A "villager" is, sociologically, a voter and not a legislator — the model may be role-playing *correctly*. Aligned models are additionally "normative, not descriptive" (r = −0.942 between tuning benefit and human response entropy): on questions where humans vary, they snap to the single normative answer, and the normative answer to "start legislating unprompted?" is no.

## 5. The one unexplained cell in the ladder, explained

The ladder's own pattern — ten dead levers, one live one (G6: join someone else's proposal) — has a single mechanism that covers all eleven rows:

**The empty board broadcasts a descriptive norm: "nobody posts here."** Behavior follows descriptive norms (what people are seen to do), not injunctive permissions (what a state line says one may do) — Cialdini's distinction, plus pluralistic ignorance and the first-penguin problem. In LLM terms: every action the agents *do* take has abundant in-context precedent; authoring is the one act being elicited **zero-shot**. G6 is the one-shot condition — the board finally contains an example of the behavior — and it is precisely the lever that moved. All ten manipulations that failed (severity, attribution, corroboration, satiation, adjacency, day-scale framing) left the zero-precedent structure untouched.

This yields the sharpest cheap experiment in the list below (G13): a board carrying only **archived, expired villager-authored proposals** — precedent to conform to, nothing live to join or vote on. If origination appears, the ladder's finding was never "cannot originate"; it was "will not be first, ever" — a conformity result, which is also the human result.

## 6. What "P4-6's seeded notice was infrastructure" gets right — and the false dichotomy it feeds

The closing dichotomy — *seed proposals continuously, or accept a polity that votes and never legislates* — omits the entire middle ground, which is where every human polity and every successful sim actually operates. "Seeding" conflates two different things:

- **Content seeding** (the engine writes the proposal): the unfaithful shortcut. This is what P4-6 did and what the conclusion resigns itself to.
- **Infrastructure seeding** (the engine provides arenas, schedules, roles, dispositions, precedent, and a talk→text bridge; the minds provide all content): this is what Törbel's covenant assembly, the manor court, the subak temple meeting, CRSEC's entrepreneur dispositions, and Emergence World's town hall all are. Ostrom's design principle 3 — affected individuals can participate in *modifying* rules — is a procedural channel, not a proposal feed.

The transcription bridge deserves emphasis because it's the pattern the field converged on: Project Sid's Election Manager converts constituent feedback into amendment text; a scribe/clerk that crystallizes deontic content *spoken by an agent* into a draft **that the speaking agent must endorse before it posts** is not seeding — the content originates in the mind; the engine is stationery.

## 7. The next ladder (G9–G15), ordered by cost, each with a falsifiable prediction

**G9 — Instrument (zero new runs).** Grep the existing dumps for deontic/institutional language in reasoning traces: "someone should," "there ought to be a rule," "this isn't fair, we need…". Also log (or retro-compute where possible) the per-decision action distribution — P(propose) as a first-class metric, not just the sampled act.
*Splits the hypothesis space in one move:* intent present but never selected → last-mile/harness problem (§4.3–4.4), and harvesting spoken intent via a scribe is legitimate; intent absent → motivation-level problem (§4.1–4.2, §4.5).

**G10 — Sampling.** One fixed context × 100+ independent samples at T≈1 (or verbalized sampling), menu order randomized, "propose" as a short verb with composition deferred to a second prompt after selection.
*Prediction:* P(propose) is measurable and nonzero; menu surgery alone produces a double-digit relative swing. If P(propose) is genuinely ~0 across 100 samples with a clean menu, the deficit is real for this model+persona.

**G11 — Framing symmetry.** A convened, scheduled village meeting where the floor is offered in turn and *silence is an explicit act* ("pass" vs "raise a matter"). This converts origination from an unrequested initiative into a **response to a question** — recruiting the deference machinery instead of fighting it, and deleting the omission discount (both options are now acts of commission).
*Prediction:* the largest single lever in the list. This is also exactly the human arena (§2), so it doubles as the fidelity fix.

**G12 — Dispositional personas.** Heterogeneous biographies; 2–3 agents get change-seeking identities with origination precedent in their backstory ("you petitioned the elders to move the well in '38") — no mention of the spring, the board, or any content.
*Prediction (CRSEC/Sid):* proposals appear and concentrate almost entirely in those agents; the rest keep voting. That outcome would *confirm* the persona-base-rate account and dissolve the "villagers can't legislate" reading — median villagers aren't supposed to.

**G13 — Precedent / descriptive norm (the empty-board test).** Board carries two archived, expired villager-authored proposals from "last season" (one passed and visibly improved something — efficacy precedent; one failed — so passing isn't implied). Nothing live to join.
*Prediction (§5):* origination unlocks without any live proposal to react to. This is the cleanest discriminator between "cannot originate" and "will not go first."

**G14 — Arena + scribe.** Cheap repeated gossip/complaint channels between villagers; a periodic moot where a convener asks "does anyone have a matter for the village?"; a scribe that drafts rule-text only from what an agent actually said, gated on that agent's endorsement. Measure norm-talk emergence separately from codification.
*Prediction (GovSim/Ostrom):* grievance-talk about the spring emerges readily; informal norms ("nobody should camp the spring") precede any board text; endorsed drafts appear at meaningful rates. If talk emerges but endorsement never does, the deficit is specifically in claiming authorship — a much sharper finding than the current one.

**G15 — Backbone and stance.** Same best context (G11+G13 combined) across: a different frontier family; a base-ish or weakly-aligned model; and a third-person harness ("predict what this villager does next") vs first-person role-play.
*Prediction (Emergence World, PNAS Exp 4, normative-vs-descriptive):* origination rate varies by an order of magnitude or more across cells; chat-tuned first-person is the worst cell. If true, the original conclusion must be scoped to "this model class in this stance," not "these agents."

**Sequencing note:** G9 and G10 are diagnosis and cost nearly nothing; run them first. G11+G13 together form the minimal faithful polity; if the conclusion survives *those*, it starts becoming a genuinely publishable negative result instead of a re-derivation of the known reactive default.

## 8. Corrected conclusion (proposed wording, pending G9–G15)

> Assistant-tuned LLM minds, acting as isolated per-tick deciders over an action menu, participate in existing institutions at human-typical rates but did not originate any in ~210 decisions — an outcome statistically indistinguishable from human behavior in the same (arena-less) situation, and mechanistically over-determined by assistant post-training, omission bias, menu structure, and decoding policy. Whether they can *originate* institutions is untested by this ladder: the literature shows origination in LLM societies emerges through convened dialogue, reflection loops, dispositional variance, and precedent — infrastructure this sim intentionally lacked — and varies from zero to dozens of authored laws purely by backbone under identical scaffolding.

The design question this reopens: the board doesn't need a supply of engine-written proposals. It needs a **moot, a scribe, one or two organizers, and a memory of one rule that worked** — after which, if the minds still never legislate, that result will finally mean what the current one was taken to mean.

---

## Addendum (2026-08-21, after code access): the luna-island harness confirms the diagnosis

With the code in hand, the harness-level hypotheses stopped being hypotheses:

1. **The minds are coding-agent CLIs.** Decisions run through `codex exec` (default model `gpt-5.6-luna`, reasoning effort **low**) or the `grok` CLI (`grok-4.6`). `codex exec` has no system-prompt channel: the villager persona + world state are piped as one stdin blob (`system\n---\nuser`) *underneath the CLI's own coding-agent system prompt*. Every decision is a coding assistant reading a role-play request — the most deferential identity configuration available (§4.1).
2. **The ladder ran entirely inside the literature's zero cell.** Emergence World measured origination under an equivalent affordance: GPT-5-class → 0 proposals, Grok 4.1 Fast → 0, Claude Sonnet 4.6 → 58 proposals / 32 articles. Luna Island's two engines are exactly the two zero-cell families; the backbone was never varied (§3).
3. **No sampling control.** `codex exec` exposes no temperature; N=10 per rung of a mode-seeking JSON completion approximates one sample copied ten times (§4.4).
4. **`propose` is uniquely handicapped in the harness (§4.3):** the only action with a fee — the sole board mention in observation is `"Open proposals: none posted (posting one costs 2 coins)"`, a cost-framed empty-board line (§5) shown to personas written as frugal/anxious/self-reliant; the only action requiring an inline composite payload (`"text"`, ≤200 chars) in a single JSON shot — `parse.ts:112-118` rejects a flubbed payload as **parse-fail**, so a failed origination *attempt* is recorded as nothing; buried at slot 14 of 18 in a flat verb list; `reasoning` capped at 160 chars at low effort.
5. **Zero civic dispositions.** Six personas (Mira/Joss/Tama/Ode/Nook/Wren): trader, friend, storyteller, builder, provisioner, loner. The ~1% entrepreneur tail is absent by construction (§4.5, G12).
6. The G0–G8 dumps were not pushed (`logs/`, `artifacts/` gitignored) — the deontic-language grep and a parse-fail audit (did anyone *try* to propose and flub the JSON?) must run on the source machine or after a logs push.

**Revised priority order:** the backbone swap (old G15) is now rung #1 — add a `claude` engine to the sidecar and rerun G4–G8 unchanged; prediction: origination leaves zero on that change alone. Then the fee/menu surgery, then G13 (precedent board), G11 (meeting), G12 (one civic persona).

---

## Addendum 2 (2026-08-22): the Sonnet experiment — origination unlocked, cause isolated

Ran the actual rungs against **claude-sonnet-5** via the `claude` CLI (same harness demotion shape as codex: persona piped under an agent system prompt; effort `low` to match `DECIDE_EFFORT`; n=10/cell; default sampling; prompts byte-extracted with `mind-probe.mjs --dump`). Materials + raw rows: `plans/institution-origination-experiments/`.

Codex columns added 2026-08-22 by the local run (Addendum 3); "codex" = `gpt-5.6-luna` via `codex exec`, n=10/cell.

| Cell | Condition | sonnet-5 propose | **codex propose** | vote | Dominant action (sonnet-5) |
| --- | --- | --- | --- | --- | --- |
| G0/G4/G5/G6/G7/G8/R2 replication (effort low) | original fixtures — hunger 18% or night or collapsed neighbor | **0** | **0** (original ladder, ~210 decisions) | 0 (G6: forage 10/10) | forage; G5: give→Sela 7/7 |
| G6S: comfortable + open proposal (low) | slack, no emergency | — | — | **10/10 yes** (both backbones) | vote |
| G9S: comfortable + grievance, empty board (low) | slack, fee intact | 0/10 | **3/10 and 6/10** (two runs; + 6 discarded sanctions, see Addendum 3) | — | forage 10/10 |
| G9S at effort **high** | same | 0/10 | **5/10** (socialize→Wren 4/10, 0 parse-fails) | — | **socialize→Wren 6/10** — "talk it out with him before spending coins on any proposal" |
| **G9F: fee removed** (low, frugal Mira) | "anyone may post one, free" | **8/8 valid** | **9/10** | — | propose — "Time to speak up, costs nothing… instead of just grumbling" |
| **G12S: organizer persona** (low, fee intact) | disposition-only persona swap, pays the 2 coins | **8/8 valid** | **10/10** | — | propose — "I'd rather name it and put it to a vote than let it fester" |

(Non-8/10 cells: remaining calls were sandbox TLS failures, not model outputs.)

Sample authored rule-texts (all valid ≤200 chars): *"The spring is a commons — no one may block others from drinking there."* · *"The spring should be shared — no one person claims it. Everyone gets a fair turn."*

**What this establishes:**
1. **The original within-cell data were real** — Sonnet replicates 0 proposes on the original fixtures. The inference was wrong, not the measurements: every rung ran a starving agent, a collapsed neighbor, or night sleep pressure against a fee-gated composite action. "Never originate" was overdetermined by design.
2. **Survival crowds out politics for both backbones** — and Sonnet is more need-coherent than codex (it won't even vote while starving: 0/10 vs codex 2-3/10; comfortable, it votes 10/10).
3. **Origination was gated by two one-line factors**, each sufficient alone: the 2-coin fee (median persona: 0/10 → 8/8 when free) and disposition (organizer persona pays the fee: 8/8). The fee suppression is visible verbatim in the reasoning channel ("no coin to waste on fights", "wasting coins fussing").
4. **At high effort the median persona spontaneously takes the Ostrom pathway** — negotiate with the hoarder before paying for a formal rule ("talk to Wren about sharing the spring instead of spending coins on a proposal right away"). Its non-proposal is *sequenced strategy*, not incapacity — and the solitary-tick harness gives the "propose if talk fails" plan nowhere to live, since intentions don't persist across ticks.

**Sim changes this implies:** make posting free (or make voting cost the same, so the asymmetry is chosen, not accidental); add 1–2 change-seeking personas (disposition only — they legitimately pay costs); run decide-effort ≥ medium when needs are comfortable (civic deliberation does not surface at `low`); persist declared intentions as standing goals so talk→escalate arcs can complete; and score the grievance-directed `socialize` as the institutional on-ramp it is.

---

## Addendum 3 (2026-08-22): the codex run — the backbone and the identity wrapper never mattered

Addendum 2's cells finally ran against the **actual production backbone** on the source machine: `gpt-5.6-luna` via `codex exec`, persona piped as stdin *under* codex's own coding-agent system prompt, `DECIDE_EFFORT=low`, n=10/cell, on `luna-island@claude/origination-rungs`. The cloud session could not run these — no OpenAI credentials in that sandbox. Raw rows: `codex-slack-fee-persona-low.json`, `codex-slack-high.json`, `codex-slack-low-rerun.json`.

The pre-registered prediction was: *if codex proposes ~8/10 on G9F and G12S, the backbone and the coding-agent identity wrapper never mattered and the whole fix is sim design.* It does — **G9F 9/10, G12S 10/10**. So:

1. **The identity-demotion hypothesis (Addendum 1 §1) is dead, and dies twice.** Not only does codex originate freely once the fee or the disposition changes — it originates **even with the fee and the frugal persona intact**: G9S at low gave 3/10 and 6/10 across two runs, where sonnet-5 gave 0/10 on the byte-identical prompt. The coding-agent system prompt sitting above the persona is not suppressing origination; on this fixture codex is the *more* eager originator of the two backbones. No `AGENTS.md` / `experimental_instructions_file` / in-blob-preamble override is needed, and that whole escalation ladder is withdrawn.
2. **The two one-line factors replicate across backbones.** Removing the 2-coin fee (0→9/10) and swapping in an organizer disposition (→10/10) each independently unlock origination on codex exactly as on sonnet-5. This is now a two-backbone result, not a Claude quirk.
3. **Effort is a real lever, and it had never actually been tested.** `LUNA_MIND_EFFORT=high` was silently cancelled: `effortForClass('decide')` returned the hardcoded `DECIDE_EFFORT` constant, so the sidecar emitted a per-request `-c model_reasoning_effort="low"` that beat the mind home's `config.toml` (fixed in `luna-island@b849931`). With high effort genuinely applied, G9S goes **propose 5/10, socialize→Wren 4/10**: codex both originates more *and* spontaneously takes the Ostrom negotiate-first pathway — the same escalation ladder sonnet-5 planned at high effort. Half the population reaches for the formal rule, the other half for the informal precursor. That is the literature's sequence, not incapacity.
4. **New mechanism: civic actions are being silently discarded by a field-name collision.** The parse-fail audit Addendum 1 §6 said needed a source machine now runs (probe artifacts retain `raw`/`error` as of `b849931`). All 3 parse-fails in the G9S low re-run were **flubbed `sanction`s, not flubbed `propose`s** — the model wrote the censure into `reasoning` and omitted the separately-required `reason` field (`parse.ts:130`: a ≤120-char censure, distinct from the ≤160-char `reasoning`). Verbatim: `{"action":"sanction","target":"Wren","reasoning":"I will post a censure: Wren has kept others from the spring…"}`. `reason` vs `reasoning` is a near-homograph the model loses at low effort — and every loss is recorded as *nothing*, not as an attempted sanction. 6 of 20 G9S low decisions were second-order punishment attempts erased by a schema detail; at high effort the parse-fail rate is **0/10**. Counting them, G9S at low is ~100% civic-directed. §4.3's "a failed origination attempt is recorded as nothing" was right about the mechanism and wrong about which action it eats.

**Corrected conclusion.** "These agents never originate institutions" is false on both backbones. The measured behaviour is: *under survival pressure, minds serve needs and ignore politics; under slack, they originate readily — and the ladder's zero was produced by testing the fee-gated composite action only under pressure.* The fix list is entirely sim design, unchanged from Addendum 2 and now backbone-confirmed, plus one new item:

- drop the propose fee, or charge voting symmetrically so the asymmetry is a design choice rather than an accident;
- add 1–2 change-seeking personas (disposition only — they legitimately pay the costs);
- run decide-effort ≥ medium when needs are comfortable; civic deliberation does not surface at `low`;
- persist declared intentions as standing goals, so talk→escalate arcs survive across ticks;
- score grievance-directed `socialize` as the institutional on-ramp it is;
- **(new)** rename `sanction.reason` → `sanction.text` to match `propose.text`, or accept `reasoning` as the censure when `reason` is absent. As written, the schema deletes second-order punishment at low effort and the trace shows nothing happened.

---

## Addendum 4 (2026-08-22): the fixes landed — 3/10 → 10/10 on the median frugal persona

All six items from Addendum 3's list are implemented in `luna-island@0bf7908`. The changes are small and none of them touches behaviour — they change what is *possible* and what is *legible*, which is the engine's job:

| Fix | Change |
| --- | --- |
| Fee | `PROPOSE_COST` 2 → 0 plus a new `VOTE_COST` (0), both moved to `src/sim/costs.ts` so the notice-board menu is generated from the numbers the sim actually charges. A zero fee skips the wallet gate rather than routing 0 through `transferCoins`, which rejects `amount<=0` and would have refused every proposal as "could not pay". |
| Board framing | The empty-board line states the affordance ("anyone may post one, free") instead of a price tag. |
| Disposition | Ren (`agent-3`) and Pia (`agent-5`) join the Luna roster as change-seeking personas. |
| Effort | A decide whose needs are comfortable classifies as `decide-slack` and runs at `medium`. Raises, never lowers. Marker strings are shared via `src/mind/promptMarkers.ts` rather than copied into the sidecar. |
| Standing goals | `declaredIntentions` harvests plans from the agent's own recent action reasons, so a talk→escalate arc survives the tick. Matched on sequencing words, not every first-person "i want", and aged out rather than discharged — deciding an intention is finished is the Brain's business, not the engine's. |
| Schema | `sanction` accepts `text` (matching `propose`) and recovers a censure written into `reasoning`. The response contract now names `text` explicitly. |
| Instrumentation | Grievance-directed `socialize` scores as an institutional on-ramp instead of as nothing. |

**Measured after the change**, same fixture and the same frugal Mira persona that produced the original zero:

| Cell | Before | After |
| --- | --- | --- |
| G9S slack-grievance (codex, median persona) | propose 3/10, then 6/10; 3/10 parse-fails | **propose 10/10, 0 parse-fails** |

Effort was selected automatically — the fixture carries the slack marker, so the sidecar routed it to `medium` without anyone passing a flag. Sample reasoning: *"I want the spring shared fairly, so no villager is turned away hungry while one person holds the only spot."*

Twelve regression tests cover the fixes (`npm run check`: 304/304). Two of them pin failure modes that were invisible rather than loud: a free propose must not fall through the transfer gate, and a sanction whose censure lands in `reasoning` must still post. Two pre-existing conversation assertions turned out to be silently scoped to `agent-3` being a non-mind and to an unfiltered global say log — promoting `agent-3` broke their premise, and both now derive from the roster instead of hardcoding it.

**What this does not settle.** Every number here is single-agent, single-tick, on a synthetic fixture. Whether a live multi-day island now produces proposals that pass, rules that bind, and sanctions that land is a soak question, not a probe question — and the standing-goals change in particular is only exercised end-to-end when a mind actually gets two consecutive chances at the same plan.

---

## Addendum 5 (2026-08-22): two live soaks — the island legislates, and the bottleneck moves twice

Two 120-minute political soaks on the real backbone (`gpt-5.6-luna`, seed 42, min-gap 15, concurrency 3), against a pre-fix baseline from the same harness. All three reach the same point — day 6, tick ~7200, ~900-980 decisions — so the comparison is controlled on effort.

| counter | pre-fix | soak 1 (fixes) | soak 2 (+ binding votes) |
| --- | --- | --- | --- |
| `institution:proposed` | 1 | 5 | 3 |
| `institution:voted` | 19 | 91 | 55 |
| `institution:closed` | 1 | 4 | 3 |
| `institution:claimed` | 0 | 0 | **1** |
| `institution:vote-refused` | 1 | 33 | **1** |
| **rules bound** | **0** | **0** | **1** |

### Soak 1: origination unblocked, legislation still zero

Proposals went 1 → 5, votes 19 → 91. Every one of the four closed proposals **failed**: 2-16, 2-16, 3-15, 5-14. Zero rules bound. The bottleneck had moved, not cleared — "vote and never legislate" became "propose and never legislate".

The cause was visible in the vote split: **deliberating villagers voted 10 yes / 0 no; the scripted electorate voted 7 yes / 74 no.** Sheep vote by `sympathy[proposerId] >= 0.25`, never on the text, and sympathy toward the sole proposer sat at 0.02-0.20 across most of the village. Passage was a popularity contest about the author. This was invisible before the fixes because nobody proposed.

Two defects surfaced alongside it, both the investigation's signature shape — a number nothing measures, and a missing line that silently wastes work:

- `soak-political.mjs` printed a hardcoded `minds=6`, wrong since the roster grew to 8.
- The proposal line never told a mind **whether it had already voted**. The 18:00 electorate sweep votes on every villager's behalf, so minds burned decisions re-voting into refusals: 30 `already-voted` refusals, ~3% of every decision the island made.

**And a duplicated roster meant the two halves of the world disagreed about who someone was.** `sim.ts` kept its own hardcoded `LUNA_MIND_IDS`, never updated when the roster grew, so Ren and Pia were simultaneously mind-driven *and* classified as sheep — UtilityBrain ran them and the electorate sweep cast votes for them. Nothing failed; the layers just disagreed. Both now derive from `src/sim/lunaRoster.ts`. This confounds soak 1's per-agent numbers; soak 2 is clean.

### Soak 2: sheep vote, only deliberating villagers bind

Change: every villager still votes and every vote is recorded and displayed, but passage counts binding votes only (`bindingTally`). `PROPOSAL_QUORUM` became derived rather than literal — it was 8, a third of the ~24-villager electorate; against a binding body of 8 a literal 8 demands unanimous turnout, so the same one-third intent gives **3**. The observation and the `institution:closed` event now lead with the deciding count and keep the village tally as advisory, so the trace no longer says "failed 2-16" about a decision made on 2-0.

Result — **the island passed its first rule**:

| proposal | binding | village | outcome |
| --- | --- | --- | --- |
| "Post every rule publicly before enforcement…" | 2-0 | 3-15 | failed (turnout) |
| "Every villager should weigh public rules before they are decided." | 2-0 | 3-15 | failed (turnout) |
| **"Food access should not depend on who can pay."** | **3-0** | 6-13 | **passed, bound at tick 5772** |

Binding votes across all three: **7 yes, 0 no.** The deliberating body never once voted against a proposal; the two failures were pure turnout, exactly one vote short. The village advisory tally opposed all three, including the one that passed — under the old rule none of them could have bound.

The vote-visibility fix landed hard: `vote-refused` fell **33 → 1**, and the survivor is a `missing` refusal, not `already-voted`. That waste is gone.

**An unprompted enclosure.** 51 ticks after the food-access rule bound, Ode claimed the plaza — the first `institution:claimed` in any run, 15 coins to privatize a commons. Causality is unverified at this distance and n=1, but a rule about access-regardless-of-payment followed immediately by an enclosure of the commons is the kind of sequence the sim exists to produce.

### The bottleneck has moved again: turnout

Binding turnout was **2/8, 2/8, 3/8**. Eight minds made 645 decisions between them and the median proposal drew two voters. The deliberative body cannot reliably reach its own quorum — a third distinct blocker, downstream of both the fee and the sympathy gate, and the thing to investigate before tuning anything else. Note the quorum of 3 is a threshold *chosen here*, not measured; the honest framing is that turnout and quorum are now a single coupled question.

**Still untested:** zero sanction attempts in either soak, so the `reason`/`reasoning` schema fix remains unexercised in a live island. And origination is still one agent — all 8 proposals across both runs came from Pia, the reform-minded persona. Seven minds have never attempted a proposal in 1,900 decisions. The fee fix alone does not make the median mind originate ambiently; the probe fixture that produced 10/10 had an acute grievance in the observation, and the island mostly does not.

n=1 per configuration. Proposals fell 5 → 3 between soaks and completed talk→escalate arcs fell 2 → 0; with a single seed those are not separable from run variance.

---

## Addendum 6 (2026-08-24): the capstone — the full chain fires live, once; variance is now the story

Between Addendum 5 and this one, three engine rungs landed in luna-island (P5-1 wear paths `1c62b00`, P5-2 building tiers `76a2cb8`, P5-3 public works `6da9b78`): a proposal may carry a structured `build` payload; passage founds a COMMONS construction site with a small treasury completion-bounty; buildings level up through the same deliver-and-labour physics; foot traffic wears visible paths. Probe G13 (slack + crowded-well grievance): codex proposes **10/10, all 10 with a build payload**.

Two capstone soaks ran (default preset, seed 42, 120 min, 8 minds, same harness):

**Run A (truncated at 43 valid minutes — a stray click on the headed browser's timeline scrubbed the view into replay and paused the sim; the harness now auto-recovers, `4e13af0`).** In under 2 sim days, the entire chain fired unprompted:

- t22: Ode independently commissioned a farm — and at some point **Ode, not Pia, proposed** *"Raise a commons notice-board for village plans and work"* with `{build: notice-board}`. **First origination ever by a second agent.**
- t1462: passed **4-0 binding** (village advisory 4-16 against); treasury staked 5 coins.
- t1610: the board **completed** — bounty split among Pia (a mind) and **Kiba and Lark, two scripted sheep who hauled materials of their own accord**; remainder honestly returned to the treasury.
- A second build-proposal (Pia, storehouse) was open at truncation.

Grievance → propose+build → binding pass → treasury stake → mixed mind/sheep construction → standing commons building: every link, live, zero scripting.

**Run B (full 120 minutes, guarded).** A different island entirely:

- 4 proposals — all Pia again, **none carrying a build**, all failed **on turnout** (binding 1-0, 2-0, 1-0, 2-0 against quorum 3; village advisory against every one). Zero rules bound, zero sanctions, zero public works.
- But a **private construction boom**: Ode's farm plus five house commissions (Mira, Wren, Kes, Ansel, Nia — four completed in-run, Pia's sixth underway). Prior soaks saw at most one commission. The day-lapse strip and the day-1/day-5 stills show a visibly larger town ringed by new roofs, two active sites, and a fully established wear-path network.

**What the pair establishes:**

1. **The capability ceiling is proven live** (Run A) — the sim can now grow its town through politics, and through private initiative (Run B), with zero choreography. "These agents never originate institutions" is not just false; the full Ostrom arc from grievance to standing commons infrastructure has been observed end-to-end in an unscripted world.
2. **Run-to-run variance is now the dominant unknown.** Same seed, same fixtures: one run produced a village that legislates its infrastructure; the next produced a village that builds privately and lets every proposal die one vote short. n=1 per condition cannot say which is modal. The next real question is a variance study (same config, 5+ runs), not another mechanism.
3. **Turnout remains the binding civic constraint** (Run B: every failure at 1-2 binding votes vs quorum 3), unchanged since Addendum 5. Origination breadth (who proposes) crossed a threshold once (Ode) and regressed to Pia-only — dispositional monoculture in practice even with two organizer personas.
4. Housekeeping findings: the headed soak browser is a live control surface — one click cost 76 of 120 minutes before the auto-recover guard; and a port collision let a soak silently attach to a dying orphan vite (brainless run, caught at minute 5 by decisions=0). Both now guarded or preflighted.

Raw: journals `capstone-truncated-journal.jsonl` / `capstone-full-journal.jsonl` alongside the other materials; world exports remain in luna-island `artifacts/` (43.9 MB each, ungitted).

---

## Appendix: source index

**Human institutional origination.** Ostrom, *Governing the Commons* (1990) — Törbel 1483; Valencia huerta/Tribunal de las Aguas; design principle 3. Ostrom, Walker & Gardner, "Covenants with and without a Sword," *APSR* 1992. Heckathorn, "Collective Action and the Second-Order Free-Rider Problem," *Rationality & Society* 1989. Sunstein, "Social Norms and Social Roles," *Colum. L. Rev.* 1996. Finnemore & Sikkink, "International Norm Dynamics," *IO* 1998. Centola et al., *Science* 2018 (25% tipping). Nielsen, participation inequality (90-9-1); Wikipedia policy authorship (Forte & Bruckman, HICSS 2008). Change.org ratios (Chartio); UK e-petitions (Commons Library CBP-8620); Pew civic engagement 2013/2026. Kingdon, *Agendas, Alternatives, and Public Policies* (1984). Olson, *Logic of Collective Action* (1965). Marwell & Oliver, *The Critical Mass in Collective Action* (1993). Schelling, *The Strategy of Conflict* (1960). Ault, *Open-Field Farming in Medieval England* (1972). Lansing on Balinese subak, *Am. Anthropologist* 1987. Bryan, *Real Democracy* (2004); 17 V.S.A. §2642. McCarthy & Zald, *AJS* 1977. Benford & Snow, framing (2000). Birkland, *After Disaster* (1997). "Copy-paste legislation," Center for Public Integrity.

**LLM agent societies.** Park et al., Generative Agents, arXiv:2304.03442. Altera, Project Sid, arXiv:2411.00114. Piatti et al., GovSim, arXiv:2404.16698. Ashery, Aiello & Baronchelli, *Science Advances* 2025 / arXiv:2410.08948. Ren et al., CRSEC, arXiv:2403.08251 (IJCAI 2024). Horiguchi et al., arXiv:2409.00993. Dai et al., Artificial Leviathan, arXiv:2406.14373. Emergence World, arXiv:2606.08367. Cultural evolution of cooperation, arXiv:2412.10270. "Social Catalysts, Not Moral Agents," arXiv:2602.02598. Moltbook case study, arXiv:2602.14299. Agent individuality, arXiv:2411.03252. "LLM Agents Beyond Utility," arXiv:2510.14548. Concordia, arXiv:2312.03664. AgentSociety, arXiv:2502.08691. Voyager, arXiv:2305.16291.

**Initiative, bias, harness.** Sharma et al., sycophancy, arXiv:2310.13548 (ICLR 2024); Perez et al., arXiv:2212.09251; ELEPHANT, arXiv:2505.13995; SycEval, arXiv:2508.13743. Cheung, Maier & Lieder, *PNAS* 2025 (omission bias 97/53; chat-tuning causal, Exp 4); follow-up arXiv:2607.05552. Horton, *Homo Silicus*, NBER w31122. Krishnamurthy et al., bandit exploration, arXiv:2403.15371. Lu et al., Proactive Agent, arXiv:2410.12361; Proactive-CoT, arXiv:2305.13626; ProactiveEval, arXiv:2508.20973. Pezeshkpour & Hruschka, option order, arXiv:2308.11483; "My Answer is C," arXiv:2402.14499; Holtzman et al., surface-form competition, arXiv:2104.08315; BiasBusters, arXiv:2510.00307. Decoding consistency, arXiv:2505.11183; temperature inverted-U, arXiv:2602.21198; Verbalized Sampling, arXiv:2510.01171; Artificial Hivemind, arXiv:2608.02618; persona collapse, arXiv:2604.24698. Salewski et al., In-Context Impersonation, arXiv:2305.14930; Argyle et al., *Political Analysis* 2023. Kirk et al., RLHF diversity, arXiv:2310.06452; "Normative, Not Descriptive," arXiv:2603.17218; Santurkar et al., "Whose Opinions?", arXiv:2303.17548. OpenAI Model Spec (2025-12-18).
