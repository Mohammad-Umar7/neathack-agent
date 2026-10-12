// Rung language ("ladder-lite"): tokenizer, parser and printer.
// Produces the same AST as the Python parser (agent/plc), see Expr / Rung in ../types.
//
//   rung    := NAME '=' expr
//            | 'SET' NAME 'WHEN' expr
//            | 'RESET' NAME 'WHEN' expr
//            | 'TON' TNAME '(' expr ',' NUMBER 's' ')'
//   expr    := term ('OR' term)*
//   term    := factor ('AND' factor)*
//   factor  := 'NOT' factor | '(' expr ')' | 'RISE' '(' NAME ')' | TNAME '.Q' | NAME | 'TRUE' | 'FALSE'

import type { Expr, Rung } from '../types';

export const INPUT_NAMES = ['START', 'STOP', 'ESTOP', 'RESET', 'GUARD_CLOSED', 'PE_IN', 'PE_END'] as const;
export const OUTPUT_NAMES = ['MOTOR', 'LAMP_GREEN', 'LAMP_AMBER', 'LAMP_RED'] as const;
export const RESERVED = new Set(['NOT', 'AND', 'OR', 'TRUE', 'FALSE', 'WHEN', 'RISE', 'TON']);

const INPUT_SET = new Set<string>(INPUT_NAMES);
const OUTPUT_SET = new Set<string>(OUTPUT_NAMES);

export const isInput = (n: string): boolean => INPUT_SET.has(n);
export const isOutput = (n: string): boolean => OUTPUT_SET.has(n);
export const isTimerName = (n: string): boolean => /^T_[A-Z0-9_]+$/.test(n);

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
    public len = 1,
  ) {
    super(message);
  }
}

