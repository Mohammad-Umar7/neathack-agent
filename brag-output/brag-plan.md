# Brag Plan: STOP/PROVE

## What is this app?
An AI agent that commissions PLC control logic for a factory cell: it finds hidden faults on a 3D digital twin, patches the ladder logic, and *proves* the safety rules with a model checker before the logic ever reaches a real machine.

## The angle
"Passing the tests isn't enough." The video opens on the failure everyone in automation fears (a belt pushing a box off the end because of a timing bug that passed review) and then shows an agent that doesn't just test: it proves. It is a hackathon demo, not a 20-second teaser: the neatHack rules ask for 3 minutes or less that explicitly cover neatlogs, Entire and cfo.ai (architecture, implementation, runtime, reasoning and result for each). That is the reason for the long duration. Every scene shows the real product or the real tool screens; nothing is mocked up.

## Hook (first 2-3 seconds)
Before/After twin cells, mid-motion: on the left (BASELINE) a cardboard box rides past the robot and tips off the end of the belt with a red alarm ring; on the right (REPAIRED) the identical box stops dead at the pick position. On-screen line: **"The logic passed review. The box didn't."**

## Key moments (the middle)
- The agent's real timeline replaying step by step: tests 2/8, the shortest counterexample, a patch, a **failed action and its recovery**, then "Prove S1–S6: all proven".
- The ladder-logic diff glowing on the four changed rungs, with live power flow.
- The scoreboard counting up on the evaluation the agent never saw: held-out tests 2/16 → final, fuzz violations 111 → final, hidden faults fixed.
- The three sponsor tools, each on its real screen: the neatlogs trace tree and the v1 vs v2 comparison; Entire's session and checkpoint link on the commit history; the cfo.ai model with pricing, cost per run, revenue and runway.

## Outro / punchline
Play mode: a hand hits the E-stop and opens the guard; the belt stops, the monitors stay green. End card: **STOP/PROVE: commissioning you can prove.** Live URL, repo, team LastCommit, #neatHack.

## User flow worth showing
1. **Agent run:** press "Play run". The agent's steps stream in (read spec → run tests → counterexample → patch → recover → prove → submit) while the 3D cell re-simulates each program version.
2. **Before / After:** pick a scenario card; both cells play in sync; violations flash on the baseline only.
3. **Play:** press START, slam the E-stop, open the guard door, stick a sensor; the monitors and ladder power flow react live.

## Tone
- Preset: polished
- Creative direction: quiet, confident engineering film; dark control-room palette; the product and the evidence carry it
- Interpretation: fewer, longer holds on real UI; calm narration; soft crossfades and slides; no hype words, numbers do the talking.

## Format: landscape — 1920x1080
## Duration: ~165 seconds (neatHack limit: 180 s)

## Visual identity (from the project)
- Background: #07090c (panels #0b0e13, hairlines rgba(255,255,255,0.075))
- Accent: #f5c518 (safety yellow; the "/" in the wordmark)
- Text: #e7e9ee (secondary #a3abb9)
- Signals: green #22c55e, amber #f59e0b, red #ef4444, agent cyan #22d3ee
- Display font: Space Grotesk
- Body font: Inter; code and ladder: JetBrains Mono
- Strongest visual element: the high-poly 3D conveyor cell (twin layout) and the ladder-logic diff with live power flow

## Share copy (draft)
STOP/PROVE: an agent that commissions PLC logic on a 3D digital twin, then proves the safety rules before anything touches a real machine. #neatHack

## Audio direction
- Role: voice-over only (user request: no background music, no music bed; voice-over and subtitles)
- Music: none (disabled with --no-music)
- Music treatment: none
- Music cue guidance: not applicable (no music)
- Audio-reactive treatment: none
- SFX posture: none (the user asked for "just the voice over and subtitles and the video")
- Audio-coupled moments: none; pacing follows the narration
- Restraint rule: no music, no SFX, nothing competing with the voice

## Voiceover script
Kokoro, voice am_michael. One file per scene so scene durations flex to the audio. Numbers in braces are filled from the real runs (`docs/traces/*.json`) before generating audio.

1. "This conveyor just pushed a box off the end of the line. The control program had passed review. Nobody had tested the timing."
2. "Every machine's control logic gets commissioned on site, next to real motors and real people. The bugs that slip through are the dangerous ones: an E-stop that clears itself, a belt that restarts when the guard closes, a sensor that sticks and nobody notices."
3. "STOP PROVE is an agent that does that job before the logic reaches the machine. It gets a program with hidden faults it is never told about. It tests, experiments, patches, and then proves the safety rules with a model checker."
4. "Here is a real run. The agent reads the operating rules and runs the tests. Two of eight pass. It pulls the shortest counterexample for each broken safety rule, works out which rung is wrong, and checks its idea on the digital twin. Then it patches. When an action fails, it reads the error and recovers. It only submits once every visible test passes and all six safety rules are proven."
5. "Then we grade it on things it never saw: sixteen held-out tests, three hundred random fuzz runs, and the proofs. The program as delivered passed two of sixteen. The agent's repair passes {heldout}, with {fuzz} fuzz violations, and fixes {faults} of the four hidden faults."
6. "Every run is traced in neatlogs. We initialise neatlogs before the OpenAI client, so every model call is captured, then wrap the run in a workflow span and every tool call in a tool span, with tokens, latency and cost. The traces showed why our first agent struggled: it only saw pass or fail, so it guessed. Version two reads counterexamples and proves its work. Same task: held-out tests went from {v1_heldout} to {v2_heldout}, for {v2_cost} a run."
7. "We built all of this with Claude Code under Entire. Entire ties the coding agent's session to the git history: the prompts, the reasoning and the changes behind the commits, so anyone can trace this code back to the conversation that wrote it."
8. "We planned the business in cfo.ai. Integrators pay five hundred to two thousand dollars a month. The traces gave us the real cost of a verification run, which sets the gross margin. The model reaches three point four million in annual revenue by year three, with twenty-four months of runway from a five hundred thousand dollar pre-seed."
9. "Try to break it yourself. Hit the E-stop, open the guard, jam a sensor, or rewrite a rung. STOP PROVE. Commissioning you can prove."

