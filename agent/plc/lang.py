"""The restricted control language ("ladder-lite"): tokenizer, parser, printer and validator.

    rung   := NAME '=' expr | 'SET' NAME 'WHEN' expr | 'RESET' NAME 'WHEN' expr
            | 'TON' TNAME '(' expr ',' NUMBER 's' ')'
    expr   := term ('OR' term)*
    term   := factor ('AND' factor)*
    factor := 'NOT' factor | '(' expr ')' | 'RISE' '(' NAME ')' | TNAME '.Q' | NAME | 'TRUE' | 'FALSE'

The AST matches web/src/types.ts (Expr, Rung) so programs can be exported to the viewer as-is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

INPUTS = ("START", "STOP", "ESTOP", "RESET", "GUARD_CLOSED", "PE_IN", "PE_END")
OUTPUTS = ("MOTOR", "LAMP_GREEN", "LAMP_AMBER", "LAMP_RED")
RESERVED = {"NOT", "AND", "OR", "TRUE", "FALSE", "WHEN", "RISE", "TON"}

# Limits that keep agent patches small and the state space checkable.
MAX_RUNGS = 24
MAX_COILS = 12
MAX_TIMERS = 4
MAX_LITERALS = 12
PT_MIN, PT_MAX = 0.1, 10.0

_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?s?)|([A-Z][A-Z0-9_]*(?:\.Q)?)|(\(|\)|,|=))")


class ParseError(ValueError):
    pass


def is_timer_name(name: str) -> bool:
    return re.fullmatch(r"T_[A-Z0-9_]+", name) is not None


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    pos = 0
    text = text.strip()
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            raise ParseError(f"unexpected character {text[pos]!r} at column {pos + 1}")
        tokens.append(m.group(m.lastindex))
        pos = m.end()
        while pos < len(text) and text[pos].isspace():
            pos += 1
    return tokens


class _Parser:
    def __init__(self, tokens: list[str]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> str | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, expected: str | None = None) -> str:
        tok = self.peek()
        if tok is None:
            raise ParseError(f"unexpected end of rung (expected {expected or 'more'})")
        if expected is not None and tok != expected:
            raise ParseError(f"expected {expected!r}, got {tok!r}")
        self.i += 1
        return tok

    def name(self) -> str:
        tok = self.take()
        if tok in RESERVED or not re.fullmatch(r"[A-Z][A-Z0-9_]*", tok):
            raise ParseError(f"expected a signal name, got {tok!r}")
        return tok

    def expr(self) -> dict:
        args = [self.term()]
        while self.peek() == "OR":
            self.take()
            args.append(self.term())
        return args[0] if len(args) == 1 else {"op": "or", "args": args}

    def term(self) -> dict:
        args = [self.factor()]
        while self.peek() == "AND":
            self.take()
            args.append(self.factor())
        return args[0] if len(args) == 1 else {"op": "and", "args": args}

    def factor(self) -> dict:
        tok = self.peek()
        if tok == "NOT":
            self.take()
            return {"op": "not", "arg": self.factor()}
        if tok == "(":
            self.take()
            e = self.expr()
            self.take(")")
            return e
        if tok == "RISE":
            self.take()
            self.take("(")
            n = self.name()
            self.take(")")
            return {"op": "rise", "name": n}
        if tok in ("TRUE", "FALSE"):
            self.take()
            return {"op": "const", "value": tok == "TRUE"}
        if tok is not None and tok.endswith(".Q"):
            self.take()
            n = tok[:-2]
            if not is_timer_name(n):
                raise ParseError(f"{tok!r}: only timers (T_...) have a .Q output")
            return {"op": "timer", "name": n}
        return {"op": "var", "name": self.name()}


def parse_rung(text: str, rung_id: str = "R00", comment: str | None = None) -> dict:
    """Parse one rung of source text into a Rung dict (see web/src/types.ts)."""
    toks = _tokenize(text)
    if not toks:
        raise ParseError("empty rung")
    p = _Parser(toks)
    rung: dict
    if toks[0] == "TON":
        p.take()
        target = p.take()
        if not is_timer_name(target):
            raise ParseError(f"timer names must look like T_NAME, got {target!r}")
        p.take("(")
        cond = p.expr()
        p.take(",")
        num = p.take()
        if not re.fullmatch(r"\d+(\.\d+)?s", num):
            raise ParseError(f"timer preset must look like 3.0s, got {num!r}")
        p.take(")")
        rung = {"kind": "ton", "target": target, "expr": cond, "pt": float(num[:-1])}
    elif toks[0] in ("SET", "RESET") and len(toks) > 2 and toks[2] == "WHEN":
        kind = p.take().lower()
        target = p.name()
        p.take("WHEN")
        rung = {"kind": kind, "target": target, "expr": p.expr()}
    else:
        target = p.name()
        p.take("=")
        rung = {"kind": "assign", "target": target, "expr": p.expr()}
    if p.peek() is not None:
        raise ParseError(f"unexpected {p.peek()!r} after the end of the rung")
    rung = {"id": rung_id, "text": rung_to_text(rung), **rung}
    if comment:
        rung["comment"] = comment
    return rung


_PREC = {"or": 1, "and": 2, "not": 3}


def expr_to_text(e: dict, parent: int = 0) -> str:
    op = e["op"]
    if op == "var":
        return e["name"]
    if op == "timer":
        return f"{e['name']}.Q"
    if op == "rise":
        return f"RISE({e['name']})"
    if op == "const":
        return "TRUE" if e["value"] else "FALSE"
    if op == "not":
        return f"NOT {expr_to_text(e['arg'], _PREC['not'])}"
    p = _PREC[op]
    s = (" AND " if op == "and" else " OR ").join(expr_to_text(a, p) for a in e["args"])
    return f"({s})" if parent > p else s


def rung_to_text(r: dict) -> str:
    kind, target, body = r["kind"], r["target"], expr_to_text(r["expr"])
    if kind == "assign":
        return f"{target} = {body}"
    if kind in ("set", "reset"):
        return f"{kind.upper()} {target} WHEN {body}"
    return f"TON {target}({body}, {r['pt']:g}s)"


def expr_refs(e: dict, out_vars: list[str] | None = None, out_timers: list[str] | None = None):
    """Names read by an expression, in depth-first order without duplicates."""
    out_vars = [] if out_vars is None else out_vars
    out_timers = [] if out_timers is None else out_timers
    op = e["op"]
    if op in ("var", "rise"):
        if e["name"] not in out_vars:
            out_vars.append(e["name"])
    elif op == "timer":
        if e["name"] not in out_timers:
            out_timers.append(e["name"])
    elif op == "not":
        expr_refs(e["arg"], out_vars, out_timers)
    elif op in ("and", "or"):
        for a in e["args"]:
            expr_refs(a, out_vars, out_timers)
    return out_vars, out_timers


def _literals(e: dict) -> int:
    if e["op"] == "not":
        return _literals(e["arg"])
    if e["op"] in ("and", "or"):
        return sum(_literals(a) for a in e["args"])
    return 1


def parse_program(source: str) -> list[dict]:
    """Parse a program written one rung per line as `R01  <rung>  # comment`."""
    rungs = []
    for line in source.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        comment = None
        if "#" in line:
            line, comment = line.split("#", 1)
            comment = comment.strip() or None
        rid, text = line.split(None, 1)
        rungs.append(parse_rung(text, rid, comment))
    return rungs


def validate_program(rungs: list[dict]) -> list[str]:
    """Static checks that every accepted program must pass. Returns a list of problems."""
    problems: list[str] = []
    if len(rungs) > MAX_RUNGS:
        problems.append(f"too many rungs ({len(rungs)} > {MAX_RUNGS})")
    ids = [r["id"] for r in rungs]
    if len(set(ids)) != len(ids):
        problems.append("duplicate rung ids")
    assigned: set[str] = set()
    timers: dict[str, float] = {}
    coils: set[str] = set()
    for r in rungs:
        t = r["target"]
        if t in INPUTS:
            problems.append(f"{r['id']}: {t} is an input and cannot be written")
        if r["kind"] == "ton":
            if t in timers:
                problems.append(f"{r['id']}: timer {t} is defined twice")
            pt = r.get("pt", 0)
            if not PT_MIN <= pt <= PT_MAX:
                problems.append(f"{r['id']}: timer preset {pt}s outside {PT_MIN}-{PT_MAX}s")
            timers[t] = pt
        else:
            if is_timer_name(t):
                problems.append(f"{r['id']}: {t} looks like a timer; write timers with TON")
            if r["kind"] == "assign":
                if t in assigned:
                    problems.append(f"{r['id']}: {t} is assigned by more than one rung")
                assigned.add(t)
            if t not in OUTPUTS:
                coils.add(t)
        if _literals(r["expr"]) > MAX_LITERALS:
            problems.append(f"{r['id']}: more than {MAX_LITERALS} contacts in one rung")
        _, used_timers = expr_refs(r["expr"])
        for tn in used_timers:
            if tn not in {x["target"] for x in rungs if x["kind"] == "ton"}:
                problems.append(f"{r['id']}: {tn}.Q is read but timer {tn} is never defined")
    if len(coils) > MAX_COILS:
        problems.append(f"too many internal coils ({len(coils)} > {MAX_COILS})")
    if len(timers) > MAX_TIMERS:
        problems.append(f"too many timers ({len(timers)} > {MAX_TIMERS})")
    if "MOTOR" not in assigned and not any(r["target"] == "MOTOR" for r in rungs):
        problems.append("nothing drives MOTOR")
    return problems


def program_to_text(rungs: list[dict]) -> str:
    lines = []
    for r in rungs:
        line = f"{r['id']}  {r['text']}"
        if r.get("comment"):
            line += f"    # {r['comment']}"
        lines.append(line)
    return "\n".join(lines)


@dataclass
class Edit:
    op: str  # "replace" | "insert_after" | "delete"
    id: str  # rung id the edit refers to ("START" inserts at the top)
    text: str = ""


def apply_edits(rungs: list[dict], edits: list[Edit]) -> list[dict]:
    """Apply a patch. New rungs get fresh ids. Raises ParseError on any invalid edit."""
    out = [dict(r) for r in rungs]
    used = {r["id"] for r in out}

    def fresh_id() -> str:
        n = 1
        while f"R{n:02d}" in used:
            n += 1
        used.add(f"R{n:02d}")
        return f"R{n:02d}"

    for e in edits:
        idx = next((i for i, r in enumerate(out) if r["id"] == e.id), None)
        if e.op == "insert_after" and e.id == "START":
            idx = -1
        if idx is None:
            raise ParseError(f"no rung with id {e.id!r}")
        if e.op == "replace":
            out[idx] = parse_rung(e.text, out[idx]["id"])
        elif e.op == "insert_after":
            out.insert(idx + 1, parse_rung(e.text, fresh_id()))
        elif e.op == "delete":
            out.pop(idx)
        else:
            raise ParseError(f"unknown edit op {e.op!r}")
    return out