type TokKind = 'name' | 'num' | 'sym' | 'eof';
interface Tok {
  k: TokKind;
  v: string;
  pos: number;
  len: number;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      let v = src.slice(i, j).toUpperCase();
      // T_NAME.Q
      if (src[j] === '.' && /[Qq]/.test(src[j + 1] ?? '') && !/[A-Za-z0-9_]/.test(src[j + 2] ?? '')) {
        v += '.Q';
        j += 2;
      }
      out.push({ k: 'name', v, pos: i, len: j - i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = src.slice(i, j);
      if (!/^\d*\.?\d+$|^\d+\.$/.test(v)) throw new ParseError(`Bad number "${v}"`, i, j - i);
      out.push({ k: 'num', v, pos: i, len: j - i });
      i = j;
      continue;
    }
    if ('=(),'.includes(c)) {
      out.push({ k: 'sym', v: c, pos: i, len: 1 });
      i++;
      continue;
    }
    throw new ParseError(`Unexpected character "${c}"`, i);
  }
  out.push({ k: 'eof', v: '', pos: src.length, len: 1 });
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next(): Tok {
    const t = this.peek();
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  isKw(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'name' && t.v === v;
  }
  isSym(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'sym' && t.v === v;
  }
  expectSym(v: string): Tok {
    const t = this.peek();
    if (t.k !== 'sym' || t.v !== v) throw new ParseError(`Expected "${v}"${describe(t)}`, t.pos, t.len);
    return this.next();
  }
  expectKw(v: string): Tok {
    const t = this.peek();
    if (t.k !== 'name' || t.v !== v) throw new ParseError(`Expected ${v}${describe(t)}`, t.pos, t.len);
    return this.next();
  }
  expectName(what: string): Tok {
    const t = this.peek();
    if (t.k !== 'name' || RESERVED.has(t.v) || t.v.endsWith('.Q'))
      throw new ParseError(`Expected ${what}${describe(t)}`, t.pos, t.len);
    if (!/^[A-Z][A-Z0-9_]*$/.test(t.v)) throw new ParseError(`Bad name "${t.v}"`, t.pos, t.len);
    return this.next();
  }
  done(): void {
    const t = this.peek();
    if (t.k !== 'eof') throw new ParseError(`Unexpected "${t.v}" after the end of the rung`, t.pos, t.len);
  }

  expr(): Expr {
    const args = [this.term()];
    while (this.isKw('OR')) {
      this.next();
      args.push(this.term());
    }
    return args.length === 1 ? args[0] : { op: 'or', args };
  }
  term(): Expr {
    const args = [this.factor()];
    while (this.isKw('AND')) {
      this.next();
      args.push(this.factor());
    }
    return args.length === 1 ? args[0] : { op: 'and', args };
  }
  factor(): Expr {
    const t = this.peek();
    if (t.k === 'sym' && t.v === '(') {
      this.next();
      const e = this.expr();
      this.expectSym(')');
      return e;
    }
    if (t.k !== 'name') throw new ParseError(`Expected a signal, NOT, RISE or "("${describe(t)}`, t.pos, t.len);
    if (t.v === 'NOT') {
      this.next();
      return { op: 'not', arg: this.factor() };
    }
    if (t.v === 'TRUE' || t.v === 'FALSE') {
      this.next();
      return { op: 'const', value: t.v === 'TRUE' };
    }
    if (t.v === 'RISE') {
      this.next();
      this.expectSym('(');
      const n = this.expectName('a signal name inside RISE( )');
      this.expectSym(')');
      return { op: 'rise', name: n.v };
    }
    if (t.v.endsWith('.Q')) {
      const name = t.v.slice(0, -2);
      if (!isTimerName(name)) throw new ParseError(`Only timers (T_...) have a .Q output`, t.pos, t.len);
      this.next();
      return { op: 'timer', name };
    }
    if (RESERVED.has(t.v)) throw new ParseError(`"${t.v}" is a reserved word here`, t.pos, t.len);
    if (isTimerName(t.v)) throw new ParseError(`Read a timer with ${t.v}.Q`, t.pos, t.len);
    this.next();
    return { op: 'var', name: t.v };
  }
}

function describe(t: Tok): string {
  if (t.k === 'eof') return ' but the rung ended';
  return ` but found "${t.v}"`;
}

/** Parse one rung of source text. Throws ParseError with a character position. */
export function parseRung(text: string, id = 'R01'): Rung {
  const src = text.trim();
  if (!src) throw new ParseError('Empty rung', 0);
  const toks = tokenize(src);
  const p = new Parser(toks);
  const first = p.peek();

  // TON T_X(expr, 3.0s)
  if (p.isKw('TON')) {
    p.next();
    const nt = p.peek();
    if (nt.k !== 'name' || !isTimerName(nt.v))
      throw new ParseError(`Timer names start with T_ (e.g. T_JAM)${describe(nt)}`, nt.pos, nt.len);
    p.next();
    p.expectSym('(');
    const expr = p.expr();
    p.expectSym(',');
    const num = p.peek();
    if (num.k !== 'num') throw new ParseError(`Expected a preset like 3.0s${describe(num)}`, num.pos, num.len);
    p.next();
    const unit = p.peek();
    let pt = parseFloat(num.v);
    if (unit.k === 'name' && (unit.v === 'S' || unit.v === 'MS')) {
      p.next();
      if (unit.v === 'MS') pt = pt / 1000;
    } else if (unit.k === 'name' && /^S$/i.test(unit.v)) {
      p.next();
    } else {
      throw new ParseError(`Expected the unit "s" after the preset`, unit.pos, unit.len);
    }
    p.expectSym(')');
    p.done();
    if (!(pt > 0)) throw new ParseError('Timer preset must be positive', num.pos, num.len);
    return { id, text: src, kind: 'ton', target: nt.v, expr, pt };
  }

  // SET X WHEN expr / RESET X WHEN expr (RESET is also an input name: RESET followed by a name is the rung form)
  if ((p.isKw('SET') || p.isKw('RESET')) && p.peek(1).k === 'name' && !p.isSym('=', 1)) {
    const kind = p.next().v === 'SET' ? 'set' : 'reset';
    const tgt = p.expectName('a coil name');
    checkTarget(tgt);
    p.expectKw('WHEN');
    const expr = p.expr();
    p.done();
    return { id, text: src, kind, target: tgt.v, expr };
  }

  // X = expr
  if (first.k === 'name' && p.isSym('=', 1)) {
    const tgt = p.expectName('a coil name');
    checkTarget(tgt);
    p.expectSym('=');
    const expr = p.expr();
    p.done();
    return { id, text: src, kind: 'assign', target: tgt.v, expr };
  }

  throw new ParseError('A rung looks like "COIL = expr", "SET COIL WHEN expr", "RESET COIL WHEN expr" or "TON T_X(expr, 3.0s)"', 0, src.length);
}

function checkTarget(t: Tok): void {
  if (isInput(t.v)) throw new ParseError(`${t.v} is an input and cannot be written`, t.pos, t.len);
  if (isTimerName(t.v)) throw new ParseError(`Names starting with T_ are reserved for timers`, t.pos, t.len);
}

/** Parse a whole program: one rung per non-empty line; lines starting with # or // are comments. */
export function parseProgram(src: string): { rungs: Rung[]; errors: { line: number; error: ParseError }[] } {
  const rungs: Rung[] = [];
  const errors: { line: number; error: ParseError }[] = [];
  src.split(/\r?\n/).forEach((raw, line) => {
    let s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return;
    // allow an optional leading rung id, e.g. "R06  RUN = ..."
    const m = /^(R\d+)\s*[:\s]\s*(.*)$/.exec(s);
    let id = `R${String(rungs.length + 1).padStart(2, '0')}`;
    if (m && !/^\s*=/.test(m[2])) {
      id = m[1];
      s = m[2];
    }
    try {
      rungs.push(parseRung(s, id));
    } catch (e) {
      if (e instanceof ParseError) errors.push({ line, error: e });
      else throw e;
    }
  });
  return { rungs, errors };
}

const PREC: Record<string, number> = { or: 1, and: 2, not: 3 };

/** Print an expression with minimal parentheses. */
export function exprToText(e: Expr, parentPrec = 0): string {
  switch (e.op) {
    case 'var':
      return e.name;
    case 'timer':
      return `${e.name}.Q`;
    case 'rise':
      return `RISE(${e.name})`;
    case 'const':
      return e.value ? 'TRUE' : 'FALSE';
    case 'not':
      return `NOT ${exprToText(e.arg, PREC.not)}`;
    case 'and':
    case 'or': {
      const p = PREC[e.op];
      const s = e.args.map((a) => exprToText(a, p)).join(e.op === 'and' ? ' AND ' : ' OR ');
      return parentPrec > p ? `(${s})` : s;
    }
  }
}

export function rungToText(r: Rung): string {
  const e = exprToText(r.expr);
  switch (r.kind) {
    case 'assign':
      return `${r.target} = ${e}`;
    case 'set':
      return `SET ${r.target} WHEN ${e}`;
    case 'reset':
      return `RESET ${r.target} WHEN ${e}`;
    case 'ton':
      return `TON ${r.target}(${e}, ${formatPt(r.pt ?? 0)}s)`;
  }
}

export function formatPt(pt: number): string {
  return Number.isInteger(pt) ? pt.toFixed(1) : String(Math.round(pt * 1000) / 1000);
}

/** Every signal name an expression reads (vars and rise operands), and timer names it reads. */
export function exprRefs(e: Expr, vars = new Set<string>(), timers = new Set<string>()): { vars: Set<string>; timers: Set<string> } {
  switch (e.op) {
    case 'var':
    case 'rise':
      vars.add(e.name);
      break;
    case 'timer':
      timers.add(e.name);
      break;
    case 'not':
      exprRefs(e.arg, vars, timers);
      break;
    case 'and':
    case 'or':
      e.args.forEach((a) => exprRefs(a, vars, timers));
      break;
  }
  return { vars, timers };
}

/** Structural equality of two expressions. */
export function exprEqual(a: Expr, b: Expr): boolean {
  if (a.op !== b.op) return false;
  switch (a.op) {
    case 'var':
    case 'timer':
    case 'rise':
      return a.name === (b as typeof a).name;
    case 'const':
      return a.value === (b as typeof a).value;
    case 'not':
      return exprEqual(a.arg, (b as typeof a).arg);
    case 'and':
    case 'or': {
      const bb = b as typeof a;
      return a.args.length === bb.args.length && a.args.every((x, i) => exprEqual(x, bb.args[i]));
    }
  }
}

export function rungEqual(a: Rung, b: Rung): boolean {
  return a.kind === b.kind && a.target === b.target && (a.pt ?? 0) === (b.pt ?? 0) && exprEqual(a.expr, b.expr);
}

/** Warnings for a program that parses but is suspicious (unknown timers, coils never written). */
export function lintProgram(rungs: Rung[]): string[] {
  const warnings: string[] = [];
  const written = new Set<string>();
  const timers = new Set<string>();
  for (const r of rungs) (r.kind === 'ton' ? timers : written).add(r.target);
  for (const r of rungs) {
    const refs = exprRefs(r.expr);
    for (const t of refs.timers) if (!timers.has(t)) warnings.push(`${r.id}: ${t}.Q reads a timer no TON rung defines`);
    for (const v of refs.vars)
      if (!isInput(v) && !written.has(v)) warnings.push(`${r.id}: ${v} is never written (always 0)`);
  }
  return warnings;
}