Subtitles: burned in, bottom-centre, Inter 600 on a dark translucent bar, max two lines, chunked by phrase and timed to the narration.

## Storyboard

### Scene 1 — Hook: the box that fell — ~9s
Screen recording of Before/After, scenario "Box at the pick position", twin layout: baseline box tips off the end with the red ring and "Box dropped" toast; repaired box stops at PE_END. Title line "The logic passed review. The box didn't." fades in top-left over the dark vignette.
Sequential/interaction: none (recording)
Audio intent: calm voice over a tense image
Audio-coupled idea: none
Transition mood: soft → Scene 2

### Scene 2 — The problem — ~13s
Slow 3D close-ups from Play mode: the operator panel and E-stop, the guard door swinging, the PE_IN beam turning magenta with a "STUCK" tag. Three short labels arrive one at a time and hold (≥1 s each): "E-stop that clears itself", "Restart when the guard closes", "Stuck sensor nobody watches".
Sequential/interaction: yes, three labels one by one, each held
Audio intent: matter-of-fact
Audio-coupled idea: none
Transition mood: soft → Scene 3

### Scene 3 — Meet STOP/PROVE — ~14s
Wordmark STOP/PROVE (yellow slash) on #07090c, tagline "An agent that commissions PLC logic, and proves it's safe." Then the loop as five chips in a row: Test → Experiment → Patch → Prove → Submit, plus a muted note "hidden faults · never told what they are".
Sequential/interaction: yes, five chips appear one by one, then hold together
Audio intent: confident
Transition mood: slide → Scene 4

### Scene 4 — The agent at work — ~32s
Screen recording of Agent run with "Play run": the timeline streams real steps; the camera focuses on the relevant spot; the ladder panel shows the diff; an error step (red) followed by a recover step (cyan) is visible; the final summary card lands. Light zoom-ins on (a) the counterexample/test detail, (b) the failed action and recovery, (c) "Prove S1–S6: all proven".
Sequential/interaction: yes, steps stream in (real UI)
Audio intent: steady explanation
Transition mood: soft → Scene 5

### Scene 5 — Graded on what it never saw — ~17s
Before/After recording with the scoreboard: held-out tests, rules proven, fuzz violations, hidden faults fixed counting up; scenario cards show A: violations / B: no violations.
Sequential/interaction: yes, four numbers count up one after another (hold the full row ≥3 s)
Audio intent: quiet payoff
Transition mood: slide → Scene 6

### Scene 6 — neatlogs — ~30s
Real neatlogs screens (Claude in Chrome screenshots): the trace for the v2 run (workflow span → LLM spans → tool spans with tokens, latency, cost), then the v1 vs v2 run comparison. A small architecture strip: `neatlogs.init()` → `@span(kind="WORKFLOW")` → `@span(kind="TOOL")` → auto-instrumented LLM calls. Then the before/after table from docs/traces.
Sequential/interaction: yes, architecture strip chips one by one; table rows reveal and hold
Audio intent: explanatory
Transition mood: slide → Scene 7

### Scene 7 — Entire — ~18s
Real screens: the GitHub commit list for the hackathon window, a commit with its `Entire-Checkpoint:` trailer, and Entire's session/checkpoint view showing the Claude Code session behind the work.
Sequential/interaction: none
Audio intent: explanatory
Transition mood: slide → Scene 8

### Scene 8 — cfo.ai — ~20s
Real cfo.ai screens of the STOP/PROVE model: pricing tiers, cost per verification run feeding gross margin, ARR curve, runway. Key numbers called out as labels: "$500–$2,000 / month", "$3.4M ARR · year 3", "24 months runway".
Sequential/interaction: yes, three callouts one by one, each held
Audio intent: explanatory, slightly warmer
Transition mood: soft → Scene 9

### Scene 9 — Try to break it — ~12s
Play-mode recording: START, then E-stop pressed (belt stops, red lamp), guard opened. End card: wordmark, "Commissioning you can prove.", live URL, github.com/Mohammad-Umar7/neathack-agent, "Team LastCommit · #neatHack".
Sequential/interaction: yes (real interaction in the recording)
Audio intent: confident close
Transition mood: end

**Music mood for this video:** none (disabled by the user)
**Audio summary:** a single calm voice-over from start to finish, with burned-in subtitles and no music or SFX.
