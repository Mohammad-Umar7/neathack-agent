# STOP/PROVE: business plan

> An AI agent that commissions PLC control logic before it touches a real machine. It tests the program against a digital twin, finds safety and functional bugs, proposes restricted patches, **proves** the safety rules with a model checker, and hands the controls engineer a verified patch plus an auditable report.

Team **LastCommit** (Mohammad Umar, Bilal Feroz Khan, Fuad Ahamed) · India · pre-seed · built at neatHack 2026 · plan dated 12 Oct 2026. Month 1 of the model is November 2026. All amounts are USD; INR at a planning rate of ₹95/USD.

Every model number below comes from [`build_model.py`](build_model.py). The script writes [`model.csv`](model.csv) (36 monthly rows) and regenerates the tables in this file. The inputs for cfo.ai are in [`cfo-ai-inputs.md`](cfo-ai-inputs.md). Market, price and salary figures link to their sources. Figures we estimated are marked *assumption*.

## Headline numbers

<!-- model:headline:start -->
- **Pricing:** Starter $500/month, Team $2,000/month, Enterprise $7,500/month (modeled average; VPC or on-prem, quoted per site).
- **ARR:** $216k at month 12 (Oct 2027), $1.37M at month 24, $3.38M at month 36, with 18 / 66 / 148 paying customers.
- **Gross margin:** 62% in year 1, 67% in year 2, 71% in year 3. LLM cost is $1.50 per verification run at Claude Sonnet 5.5 list prices in year 1.
- **Funding:** $500k pre-seed now (month 1), then a $2.00M seed in month 16 (Feb 2028) once the seed milestones are met.
- **Runway:** pre-seed burn peaks at $21k/month, so $500k is 24 months of runway at peak burn. Cash never drops below $340k before the seed. After the seed, burn peaks at $80k/month (month 22), cash bottoms at $1.59M (month 33), and the company is cash-flow positive from month 34 (Aug 2029), ending month 36 with $1.64M.
- **If the seed slips:** with the team frozen at 7 people and founder-led sales, the company is cash-flow positive from month 15 (Jan 2028) and cash never drops below $340k.
<!-- model:headline:end -->

## 1. Problem

