"""STOP/PROVE 36-month financial model. Standard library only.

Run from the repo root:

    uv run python docs/business-plan/build_model.py

Writes, in docs/business-plan/:
  model.csv   monthly model, one row per month (36 rows)
  README.md   only the tables between <!-- model:NAME:start/end --> markers are rewritten

Every number in the plan comes from the constants below. Change a constant,
re-run the script, and the CSV and the README tables stay consistent.
Amounts are USD. Month 1 = November 2026, the month after neatHack.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSV_PATH = HERE / "model.csv"
README_PATH = HERE / "README.md"

# ---------------------------------------------------------------------------
# Calendar and currency
# ---------------------------------------------------------------------------
START_YEAR, START_MONTH = 2026, 11  # month 1 = Nov 2026
MONTHS = 36
INR_PER_USD = 95  # planning rate; the rupee traded near 96 per USD in Sep 2026
PRE_SEED_END = 15  # months 1-15 run on the pre-seed; the seed lands in month 16


def period(m: int) -> str:
    """Spending periods: P1 pre-seed, P2 first seed year, P3 scale-up."""
    if m <= PRE_SEED_END:
        return "P1"
    if m <= 24:
        return "P2"
    return "P3"


PERIOD_LABEL = {"P1": "M1-M15 (pre-seed)", "P2": "M16-M24 (post-seed)", "P3": "M25-M36 (scale)"}

# ---------------------------------------------------------------------------
# Pricing and customers
# ---------------------------------------------------------------------------
TIERS = ("starter", "team", "enterprise")
TIER_LABEL = {"starter": "Starter", "team": "Team", "enterprise": "Enterprise"}
PRICE = {"starter": 500, "team": 2_000, "enterprise": 7_500}  # USD per customer per month
SEATS = {"starter": "2", "team": "8", "enterprise": "Unlimited"}
ACTIVE_PROJECTS = {"starter": "3", "team": "12", "enterprise": "Unlimited"}
RUN_ALLOWANCE = {"starter": 100, "team": 500, "enterprise": 2_500}  # verification runs / month
OVERAGE_PER_RUN = 2.50  # USD per run above the allowance; not in the model (upside)
RUNS_USED = {"starter": 60, "team": 300, "enterprise": 1_200}  # expected runs / customer / month
MONTHLY_CHURN = {"starter": 0.020, "team": 0.010, "enterprise": 0.005}  # logo churn per month
UPGRADE_RATE = {"starter": 0.015, "team": 0.005}  # share of the tier moving up one tier each month
NEXT_TIER = {"starter": "team", "team": "enterprise"}

# Gross new customers per month. Year 1 is set month by month: (starter, team).
# Months 1-3 are unpaid design-partner pilots; the first two convert in month 4.
Y1_NEW = {4: (1, 1), 5: (1, 0), 6: (1, 0), 7: (1, 1), 8: (1, 0), 9: (2, 1), 10: (1, 1), 11: (2, 1), 12: (2, 1)}
# Months 13-36: (starter, team) new customers per month, by quarter (Q5 = months 13-15).
QUARTER_NEW = {5: (2, 1), 6: (2, 2), 7: (2, 2), 8: (3, 3), 9: (3, 3), 10: (4, 3), 11: (4, 4), 12: (5, 4)}
ENTERPRISE_WIN_MONTHS = (15, 19, 22, 24, 26, 28, 30, 32, 33, 35, 36)

# Fallback scenario (seed does not close): founder-led sales only after month 15.
FALLBACK_NEW_AFTER_PRE_SEED = (2, 1)
FALLBACK_ENTERPRISE_WIN_MONTHS = (15, 21, 27, 33)

# ---------------------------------------------------------------------------
# Cost of goods sold
# ---------------------------------------------------------------------------
# Claude Sonnet 5.5 list prices, USD per million tokens:
# https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-12)
SONNET = {"input": 2.00, "cache_write_5m": 2.50, "cache_read": 0.10, "output": 10.00}

# One verification run = one agent pass over one controller program and its twin:
# simulate scenarios, inject faults, analyse traces, patch, model-check, re-test, report.
RUN_PROFILE = {
    "llm_steps": 30,  # LLM calls (agent steps) per run
    "avg_context_tokens": 50_000,  # prompt size per step, averaged over the run
    "cache_read_share": 0.85,  # prompt tokens served from the prompt cache
    "cache_write_share": 0.10,  # prompt tokens written to the 5-minute cache
    "uncached_share": 0.05,  # prompt tokens billed at the base input price
    "output_tokens_per_step": 2_000,  # incl. thinking
    "retry_overhead": 0.20,  # failed steps, retries and re-runs
}
# Engineering target for cost per run (routing trace triage to Haiku, Batch API for
# nightly regressions). No vendor price cut is assumed.
LLM_COST_INDEX = {1: 1.00, 2: 0.80, 3: 0.68}
COMPUTE_PER_RUN = 0.05  # simulation + model-checker CPU + trace storage, USD per run
HOSTING_BASE = 300  # USD per month: environments, monitoring, tracing
HOSTING_PER_CUSTOMER = 12  # USD per active customer per month
PAYMENT_FEES = 0.02  # share of revenue

# ---------------------------------------------------------------------------
# Team (fully loaded monthly cost in USD at start; India roles are CTC)
# ---------------------------------------------------------------------------
FOUNDER_MONTHLY = {"pre_seed": 2_000, "post_seed": 3_500}
RAISE = {"India": 0.08, "US": 0.04, "Germany": 0.04}  # applied in months 13 and 25
RAISE_MONTHS = (13, 25)


@dataclass(frozen=True)
class Role:
    title: str
    location: str
    start: int
    monthly_usd: int
    bucket: str  # "opex" or "cogs" (customer-facing engineers are cost of revenue)
    dept: str  # R&D, S&M, G&A or CS
    founder: bool = False
    in_fallback: bool = False  # kept in the no-seed fallback scenario


ROLES = [
    Role("Co-founder & CEO (Mohammad Umar)", "India", 1, 2_000, "opex", "G&A", True, True),
    Role("Co-founder, engineering (Bilal Feroz Khan)", "India", 1, 2_000, "opex", "R&D", True, True),
    Role("Co-founder, engineering (Fuad Ahamed)", "India", 1, 2_000, "opex", "R&D", True, True),
    Role("Founding engineer, formal methods / model checking", "India", 3, 3_000, "opex", "R&D", in_fallback=True),
    Role("Founding controls engineer, PLC + digital-twin library", "India", 4, 1_800, "opex", "R&D", in_fallback=True),
    Role("Full-stack / platform engineer", "India", 7, 2_200, "opex", "R&D", in_fallback=True),
    Role("Solutions / customer-success engineer #1", "India", 9, 1_600, "cogs", "CS", in_fallback=True),
    Role("Head of sales, North America", "US", 16, 15_000, "opex", "S&M"),
    Role("Senior ML / agent engineer", "India", 16, 3_500, "opex", "R&D"),
    Role("Controls engineer #2 (twin library)", "India", 17, 1_800, "opex", "R&D"),
    Role("Sales development rep #1 (US hours)", "India", 17, 1_200, "opex", "S&M"),
    Role("Account executive, DACH", "Germany", 18, 9_500, "opex", "S&M"),
    Role("DevOps / security engineer (VPC and on-prem)", "India", 18, 2_600, "opex", "R&D"),
    Role("Solutions engineer #2", "US", 19, 10_000, "cogs", "CS"),
    Role("Product marketing manager", "India", 20, 2_200, "opex", "S&M"),
    Role("Backend / platform engineer #2", "India", 21, 2_200, "opex", "R&D"),
    Role("Account executive #2, US", "US", 22, 10_000, "opex", "S&M"),
    Role("Customer-success engineer #3", "India", 23, 1_600, "cogs", "CS", in_fallback=True),
    Role("Formal methods engineer #2", "India", 24, 3_000, "opex", "R&D"),
    Role("Sales development rep #2", "India", 25, 1_200, "opex", "S&M"),
    Role("Controls engineer #3 (twin library)", "India", 26, 1_800, "opex", "R&D"),
    Role("Account executive #3, US", "US", 27, 10_000, "opex", "S&M"),
    Role("Finance & operations manager", "India", 28, 2_000, "opex", "G&A"),
    Role("Solutions engineer #4", "Germany", 29, 9_000, "cogs", "CS"),
    Role("ML / agent engineer #2", "India", 30, 3_000, "opex", "R&D"),
    Role("Frontend engineer", "India", 31, 2_000, "opex", "R&D"),
    Role("Partner / channel manager", "India", 32, 2_500, "opex", "S&M"),
    Role("QA / verification engineer", "India", 33, 1_800, "opex", "R&D"),
    Role("Account executive #2, DACH", "Germany", 34, 9_500, "opex", "S&M"),
    Role("Customer-success engineer #5", "India", 35, 1_600, "cogs", "CS"),
]

# ---------------------------------------------------------------------------
# Other operating expenses (USD per month, by period) and one-off items
# ---------------------------------------------------------------------------
OTHER_OPEX = {
    "Software and tools (incl. PLC vendor licences)": {"P1": 800, "P2": 2_500, "P3": 4_000},
    "Office / co-working (India; US co-working from M16)": {"P1": 500, "P2": 2_000, "P3": 4_000},
    "Travel and trade shows": {"P1": 1_500, "P2": 10_000, "P3": 15_000},
    "Marketing and content": {"P1": 500, "P2": 8_000, "P3": 15_000},
    "Legal, accounting, compliance (India + US entity)": {"P1": 1_000, "P2": 3_000, "P3": 4_000},
    "Insurance (product liability, E&O, cyber)": {"P1": 300, "P2": 1_500, "P3": 3_000},
    "Recruiting": {"P1": 0, "P2": 3_000, "P3": 4_000},
}
SALES_MARKETING_LINES = ("Travel and trade shows", "Marketing and content")
ONE_OFFS = [  # (month, item, USD, kept in the no-seed fallback)
    (1, "Incorporation and pre-seed legal", 5_000, True),
    (2, "PLC test lab: Siemens, Rockwell and Beckhoff starter kits and licences", 10_000, True),
    (16, "Seed round legal", 15_000, False),
    (17, "Test lab expansion: safety PLCs and drives", 12_000, False),
    (22, "SOC 2 Type I audit", 25_000, False),
    (30, "Independent functional-safety assessment of the tool", 40_000, False),
]
COMMISSION_RATE = 0.10  # of first-year contract value, new Team and Enterprise logos
COMMISSION_START = 16  # when the first account executive starts

# ---------------------------------------------------------------------------
# Funding
# ---------------------------------------------------------------------------
FUNDING = {1: ("Pre-seed", 500_000), 16: ("Seed", 2_000_000)}
FALLBACK_FUNDING = {1: ("Pre-seed", 500_000)}


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
def llm_run_cost() -> dict:
    """LLM cost of one verification run at Sonnet 5.5 list prices (year-1 cost index)."""
    p = RUN_PROFILE
    tokens_in = p["llm_steps"] * p["avg_context_tokens"]
    tokens_out = p["llm_steps"] * p["output_tokens_per_step"]
    parts = {
        "cache_read": tokens_in * p["cache_read_share"] * SONNET["cache_read"] / 1e6,
        "cache_write": tokens_in * p["cache_write_share"] * SONNET["cache_write_5m"] / 1e6,
        "uncached_input": tokens_in * p["uncached_share"] * SONNET["input"] / 1e6,
        "output": tokens_out * SONNET["output"] / 1e6,
    }
    base = sum(parts.values())
    return {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "parts": parts,
        "base": base,
        "total": base * (1 + p["retry_overhead"]),
    }


def year_of(m: int) -> int:
    return (m - 1) // 12 + 1


def cost_per_run(m: int) -> float:
    return llm_run_cost()["total"] * LLM_COST_INDEX[year_of(m)]


def role_cost(role: Role, m: int, fallback: bool) -> float:
    if m < role.start or (fallback and not role.in_fallback):
        return 0.0
    if role.founder:
        seeded = (not fallback) and m > PRE_SEED_END
        return FOUNDER_MONTHLY["post_seed" if seeded else "pre_seed"]
    cost = float(role.monthly_usd)
    for rm in RAISE_MONTHS:
        if role.start < rm <= m:
            cost *= 1 + RAISE[role.location]
    return cost


def new_customers(m: int, fallback: bool) -> dict:
    if m <= 12:
        starter, team = Y1_NEW.get(m, (0, 0))
    elif fallback and m > PRE_SEED_END:
        starter, team = FALLBACK_NEW_AFTER_PRE_SEED
    else:
        starter, team = QUARTER_NEW[(m - 1) // 3 + 1]
    wins = FALLBACK_ENTERPRISE_WIN_MONTHS if fallback else ENTERPRISE_WIN_MONTHS
    return {"starter": starter, "team": team, "enterprise": 1 if m in wins else 0}


def simulate(fallback: bool = False) -> list[dict]:
    customers = {t: 0 for t in TIERS}
    churn_acc = {t: 0.0 for t in TIERS}  # fractional churn carried to the next month
    upgrade_acc = {t: 0.0 for t in UPGRADE_RATE}
    cash = 0
    prev_mrr = 0
    rows = []
    for m in range(1, MONTHS + 1):
        per = "P1" if fallback else period(m)

        # 1. Churn on the opening base (whole customers; fractions carry forward).
        churned = {}
        for t in TIERS:
            churn_acc[t] += customers[t] * MONTHLY_CHURN[t]
            churned[t] = int(churn_acc[t] + 1e-9)
            churn_acc[t] -= churned[t]
            customers[t] -= churned[t]
        churned_mrr = sum(churned[t] * PRICE[t] for t in TIERS)

        # 2. Upgrades (Starter -> Team, Team -> Enterprise).
        upgrades = {}
        for t, rate in UPGRADE_RATE.items():
            upgrade_acc[t] += customers[t] * rate
            upgrades[t] = int(upgrade_acc[t] + 1e-9)
            upgrade_acc[t] -= upgrades[t]
        for t, n in upgrades.items():
            customers[t] -= n
            customers[NEXT_TIER[t]] += n
        expansion_mrr = sum(n * (PRICE[NEXT_TIER[t]] - PRICE[t]) for t, n in upgrades.items())

        # 3. New customers.
        new = new_customers(m, fallback)
        for t in TIERS:
            customers[t] += new[t]
        new_mrr = sum(new[t] * PRICE[t] for t in TIERS)

        total = sum(customers.values())
        mrr = sum(customers[t] * PRICE[t] for t in TIERS)
        revenue = mrr  # billed monthly; annual prepayment would improve cash (not assumed)

        # 4. Cost of goods sold.
        runs = sum(customers[t] * RUNS_USED[t] for t in TIERS)
        llm = round(runs * cost_per_run(m))
        infra = round(runs * COMPUTE_PER_RUN + HOSTING_BASE + HOSTING_PER_CUSTOMER * total + PAYMENT_FEES * revenue)
        support = round(sum(role_cost(r, m, fallback) for r in ROLES if r.bucket == "cogs"))
        cogs = llm + infra + support
        gross_profit = revenue - cogs

        # 5. Operating expenses.
        payroll = round(sum(role_cost(r, m, fallback) for r in ROLES if r.bucket == "opex"))
        recurring = sum(v[per] for v in OTHER_OPEX.values())
        one_offs = sum(usd for (mm, _, usd, keep) in ONE_OFFS if mm == m and (keep or not fallback))
        commissions = 0
        if not fallback and m >= COMMISSION_START:
            commissions = round(COMMISSION_RATE * 12 * (new["team"] * PRICE["team"] + new["enterprise"] * PRICE["enterprise"]))
        other_opex = recurring + one_offs + commissions
        opex = payroll + other_opex

        # 6. Cash.
        burn = cogs + opex - revenue  # positive = cash out
        funding = (FALLBACK_FUNDING if fallback else FUNDING).get(m, ("", 0))[1]
        cash += funding - burn

        sm_payroll = sum(role_cost(r, m, fallback) for r in ROLES if r.dept == "S&M")
        ceo_half = 0.5 * role_cost(ROLES[0], m, fallback)
        sm_other = sum(OTHER_OPEX[k][per] for k in SALES_MARKETING_LINES)
        rows.append(
            {
                "month": m,
                "date": f"{START_YEAR + (START_MONTH - 1 + m - 1) // 12}-{(START_MONTH - 1 + m - 1) % 12 + 1:02d}",
                "period": per,
                "new_customers": sum(new.values()),
                "new_starter": new["starter"],
                "new_team": new["team"],
                "new_enterprise": new["enterprise"],
                "churned_customers": sum(churned.values()),
                "upgrades": sum(upgrades.values()),
                "starter_customers": customers["starter"],
                "team_customers": customers["team"],
                "enterprise_customers": customers["enterprise"],
                "total_customers": total,
                "arpa_usd": round(mrr / total, 2) if total else 0,
                "mrr_usd": mrr,
                "arr_usd": mrr * 12,
                "revenue_usd": revenue,
                "verification_runs": runs,
                "llm_cost_per_run_usd": round(cost_per_run(m), 3),
                "llm_cost_usd": llm,
                "infra_cost_usd": infra,
                "support_cost_usd": support,
                "cogs_usd": cogs,
                "gross_profit_usd": gross_profit,
                "gross_margin_pct": round(100 * gross_profit / revenue, 1) if revenue else "",
                "headcount": sum(1 for r in ROLES if r.start <= m and (r.in_fallback or not fallback)),
                "payroll_usd": payroll,
                "other_opex_usd": other_opex,
                "total_opex_usd": opex,
                "burn_usd": burn,
                "funding_usd": funding,
                "cash_usd": cash,
                "runway_months": round(cash / burn, 1) if burn > 0 else "",
                # Used for the summary tables only (not written to the CSV).
                "_churned_mrr": churned_mrr,
                "_expansion_mrr": expansion_mrr,
                "_new_mrr": new_mrr,
                "_prev_mrr": prev_mrr,
                "_commissions": commissions,
                "_sm_spend": sm_payroll + ceo_half + sm_other + commissions,
            }
        )
        prev_mrr = mrr
    return rows


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
def usd(x: float, decimals: int = 0) -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.{decimals}f}"


def usd_k(x: float) -> str:
    sign = "-" if x < 0 else ""
    x = abs(x)
    if x >= 1_000_000:
        return f"{sign}${x / 1e6:,.2f}M"
    return f"{sign}${x / 1e3:,.0f}k"


def pct(x: float, decimals: int = 0) -> str:
    return f"{100 * x:.{decimals}f}%"


def table(headers: list[str], rows: list[list], align: str | None = None) -> str:
    align = align or "l" + "r" * (len(headers) - 1)
    sep = ["---:" if a == "r" else "---" for a in align]
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(sep) + " |"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def tier_mix(r: dict) -> str:
    return f"{r['total_customers']} ({r['starter_customers']}/{r['team_customers']}/{r['enterprise_customers']})"


def gm(rows: list[dict]) -> float:
    rev = sum(r["revenue_usd"] for r in rows)
    return (rev - sum(r["cogs_usd"] for r in rows)) / rev if rev else 0.0


def nrr_trailing_12(rows: list[dict], end: int) -> float:
    """Approximate net revenue retention: product of monthly (1 - churn + expansion) on the opening base."""
    factor = 1.0
    for r in rows[end - 12 : end]:
        if r["_prev_mrr"]:
            factor *= 1 + (r["_expansion_mrr"] - r["_churned_mrr"]) / r["_prev_mrr"]
    return factor


def sustained_breakeven(rows: list[dict], after: int) -> int | None:
    """First month after `after` from which net burn stays at or below zero to month 36."""
    found = None
    for r in reversed(rows):
        if r["month"] <= after or r["burn_usd"] > 0:
            break
        found = r["month"]
    return found


def month_name(m: int) -> str:
    names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    idx = START_MONTH - 1 + m - 1
    return f"{names[idx % 12]} {START_YEAR + idx // 12}"


# ---------------------------------------------------------------------------
# README blocks
# ---------------------------------------------------------------------------
def blocks(plan: list[dict], fb: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    run = llm_run_cost()
    by = {r["month"]: r for r in plan}
    years = {y: plan[(y - 1) * 12 : y * 12] for y in (1, 2, 3)}

    # Headline numbers
    pre = plan[:PRE_SEED_END]
    post = plan[PRE_SEED_END:]
    peak_pre_burn = max(r["burn_usd"] for r in pre)
    pre_low = min(pre, key=lambda r: r["cash_usd"])
    peak_post = max(post, key=lambda r: r["burn_usd"])
    post_low = min(post, key=lambda r: r["cash_usd"])
    plan_breakeven = sustained_breakeven(plan, after=PRE_SEED_END)
    fb_breakeven = sustained_breakeven(fb, after=12)
    min_fb = min(fb, key=lambda r: r["cash_usd"])
    end = by[MONTHS]
    last3_burn = sum(r["burn_usd"] for r in plan[-3:]) / 3
    out["headline"] = "\n".join(
        [
            f"- **Pricing:** Starter {usd(PRICE['starter'])}/month, Team {usd(PRICE['team'])}/month, "
            f"Enterprise {usd(PRICE['enterprise'])}/month (modeled average; VPC or on-prem, quoted per site).",
            f"- **ARR:** {usd_k(by[12]['arr_usd'])} at month 12 ({month_name(12)}), {usd_k(by[24]['arr_usd'])} at month 24, "
            f"{usd_k(by[36]['arr_usd'])} at month 36, with {by[12]['total_customers']} / {by[24]['total_customers']} / "
            f"{by[36]['total_customers']} paying customers.",
            f"- **Gross margin:** {pct(gm(years[1]))} in year 1, {pct(gm(years[2]))} in year 2, {pct(gm(years[3]))} in year 3. "
            f"LLM cost is {usd(run['total'], 2)} per verification run at Claude Sonnet 5.5 list prices in year 1.",
            f"- **Funding:** {usd_k(FUNDING[1][1])} pre-seed now (month 1), then a {usd_k(FUNDING[16][1])} seed in month 16 "
            f"({month_name(16)}) once the seed milestones are met.",
            f"- **Runway:** pre-seed burn peaks at {usd_k(peak_pre_burn)}/month, so {usd_k(FUNDING[1][1])} is "
            f"{FUNDING[1][1] / peak_pre_burn:.0f} months of runway at peak burn. Cash never drops below {usd_k(pre_low['cash_usd'])} "
            f"before the seed. After the seed, burn peaks at {usd_k(peak_post['burn_usd'])}/month (month {peak_post['month']}), "
            f"cash bottoms at {usd_k(post_low['cash_usd'])} (month {post_low['month']}), and "
            + (
                f"the company is cash-flow positive from month {plan_breakeven} ({month_name(plan_breakeven)}), "
                f"ending month 36 with {usd_k(end['cash_usd'])}."
                if plan_breakeven
                else f"month-36 cash of {usd_k(end['cash_usd'])} covers {end['cash_usd'] / last3_burn:.0f} more months "
                f"at the month 34-36 burn."
            ),
            f"- **If the seed slips:** with the team frozen at {fb[PRE_SEED_END - 1]['headcount']} people and founder-led sales, "
            + (
                f"the company is cash-flow positive from month {fb_breakeven} ({month_name(fb_breakeven)}) and cash never "
                f"drops below {usd_k(min_fb['cash_usd'])}."
                if fb_breakeven
                else f"cash bottoms at {usd_k(min_fb['cash_usd'])} in month {min_fb['month']}."
            ),
        ]
    )

    # Pricing table
    out["pricing"] = table(
        ["", "Starter", "Team", "Enterprise"],
        [
            ["Price (USD / month)"] + [usd(PRICE[t]) for t in TIERS],
            ["Price (USD / year)"] + [usd(12 * PRICE[t]) for t in TIERS],
            ["Engineer seats"] + [SEATS[t] for t in TIERS],
            ["Active controller projects"] + [ACTIVE_PROJECTS[t] for t in TIERS],
            ["Verification runs included / month"] + [f"{RUN_ALLOWANCE[t]:,}" for t in TIERS],
            ["Expected runs used / month (model)"] + [f"{RUNS_USED[t]:,}" for t in TIERS],
            ["Overage per extra run"] + [usd(OVERAGE_PER_RUN, 2)] * 3,
            ["Monthly logo churn (model)"] + [pct(MONTHLY_CHURN[t], 1) for t in TIERS],
            ["Monthly upgrade to next tier (model)"]
            + [pct(UPGRADE_RATE["starter"], 1), pct(UPGRADE_RATE["team"], 1), "n/a"],
        ],
        "lrrr",
    )

    # LLM cost per run
    p = RUN_PROFILE
    tin = run["tokens_in"]
    parts = run["parts"]
    out["run-cost"] = table(
        ["Component", "Tokens per run", "Sonnet 5.5 price (USD / MTok)", "Cost per run"],
        [
            ["Prompt tokens read from cache", f"{tin * p['cache_read_share']:,.0f}", usd(SONNET["cache_read"], 2), usd(parts["cache_read"], 3)],
            ["Prompt tokens written to cache (5 min)", f"{tin * p['cache_write_share']:,.0f}", usd(SONNET["cache_write_5m"], 2), usd(parts["cache_write"], 3)],
            ["Uncached prompt tokens", f"{tin * p['uncached_share']:,.0f}", usd(SONNET["input"], 2), usd(parts["uncached_input"], 3)],
            ["Output tokens (incl. thinking)", f"{run['tokens_out']:,.0f}", usd(SONNET["output"], 2), usd(parts["output"], 3)],
            ["**Subtotal**", f"{tin + run['tokens_out']:,.0f}", "", f"**{usd(run['base'], 3)}**"],
            [f"Retries and failed steps (+{pct(p['retry_overhead'])})", "", "", usd(run["total"] - run["base"], 3)],
            ["**LLM cost per run, year 1**", "", "", f"**{usd(run['total'], 2)}**"],
            [f"Year 2 / year 3 (cost index {LLM_COST_INDEX[2]:.2f} / {LLM_COST_INDEX[3]:.2f})", "", "",
             f"{usd(run['total'] * LLM_COST_INDEX[2], 2)} / {usd(run['total'] * LLM_COST_INDEX[3], 2)}"],
            ["Compute: simulation, model checking, storage", "", "", usd(COMPUTE_PER_RUN, 2)],
        ],
        "lrrr",
    )

    # Unit economics per tier (year-1 costs)
    ue_rows = []
    for t in TIERS:
        llm = RUNS_USED[t] * run["total"]
        compute = RUNS_USED[t] * COMPUTE_PER_RUN
        fees = PAYMENT_FEES * PRICE[t]
        direct = llm + compute + fees + HOSTING_PER_CUSTOMER
        direct_y3 = direct - llm * (1 - LLM_COST_INDEX[3])
        ue_rows.append(
            [TIER_LABEL[t], usd(PRICE[t]), usd(llm), usd(compute), usd(fees + HOSTING_PER_CUSTOMER), usd(direct),
             pct((PRICE[t] - direct) / PRICE[t]), pct((PRICE[t] - direct_y3) / PRICE[t])]
        )
    out["unit-economics"] = table(
        ["Tier", "Price / month", "LLM (year 1)", "Compute", "Hosting + payment fees", "Direct COGS / month",
         "Contribution margin, year 1", "Contribution margin, year 3"],
        ue_rows,
    )

    # Year-1 monthly revenue table
    y1 = []
    for r in years[1]:
        y1.append(
            [f"M{r['month']} ({month_name(r['month'])})", r["new_customers"], tier_mix(r), usd(r["arpa_usd"]), usd(r["mrr_usd"]),
             usd(r["cogs_usd"]), f"{r['gross_margin_pct']}%" if r["gross_margin_pct"] != "" else "n/a",
             usd(r["total_opex_usd"]), usd(r["burn_usd"]), usd(r["cash_usd"])]
        )
    out["revenue-y1"] = table(
        ["Month", "New", "Customers (S/T/E)", "ARPA", "MRR = revenue", "COGS", "Gross margin", "OpEx", "Net burn", "Cash"],
        y1,
    )

    # Quarterly table, years 2-3
    q = []
    for qi in range(5, 13):
        rs = plan[(qi - 1) * 3 : qi * 3]
        last = rs[-1]
        q.append(
            [f"Q{qi} (M{rs[0]['month']}-M{last['month']})", sum(r["new_customers"] for r in rs), tier_mix(last),
             usd(last["arpa_usd"]), usd(last["mrr_usd"]), usd_k(last["arr_usd"]), usd_k(sum(r["revenue_usd"] for r in rs)),
             pct(gm(rs)), usd_k(sum(r["burn_usd"] for r in rs)), usd_k(last["cash_usd"])]
        )
    out["revenue-quarterly"] = table(
        ["Quarter", "New", "Customers at end (S/T/E)", "ARPA", "MRR at end", "ARR at end", "Revenue", "Gross margin",
         "Net burn", "Cash at end"],
        q,
    )

    # Annual summary
    a = []
    for y, rs in years.items():
        last = rs[-1]
        a.append(
            [f"Year {y} (M{rs[0]['month']}-M{last['month']})", usd_k(sum(r["revenue_usd"] for r in rs)),
             usd_k(sum(r["cogs_usd"] for r in rs)), pct(gm(rs)), usd_k(sum(r["payroll_usd"] for r in rs)),
             usd_k(sum(r["other_opex_usd"] for r in rs)), usd_k(sum(r["burn_usd"] for r in rs)),
             usd_k(sum(r["funding_usd"] for r in rs)), usd_k(last["cash_usd"]), last["total_customers"],
             usd_k(last["arr_usd"]), last["headcount"]]
        )
    out["annual"] = table(
        ["Year", "Revenue", "COGS", "Gross margin", "Payroll (OpEx)", "Other OpEx", "Net burn", "Funding",
         "Cash at end", "Customers at end", "ARR at end", "Headcount at end"],
        a,
    )

    # SaaS metrics by year
    s = []
    for y, rs in years.items():
        new_logos = sum(r["new_customers"] for r in rs)
        sm = sum(r["_sm_spend"] for r in rs)
        cac = sm / new_logos
        new_arpa = sum(r["_new_mrr"] for r in rs) / new_logos
        payback = cac / (new_arpa * gm(rs))
        start_arr = plan[(y - 1) * 12 - 1]["arr_usd"] if y > 1 else 0
        net_new_arr = rs[-1]["arr_usd"] - start_arr
        burn = sum(r["burn_usd"] for r in rs)
        nrr = pct(nrr_trailing_12(plan, y * 12)) if y > 1 else "n/a (no 12-month base yet)"
        s.append([f"Year {y}", usd_k(net_new_arr), f"{burn / net_new_arr:.1f}x" if net_new_arr > 0 else "n/a",
                  nrr, usd(cac), usd(new_arpa), f"{payback:.1f} months"])
    out["saas-metrics"] = table(
        ["Year", "Net new ARR", "Burn multiple", "Net revenue retention", "Blended CAC", "New-customer ARPA",
         "CAC payback"],
        s,
    )

    # Headcount plan
    h = []
    for i, r in enumerate(ROLES, 1):
        cost = (f"{usd(FOUNDER_MONTHLY['pre_seed'])} -> {usd(FOUNDER_MONTHLY['post_seed'])} from M{PRE_SEED_END + 1}"
                if r.founder else usd(r.monthly_usd))
        inr = (f"{FOUNDER_MONTHLY['pre_seed'] * 12 * INR_PER_USD / 1e5:.1f} -> {FOUNDER_MONTHLY['post_seed'] * 12 * INR_PER_USD / 1e5:.1f}"
               if r.founder else (f"{r.monthly_usd * 12 * INR_PER_USD / 1e5:.1f}" if r.location == "India" else "-"))
        bucket = "COGS" if r.bucket == "cogs" else "OpEx"
        h.append([i, r.title, r.location, f"M{r.start} ({month_name(r.start)})", cost, inr, f"{r.dept} / {bucket}",
                  "yes" if r.in_fallback else "no"])
    out["headcount"] = table(
        ["#", "Role", "Location", "Starts", "Loaded cost / month (USD)", "INR lakh / year", "Dept / bucket",
         "Kept if seed slips"],
        h,
        "rlllrrll",
    )

    # Other opex
    o = [[k] + [usd(v[p]) for p in ("P1", "P2", "P3")] for k, v in OTHER_OPEX.items()]
    o.append(["**Total recurring**"] + [f"**{usd(sum(v[p] for v in OTHER_OPEX.values()))}**" for p in ("P1", "P2", "P3")])
    one = [[f"M{mm} ({month_name(mm)})", item, usd(v), "yes" if keep else "no"] for (mm, item, v, keep) in ONE_OFFS]
    out["opex"] = (
        table(["Other OpEx, USD / month", PERIOD_LABEL["P1"], PERIOD_LABEL["P2"], PERIOD_LABEL["P3"]], o, "lrrr")
        + "\n\nOne-off items:\n\n"
        + table(["Month", "Item", "Amount", "Kept if seed slips"], one, "llrl")
        + f"\n\nSales commissions: {pct(COMMISSION_RATE)} of first-year contract value on new Team and Enterprise "
        f"logos from month {COMMISSION_START}, when the first account executive starts. Payroll rises "
        f"{pct(RAISE['India'])} (India) and {pct(RAISE['US'])} (US, Germany) in months {RAISE_MONTHS[0]} and {RAISE_MONTHS[1]}."
    )

    # Funding and runway
    f = [
        ["Pre-seed (SAFE or CCPS)", f"M1 ({month_name(1)})", usd(FUNDING[1][1]),
         f"3 founders + 4 hires in India, PLC test lab, design partners, first {by[PRE_SEED_END]['total_customers']} customers"],
        ["Seed", f"M16 ({month_name(16)})", usd(FUNDING[16][1]),
         "US and DACH sales team, solutions engineers, twin library, SOC 2, independent functional-safety assessment"],
    ]
    fb_end = fb[-1]
    pre_burn_total = sum(r["burn_usd"] for r in pre)
    runway_rows = [
        ["Net burn, months 1-15 (total)", usd(pre_burn_total)],
        ["Peak monthly burn before the seed", f"{usd(peak_pre_burn)} (month {max(pre, key=lambda r: r['burn_usd'])['month']})"],
        ["Pre-seed runway at peak burn", f"{FUNDING[1][1] / peak_pre_burn:.0f} months"],
        [f"Cash at month {PRE_SEED_END}, before the seed", usd(by[PRE_SEED_END]["cash_usd"])],
        ["Peak monthly burn after the seed", f"{usd(peak_post['burn_usd'])} (month {peak_post['month']})"],
        ["Lowest cash after the seed", f"{usd(post_low['cash_usd'])} (month {post_low['month']})"],
        ["Cash-flow positive from (plan)", f"M{plan_breakeven} ({month_name(plan_breakeven)})" if plan_breakeven else "not within 36 months"],
        ["Cash at month 36 (plan)", usd(end["cash_usd"])],
        ["Fallback without seed: cash-flow positive from", f"M{fb_breakeven} ({month_name(fb_breakeven)})" if fb_breakeven else "not within 36 months"],
        ["Fallback without seed: lowest cash", f"{usd(min_fb['cash_usd'])} (month {min_fb['month']})"],
        ["Fallback without seed: ARR / cash at month 36", f"{usd_k(fb_end['arr_usd'])} / {usd_k(fb_end['cash_usd'])}"],
    ]
    out["funding"] = (
        table(["Round", "Timing", "Amount (USD)", "Use of funds"], f, "llrl")
        + "\n\n"
        + table(["Runway metric", "Value"], runway_rows, "lr")
    )
    return out


def write_csv(rows: list[dict]) -> None:
    fields = [k for k in rows[0] if not k.startswith("_")]
    with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fields})


def update_readme(generated: dict[str, str]) -> list[str]:
    if not README_PATH.exists():
        return []
    text = README_PATH.read_text(encoding="utf-8")
    updated = []
    for name, body in generated.items():
        pattern = re.compile(
            rf"(<!-- model:{re.escape(name)}:start -->\n).*?(\n<!-- model:{re.escape(name)}:end -->)", re.S
        )
        text, n = pattern.subn(lambda m: m.group(1) + body + m.group(2), text)
        if n:
            updated.append(name)
    README_PATH.write_text(text, encoding="utf-8", newline="\n")
    return updated


def main() -> None:
    plan = simulate()
    fallback = simulate(fallback=True)
    write_csv(plan)
    generated = blocks(plan, fallback)
    updated = update_readme(generated)
    print(f"wrote {CSV_PATH.name} ({len(plan)} months)")
    print(f"README blocks updated: {', '.join(updated) if updated else 'none (no README markers yet)'}")
    for name, body in generated.items():
        print(f"\n## {name}\n\n{body}")


if __name__ == "__main__":
    main()