Controls engineers at system integrators and machine builders write ladder logic, then find its bugs during factory and site acceptance tests (FAT/SAT) or after start-up. Commissioning takes about **25% of machine development time**, and **15-18%** goes to debugging automation and control logic alone, according to German machine-tool-builder research [cited by Siemens](https://blogs.sw.siemens.com/simcenter/virtual-commissioning-training-for-automation-engineers/). The bugs that matter are the ones our demo seeds: an E-stop that resets without a deliberate restart, auto-restart after a guard door closes, timing races, and stuck sensors nobody supervises.

Finding bugs on site is expensive. Unplanned downtime costs the Fortune Global 500 about **$1.4 trillion a year (11% of revenue)**. An hour of downtime costs **$2.3M in automotive** and **$36k in FMCG** ([Siemens, *True Cost of Downtime 2024*](https://assets.new.siemens.com/siemens/assets/api/uuid:1b43afb5-2d07-47f7-9eb7-893fe7d0bc59/TCOD-2024_original.pdf)). Virtual commissioning tools help, but engineers still build the scenarios and judge the results by hand. Testing also shows only that the scenarios someone thought of pass. It does not show that a safety rule holds in every reachable state.

## 2. Customer

| Segment | Who signs | Why they buy | Entry tier |
|---|---|---|---|
| **System integrators** (10-200 controls engineers) | Engineering manager / owner | Fixed-price projects: every on-site day of logic debugging eats margin; FAT sign-off | Starter → Team |
| **Machine builders / OEMs** (packaging, conveyors, palletising, intralogistics) | Head of controls / R&D | Each machine variant needs re-commissioning; safety documentation for CE marking; warranty call-outs | Team → Enterprise |
| **Plant controls teams** (automotive, FMCG, logistics) | Plant engineering / reliability lead | Logic changes on running lines under management-of-change; downtime cost | Enterprise |

**Market.** PLC hardware is about an [$11.7B market](https://www.gminsights.com/industry-analysis/programmable-logic-controller-market). Virtual-commissioning software, our closest category, was about **$1.4B in 2025**, growing **13-15% a year** ([Precedence Research](https://www.precedenceresearch.com/virtual-commissioning-market), [Fact.MR](https://www.factmr.com/report/virtual-commissioning-market)). On buyer counts, estimates put established control system integrators in North America at over 1,200, and firms doing some integration worldwide at more than 4,000 ([Control Engineering](https://www.controleng.com/raising-the-bar-for-control-system-integrators/), [Control Engineering demographics](https://www.controleng.com/system-integrator-demographics/); these estimates are dated). Germany's machinery association VDMA alone has about [3,600 member companies](https://en.wikipedia.org/wiki/Machinery_and_Equipment_Manufacturers_Association). *Assumption:* 10,000 reachable integrators, OEMs and plant teams in the US, DACH and India, at the model's month-36 blended contract value of about $22.8k a year, make a **~$230M ARR serviceable market**. The plan's month-36 ARR is about 1.5% of it.

## 3. Why now

1. **Agents can do the work.** Current LLMs read and edit control logic, call simulators and checkers as tools, and finish a 30-step run for about $1.50 with prompt caching (section 8). Research confirms the loop works. In [LLM4PLC](https://arxiv.org/abs/2401.05443) (ICSE 2024), adding verifier feedback to LLM-generated PLC code raised the success rate from 47% to 72%.
2. **Proofs are practical at machine scale.** A cell's control logic is a finite-state system. With timer abstraction and per-station decomposition, its state space is small enough to explore exhaustively, so "it passed the tests" becomes "the rule holds in every reachable state, or here is the counterexample".
3. **Regulation.** The EU Machinery Regulation 2023/1230 applies from **20 January 2027** ([Pilz](https://www.pilz.com/en-PL/support/law-standards-norms/manufacturer-machine-operators/machinery-regulation)). Its definition of safety components now includes **software** ([Drives & Controls](https://www.drivesandcontrols.ca/changing-scenes/eu-machinery-regulation-2023-1230/)). Builders need evidence, not just test logs.
4. **More generated code.** Siemens ([Industrial Copilot for TIA Portal](https://www.automation.com/en-us/articles/april-2024/siemens-xcelerator-ai-industrial-copilot)) and Rockwell ([FactoryTalk Design Studio Copilot](https://www.oemmagazine.org/engineering/automation/article/22927841/rockwell-automations-factorytalk-design-studio-adds-generative-ai-copilot)) now generate PLC code from prompts. Code nobody wrote by hand needs independent verification.

## 4. Product and moat

**Input:** a digital twin of the machine, the control program (ladder rungs; IEC 61131-3 via PLCopen XML on the roadmap) and the safety rules. **The agent:** simulates scenarios and injects faults (stuck sensors, dropped signals, timing jitter), localises each failure, and proposes a *restricted* patch, editing only the rungs and operations the engineer allows. It then model-checks every safety rule (proof or counterexample) and re-runs held-out tests the agent never saw. **Output:** a verified patch and a report with counterexamples, proofs, test results and a full [neatlogs](https://neatlogs.com) trace of every agent step. The engineer approves; nothing is deployed automatically. **Demo:** on a conveyor cell with 4 hidden seeded faults, the agent finds and fixes all 4 and proves 6 safety rules.

**Moat.**
- **Proof certificates and audit trail.** Once our reports are part of a customer's safety file and FAT protocol, switching means re-validating the process.
- **Twin and fault library.** Twins for conveyors, palletisers, packaging and robot cells, plus fault models, compound with every project.
- **Verified-fix data.** Every run produces (bug, patch, proof) triples, the training and evaluation data for a better agent.
- **Vendor-neutral integrations.** PLCopen XML, TIA Portal Openness, Studio 5000 L5X and TwinCAT. A vendor's copilot will not verify a rival's controller.
- **Independent assessment.** An independent functional-safety assessment of the tool (month 30) is slow and expensive for a newcomer to copy.

## 5. Competition

| Alternative | What it is | Public price | Gap STOP/PROVE fills |
|---|---|---|---|
| Siemens S7-PLCSIM Advanced, Process Simulate | Virtual PLC + 3D simulation (Siemens stack) | PLCSIM Advanced V5 ≈ [£3,282 per licence at RS](https://uk.rs-online.com/web/p/software/2674826); Process Simulate by quote | Engineers write the scenarios and judge the results; no fault finding, no proofs; Siemens only |
| Rockwell Emulate3D (+ Logix Emulate) | 3D emulation for Logix controllers | Quote | Same; Rockwell only |
| Beckhoff TwinCAT 3 simulation | Simulation inside TwinCAT | Engineering free; runtime licensed | Platform-specific simulation, no verification agent |
| Factory I/O | 3D training simulator | [Ultimate €278/yr or €765 one-off](https://factoryio.com/editions) | Training scenes; not a verification tool |
| realvirtual.io, Simumatik | Unity / cloud digital twins for virtual commissioning | [realvirtual Commercial €1,920/yr per developer](https://realvirtual.io/en/buy/); Simumatik subscription ([acquired by Virtualware, Oct 2024](https://www.preqin.com/data/profile/asset/simumatik-ab/728466)) | Better simulation, but the engineer still has to find the bugs |
| Code copilots (Siemens, Rockwell, ChatGPT, GitHub Copilot) | Generate and explain PLC code | Bundled / quote | Generate code but never prove it against a machine model |
| Model checkers (nuXmv, PLCverif) | Formal verification | Free / open source | Expert-only: no twin, no patch loop, no report a controls engineer can use |

We complement the simulators: a PLCSIM Advanced or Emulate3D model can serve as the twin, and we verify code written by people or by copilots.

## 6. Go-to-market

1. **Design partners (M1-M3).** Three unpaid pilots with Indian integrators and OEMs (packaging, conveyors), from the founders' network. Two convert in month 4.
2. **Founder-led sales (M4-M15).**
   - **Channels:** small US/EU integrators reached through bug-hunt videos backed by real neatlogs traces, r/PLC and PLCtalk, CSIA membership and webinars.
   - **Events:** Hannover Messe (Apr 2027) and SPS Nuremberg (Nov 2027).
   - **Self-serve:** Starter comes with a 14-day trial on sample twins.
3. **Sales team (M16+).**
   - **People:** a head of sales for North America, account executives in the US and DACH, and SDRs working US hours from India.
   - **Proof of value:** solutions engineers run 4-week proofs of value on one customer machine.
   - **Partners:** PLC-vendor marketplaces and partner programs, plus functional-safety consultancies as a referral channel.
4. **Land and expand.** Starter → Team (seats, projects) → Enterprise (site-wide, VPC/on-prem, safety evidence pack). Upgrades are in the model (1.5% of Starter and 0.5% of Team customers move up each month). Run overages are not.

## 7. Pricing

<!-- model:pricing:start -->
|  | Starter | Team | Enterprise |
| --- | ---: | ---: | ---: |
| Price (USD / month) | $500 | $2,000 | $7,500 |
| Price (USD / year) | $6,000 | $24,000 | $90,000 |
| Engineer seats | 2 | 8 | Unlimited |
| Active controller projects | 3 | 12 | Unlimited |
| Verification runs included / month | 100 | 500 | 2,500 |
| Expected runs used / month (model) | 60 | 300 | 1,200 |
| Overage per extra run | $2.50 | $2.50 | $2.50 |
| Monthly logo churn (model) | 2.0% | 1.0% | 0.5% |
| Monthly upgrade to next tier (model) | 1.5% | 0.5% | n/a |
<!-- model:pricing:end -->

All tiers include the verification report and neatlogs trace. Team adds the custom twin builder, proof certificates, Git/CI integration and SSO. Enterprise adds VPC or on-prem deployment (optionally on the customer's own Bedrock, Vertex or Azure LLM endpoint), the safety evidence pack and a named solutions engineer. The model bills everyone monthly at list price. Annual prepayment, discounts and overage revenue are left out.

**Why customers pay this.** A US controls engineer earns about [$92k](https://www.ziprecruiter.com/Salaries/Plc-Controls-Engineer-Salary), or [$125k median total pay](https://www.coursera.org/articles/controls-engineer-salary). Loaded at 1.3× over 1,800 hours, that is roughly **$80/hour** (*assumption*). In Germany an SPS programmer earns about €57-59k ([jobvector](https://www.jobvector.de/gehalt/sps-programmierer/), [Indeed](https://de.indeed.com/career/sps-programmierer/salaries)). In India, AmbitionBox puts a [PLC automation engineer at ₹4-15 lakh a year at 7 years' experience](https://www.ambitionbox.com/profile/plc-automation-engineer-salary).

*Assumption*, worked example for a mid-size cell with 300 controls hours:
- **Debug hours:** logic debugging is 15-18% of the project, about 50 hours.
- **Hours saved:** removing 40% of it saves 20 hours (vendor case studies report 20-70% shorter commissioning, e.g. [70% at Wipro PARI](https://blogs.sw.siemens.com/tecnomatix/wipro-pari-reduces-commissioning-time-by-70/)). That is $1,600.
- **Travel saved:** two fewer site days at $600 a day saves $1,200.
- **Total:** about **$2,800 per project**.

At that rate:
- **Team:** a customer running 2-3 projects a month saves $5.6k-8.4k a month, 2.8-4.2× its $2,000 price.
- **Starter:** one project a month is 5.6× its $500 price.
- **Enterprise:** one avoided hour of FMCG downtime ($36k) pays for almost five months of Enterprise.

## 8. Unit economics and costs

**LLM cost per verification run.** A run is about 30 agent steps, with prompts averaging 50k tokens (program, twin, rules and tool definitions, mostly served from the prompt cache) and 2k output tokens per step. We price it at [Claude Sonnet 5.5 list prices](https://platform.claude.com/docs/en/about-claude/pricing): $2 / MTok input, $2.50 cache write, $0.10 cache hit, $10 output.

<!-- model:run-cost:start -->
| Component | Tokens per run | Sonnet 5.5 price (USD / MTok) | Cost per run |
| --- | ---: | ---: | ---: |
| Prompt tokens read from cache | 1,275,000 | $0.10 | $0.128 |
| Prompt tokens written to cache (5 min) | 150,000 | $2.50 | $0.375 |
| Uncached prompt tokens | 75,000 | $2.00 | $0.150 |
| Output tokens (incl. thinking) | 60,000 | $10.00 | $0.600 |
| **Subtotal** | 1,560,000 |  | **$1.252** |
| Retries and failed steps (+20%) |  |  | $0.250 |
| **LLM cost per run, year 1** |  |  | **$1.50** |
| Year 2 / year 3 (cost index 0.80 / 0.68) |  |  | $1.20 / $1.02 |
| Compute: simulation, model checking, storage |  |  | $0.05 |
<!-- model:run-cost:end -->

The year-2 and year-3 index is an engineering target, not a vendor price cut. It comes from two changes:
- Move trace triage and test generation to Claude Haiku 5.5 ($0.10 / $0.50 per MTok).
- Run nightly regression suites through the Batch API at 50% off.

These token counts are estimates. They will be replaced by measured tokens and cost per run from the hackathon's neatlogs traces (`docs/traces/`).

<!-- model:unit-economics:start -->
| Tier | Price / month | LLM (year 1) | Compute | Hosting + payment fees | Direct COGS / month | Contribution margin, year 1 | Contribution margin, year 3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter | $500 | $90 | $3 | $22 | $115 | 77% | 83% |
| Team | $2,000 | $451 | $15 | $52 | $518 | 74% | 81% |
| Enterprise | $7,500 | $1,804 | $60 | $162 | $2,026 | 73% | 81% |
<!-- model:unit-economics:end -->

Company gross margin is lower than per-tier contribution margin. COGS also includes base hosting and the solutions/customer-success engineers who onboard twins (headcount table, bucket COGS). Allowances cap the downside: a Team customer using all 500 runs still costs only about 38% of its price in LLM tokens.

## 9. Revenue projection

The drivers, all in `build_model.py`, are:
- **New customers:** a gross schedule per tier (months 1-3 are pilots).
- **Churn:** monthly logo churn of 2.0% / 1.0% / 0.5% (Starter / Team / Enterprise).
- **Upgrades:** the monthly upgrade rates in the pricing table.

Revenue equals MRR (billed monthly).

**Year 1, monthly** (S/T/E = Starter/Team/Enterprise customers):

<!-- model:revenue-y1:start -->
| Month | New | Customers (S/T/E) | ARPA | MRR = revenue | COGS | Gross margin | OpEx | Net burn | Cash |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M1 (Nov 2026) | 0 | 0 (0/0/0) | $0 | $0 | $300 | n/a | $15,600 | $15,900 | $484,100 |
| M2 (Dec 2026) | 0 | 0 (0/0/0) | $0 | $0 | $300 | n/a | $20,600 | $20,900 | $463,200 |
| M3 (Jan 2027) | 0 | 0 (0/0/0) | $0 | $0 | $300 | n/a | $13,600 | $13,900 | $449,300 |
| M4 (Feb 2027) | 2 | 2 (1/1/0) | $1,250 | $2,500 | $933 | 62.7% | $15,400 | $13,833 | $435,467 |
| M5 (Mar 2027) | 1 | 3 (2/1/0) | $1,000 | $3,000 | $1,048 | 65.1% | $15,400 | $13,448 | $422,019 |
| M6 (Apr 2027) | 1 | 4 (3/1/0) | $875 | $3,500 | $1,163 | 66.8% | $15,400 | $13,063 | $408,956 |
| M7 (May 2027) | 2 | 6 (4/2/0) | $1,000 | $6,000 | $1,797 | 70.0% | $17,600 | $13,397 | $395,559 |
| M8 (Jun 2027) | 1 | 7 (5/2/0) | $929 | $6,500 | $1,912 | 70.6% | $17,600 | $13,012 | $382,547 |
| M9 (Jul 2027) | 3 | 10 (7/3/0) | $950 | $9,500 | $4,260 | 55.2% | $17,600 | $12,360 | $370,187 |
| M10 (Aug 2027) | 2 | 12 (8/4/0) | $1,000 | $12,000 | $4,893 | 59.2% | $17,600 | $10,493 | $359,694 |
| M11 (Sep 2027) | 3 | 15 (10/5/0) | $1,000 | $15,000 | $5,641 | 62.4% | $17,600 | $8,241 | $351,453 |
| M12 (Oct 2027) | 3 | 18 (12/6/0) | $1,000 | $18,000 | $6,390 | 64.5% | $17,600 | $5,990 | $345,463 |
<!-- model:revenue-y1:end -->

**Years 2-3, quarterly:**

<!-- model:revenue-quarterly:start -->
| Quarter | New | Customers at end (S/T/E) | ARPA | MRR at end | ARR at end | Revenue | Gross margin | Net burn | Cash at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Q5 (M13-M15) | 10 | 27 (16/10/1) | $1,315 | $35,500 | $426k | $80k | 71% | -$2k | $348k |
| Q6 (M16-M18) | 12 | 38 (21/16/1) | $1,316 | $50,000 | $600k | $136k | 74% | $158k | $2.19M |
| Q7 (M19-M21) | 13 | 49 (25/22/2) | $1,459 | $71,500 | $858k | $202k | 61% | $152k | $2.04M |
| Q8 (M22-M24) | 20 | 66 (30/31/5) | $1,735 | $114,500 | $1.37M | $297k | 65% | $161k | $1.88M |
| Q9 (M25-M27) | 19 | 82 (36/40/6) | $1,744 | $143,000 | $1.72M | $402k | 71% | $128k | $1.75M |
| Q10 (M28-M30) | 23 | 102 (44/49/9) | $1,838 | $187,500 | $2.25M | $514k | 69% | $134k | $1.61M |
| Q11 (M31-M33) | 26 | 123 (51/61/11) | $1,870 | $230,000 | $2.76M | $640k | 70% | $27k | $1.59M |
| Q12 (M34-M36) | 29 | 148 (61/73/14) | $1,902 | $281,500 | $3.38M | $791k | 72% | -$57k | $1.64M |
<!-- model:revenue-quarterly:end -->

**Annual P&L summary:**

<!-- model:annual:start -->
| Year | Revenue | COGS | Gross margin | Payroll (OpEx) | Other OpEx | Net burn | Funding | Cash at end | Customers at end | ARR at end | Headcount at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Year 1 (M1-M12) | $76k | $29k | 62% | $131k | $70k | $155k | $500k | $345k | 18 | $216k | 7 |
| Year 2 (M13-M24) | $714k | $239k | 67% | $531k | $413k | $470k | $2.00M | $1.88M | 66 | $1.37M | 19 |
| Year 3 (M25-M36) | $2.35M | $687k | 71% | $1.10M | $792k | $232k | $0k | $1.64M | 148 | $3.38M | 30 |
<!-- model:annual:end -->

**Efficiency.** Blended CAC counts S&M payroll, half the CEO, commissions, marketing and events. NRR is the trailing-12-month product of (1 − churned MRR + upgrade MRR) on the opening base.

<!-- model:saas-metrics:start -->
| Year | Net new ARR | Burn multiple | Net revenue retention | Blended CAC | New-customer ARPA | CAC payback |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Year 1 | $216k | 0.7x | n/a (no 12-month base yet) | $2,000 | $1,000 | 3.2 months |
| Year 2 | $1.16M | 0.4x | 107% | $9,386 | $1,664 | 8.5 months |
| Year 3 | $2.00M | 0.1x | 103% | $12,112 | $1,655 | 10.3 months |
<!-- model:saas-metrics:end -->

## 10. Operating costs and headcount

Engineering stays in India; sales and on-site solutions engineering are in the US and Germany. Costs are fully loaded (CTC for India roles).

<!-- model:headcount:start -->
| # | Role | Location | Starts | Loaded cost / month (USD) | INR lakh / year | Dept / bucket | Kept if seed slips |
| ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | Co-founder & CEO (Mohammad Umar) | India | M1 (Nov 2026) | $2,000 -> $3,500 from M16 | 22.8 -> 39.9 | G&A / OpEx | yes |
| 2 | Co-founder, engineering (Bilal Feroz Khan) | India | M1 (Nov 2026) | $2,000 -> $3,500 from M16 | 22.8 -> 39.9 | R&D / OpEx | yes |
| 3 | Co-founder, engineering (Fuad Ahamed) | India | M1 (Nov 2026) | $2,000 -> $3,500 from M16 | 22.8 -> 39.9 | R&D / OpEx | yes |
| 4 | Founding engineer, formal methods / model checking | India | M3 (Jan 2027) | $3,000 | 34.2 | R&D / OpEx | yes |
| 5 | Founding controls engineer, PLC + digital-twin library | India | M4 (Feb 2027) | $1,800 | 20.5 | R&D / OpEx | yes |
| 6 | Full-stack / platform engineer | India | M7 (May 2027) | $2,200 | 25.1 | R&D / OpEx | yes |
| 7 | Solutions / customer-success engineer #1 | India | M9 (Jul 2027) | $1,600 | 18.2 | CS / COGS | yes |
| 8 | Head of sales, North America | US | M16 (Feb 2028) | $15,000 | - | S&M / OpEx | no |
| 9 | Senior ML / agent engineer | India | M16 (Feb 2028) | $3,500 | 39.9 | R&D / OpEx | no |
| 10 | Controls engineer #2 (twin library) | India | M17 (Mar 2028) | $1,800 | 20.5 | R&D / OpEx | no |
| 11 | Sales development rep #1 (US hours) | India | M17 (Mar 2028) | $1,200 | 13.7 | S&M / OpEx | no |
| 12 | Account executive, DACH | Germany | M18 (Apr 2028) | $9,500 | - | S&M / OpEx | no |
| 13 | DevOps / security engineer (VPC and on-prem) | India | M18 (Apr 2028) | $2,600 | 29.6 | R&D / OpEx | no |
| 14 | Solutions engineer #2 | US | M19 (May 2028) | $10,000 | - | CS / COGS | no |
| 15 | Product marketing manager | India | M20 (Jun 2028) | $2,200 | 25.1 | S&M / OpEx | no |
| 16 | Backend / platform engineer #2 | India | M21 (Jul 2028) | $2,200 | 25.1 | R&D / OpEx | no |
| 17 | Account executive #2, US | US | M22 (Aug 2028) | $10,000 | - | S&M / OpEx | no |
| 18 | Customer-success engineer #3 | India | M23 (Sep 2028) | $1,600 | 18.2 | CS / COGS | yes |
| 19 | Formal methods engineer #2 | India | M24 (Oct 2028) | $3,000 | 34.2 | R&D / OpEx | no |
| 20 | Sales development rep #2 | India | M25 (Nov 2028) | $1,200 | 13.7 | S&M / OpEx | no |
| 21 | Controls engineer #3 (twin library) | India | M26 (Dec 2028) | $1,800 | 20.5 | R&D / OpEx | no |
| 22 | Account executive #3, US | US | M27 (Jan 2029) | $10,000 | - | S&M / OpEx | no |
| 23 | Finance & operations manager | India | M28 (Feb 2029) | $2,000 | 22.8 | G&A / OpEx | no |
| 24 | Solutions engineer #4 | Germany | M29 (Mar 2029) | $9,000 | - | CS / COGS | no |
| 25 | ML / agent engineer #2 | India | M30 (Apr 2029) | $3,000 | 34.2 | R&D / OpEx | no |
| 26 | Frontend engineer | India | M31 (May 2029) | $2,000 | 22.8 | R&D / OpEx | no |
| 27 | Partner / channel manager | India | M32 (Jun 2029) | $2,500 | 28.5 | S&M / OpEx | no |
| 28 | QA / verification engineer | India | M33 (Jul 2029) | $1,800 | 20.5 | R&D / OpEx | no |
| 29 | Account executive #2, DACH | Germany | M34 (Aug 2029) | $9,500 | - | S&M / OpEx | no |
| 30 | Customer-success engineer #5 | India | M35 (Sep 2029) | $1,600 | 18.2 | CS / COGS | no |
<!-- model:headcount:end -->

<!-- model:opex:start -->
| Other OpEx, USD / month | M1-M15 (pre-seed) | M16-M24 (post-seed) | M25-M36 (scale) |
| --- | ---: | ---: | ---: |
| Software and tools (incl. PLC vendor licences) | $800 | $2,500 | $4,000 |
| Office / co-working (India; US co-working from M16) | $500 | $2,000 | $4,000 |
| Travel and trade shows | $1,500 | $10,000 | $15,000 |
| Marketing and content | $500 | $8,000 | $15,000 |
| Legal, accounting, compliance (India + US entity) | $1,000 | $3,000 | $4,000 |
| Insurance (product liability, E&O, cyber) | $300 | $1,500 | $3,000 |
| Recruiting | $0 | $3,000 | $4,000 |
| **Total recurring** | **$4,600** | **$30,000** | **$49,000** |

One-off items:

| Month | Item | Amount | Kept if seed slips |
| --- | --- | ---: | --- |
| M1 (Nov 2026) | Incorporation and pre-seed legal | $5,000 | yes |
| M2 (Dec 2026) | PLC test lab: Siemens, Rockwell and Beckhoff starter kits and licences | $10,000 | yes |
| M16 (Feb 2028) | Seed round legal | $15,000 | no |
| M17 (Mar 2028) | Test lab expansion: safety PLCs and drives | $12,000 | no |
| M22 (Aug 2028) | SOC 2 Type I audit | $25,000 | no |
| M30 (Apr 2029) | Independent functional-safety assessment of the tool | $40,000 | no |

Sales commissions: 10% of first-year contract value on new Team and Enterprise logos from month 16, when the first account executive starts. Payroll rises 8% (India) and 4% (US, Germany) in months 13 and 25.
<!-- model:opex:end -->

## 11. Funding and runway

<!-- model:funding:start -->
| Round | Timing | Amount (USD) | Use of funds |
| --- | --- | ---: | --- |
| Pre-seed (SAFE or CCPS) | M1 (Nov 2026) | $500,000 | 3 founders + 4 hires in India, PLC test lab, design partners, first 27 customers |
| Seed | M16 (Feb 2028) | $2,000,000 | US and DACH sales team, solutions engineers, twin library, SOC 2, independent functional-safety assessment |

| Runway metric | Value |
| --- | ---: |
| Net burn, months 1-15 (total) | $152,233 |
| Peak monthly burn before the seed | $20,900 (month 2) |
| Pre-seed runway at peak burn | 24 months |
| Cash at month 15, before the seed | $347,767 |
| Peak monthly burn after the seed | $80,429 (month 22) |
| Lowest cash after the seed | $1,586,587 (month 33) |
| Cash-flow positive from (plan) | M34 (Aug 2029) |
| Cash at month 36 (plan) | $1,643,822 |
| Fallback without seed: cash-flow positive from | M15 (Jan 2028) |
| Fallback without seed: lowest cash | $339,951 (month 14) |
| Fallback without seed: ARR / cash at month 36 | $1.56M / $1.28M |
<!-- model:funding:end -->

**Seed milestones (by month 15):**
- ≥ $400k ARR and ≥ 25 paying customers (the model has $426k and 27)
- The first Enterprise logo
- NRR ≥ 100%
- Measured LLM cost ≤ $1.50 per run
- Three referenceable case studies with defects found before site
- No safety-critical defect escaping a verified project

The India cost base keeps the pre-seed company close to default-alive. The fallback row shows break-even without the seed. The seed buys growth: month-36 ARR is about 2.2× the fallback's.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A missed bug contributes to an incident | Engineer sign-off on every patch; proofs scoped to the stated twin and rules; contracts cap liability; product-liability and E&O insurance from month 1; independent safety assessment (M30) |
| Twin fidelity: proofs on a wrong model | Validate twins against recorded I/O traces from the real machine; reusable validated components; held-out tests |
| PLC vendors bundle the same capability | Stay vendor-neutral and verification-first; integrate with vendor simulators instead of competing with them |
| LLM price, quality or outage | Allowances and overage pricing; caching, Haiku routing, Batch API; any Claude endpoint (Anthropic, Bedrock, Vertex, Azure); cost per run tracked in neatlogs |
| Customer IP (control code) leaves the plant | VPC / on-prem Enterprise; no training on customer code without consent; SOC 2 Type I (M22) |
| State-space explosion in model checking | Timer abstraction, per-station compositional checks, bounded checking with the bound stated in the report |
| Long industrial sales cycles | Self-serve Starter, design partners, integrators (who buy faster than plants), 4-week proofs of value |
| Small, India-based team selling to US/EU | Experienced US head of sales after the seed; integrator advisors; trade-show presence |

## 13. Metrics we track

| Area | Metric (source) |
|---|---|
| Agent quality | Seeded-fault detection rate; false-positive rate; % of runs ending in a verified patch; safety rules proven per run; held-out test pass rate (eval suite) |
| Agent operations | Tokens and LLM cost per run; steps per run; failed-action recovery rate; time to verdict (neatlogs traces) |
| Customer outcome (north star) | Logic defects caught before site per project; on-site debug hours saved (customer-reported) |
| Growth | New logos, MRR/ARR, ARPA, pilot → paid conversion, pipeline coverage |
| Retention | Logo churn, NRR, runs per active project, seats used |
| Efficiency and cash | Gross margin, CAC, CAC payback, burn multiple, net burn, months of runway |

---

*Rebuild after changing an assumption:* `uv run python docs/business-plan/build_model.py` from the repo root.
