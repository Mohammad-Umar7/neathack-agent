"""Cell 01, the infeed conveyor: the operating rules (what the agent is told), the program it is
handed, and the test suites. The seeded faults are deliberately not labelled anywhere the agent can
see; the hidden manifest used for scoring lives in agent/plc/hidden.py."""

from __future__ import annotations

import random

from .lang import parse_program

SPEC = [
    {"id": "S1", "title": "E-stop stops the belt", "kind": "safety", "method": "proof",
     "text": "While the E-stop (ESTOP) is pressed, MOTOR must be off in the same scan."},
    {"id": "S2", "title": "Open guard stops the belt", "kind": "safety", "method": "proof",
     "text": "While the guard door is open (GUARD_CLOSED = 0), MOTOR must be off."},
    {"id": "S3", "title": "STOP dominates", "kind": "safety", "method": "proof",
     "text": "While STOP is pressed, MOTOR must be off, even if START is pressed in the same scan."},
    {"id": "S4", "title": "No automatic restart", "kind": "safety", "method": "proof",
     "text": "After any stop (STOP, E-stop, guard opened, or a fault shown on LAMP_RED) the belt may only "
             "run again after a new START press (rising edge). Pausing for a box at the pick position is "
             "not a stop: the belt resumes by itself once the robot has picked the box."},
    {"id": "S5", "title": "E-stop needs a reset", "kind": "safety", "method": "proof",
     "text": "Once the E-stop has been pressed, LAMP_RED must stay on and MOTOR off until the E-stop is "
             "released AND RESET is pressed (rising edge). A RESET press while the E-stop is still pressed does not count."},
    {"id": "S6", "title": "Stop at the pick position", "kind": "safety", "method": "proof",
     "text": "While PE_END sees a box (the pick position), MOTOR must be off in the same scan, or the box is "
             "pushed off the end of the belt (the end is 0.4 m past the point where PE_END first sees a box, "
             "which is 0.8 s at belt speed)."},
    {"id": "S7", "title": "Jam supervision", "kind": "safety", "method": "simulation",
     "text": "If PE_IN stays blocked for 3.0 s while MOTOR runs (a jam, or a stuck sensor), the conveyor must "
             "stop, latch a fault shown on LAMP_RED, and stay stopped until PE_IN is clear and RESET is pressed, "
             "then START. Checked in simulation: MOTOR and PE_IN on together for more than 3.5 s is a violation."},
    {"id": "F1", "title": "START runs the belt", "kind": "functional", "method": "simulation",
     "text": "With the guard closed, no E-stop and no fault, a START press runs MOTOR immediately."},
    {"id": "F2", "title": "Deliver and resume", "kind": "functional", "method": "simulation",
     "text": "Boxes travel to the pick position and wait there with LAMP_AMBER on; after the robot picks a box "
             "the belt resumes without a new START."},
    {"id": "F3", "title": "No false jam alarms", "kind": "functional", "method": "simulation",
     "text": "A box waiting at the infeed while the belt is stopped is normal and must never raise a fault."},
    {"id": "F4", "title": "Lamps", "kind": "functional", "method": "simulation",
     "text": "LAMP_GREEN = belt running; LAMP_AMBER = in run mode but paused for a box at the pick position; "
             "LAMP_RED = E-stop latched or fault."},
]

SIGNALS_DOC = """Inputs: START, STOP, RESET (momentary push buttons, 1 while pressed), ESTOP (1 while the mushroom
button is pressed in), GUARD_CLOSED (1 when the interlocked guard door is closed), PE_IN (photo-eye at the
infeed, 1 when a box is in front of it), PE_END (photo-eye at the pick position).
Outputs: MOTOR (belt drive), LAMP_GREEN, LAMP_AMBER, LAMP_RED (stack light).
Plant: the belt is 4.0 m long and moves at 0.5 m/s while MOTOR = 1. Boxes are 0.4 m long, placed at the
infeed (x = 0.2 m). PE_IN sits at x = 0.3 m, PE_END at x = 3.7 m. A robot picks boxes waiting at PE_END.
The PLC scans every 0.1 s."""

LANGUAGE_DOC = """Each rung is one statement; rungs run top to bottom every 0.1 s scan.
  COIL = expr                  assign (every scan)
  SET COIL WHEN expr           latch on
  RESET COIL WHEN expr         latch off
  TON T_NAME(expr, 3.0s)       on-delay timer; T_NAME.Q is 1 once expr has been 1 for the preset time
expr uses NOT, AND, OR, parentheses, TRUE/FALSE, signal names, T_NAME.Q and RISE(X) (1 for the scan in
which X goes from 0 to 1). A coil read before the rung that writes it holds its value from the previous
scan. Inputs cannot be written. Limits: 24 rungs, 12 internal coils, 4 timers, presets 0.1-10 s,
12 contacts per rung."""

BASELINE_SOURCE = """
R01  SET ESTOP_LATCH WHEN ESTOP                 # remember an E-stop
R02  RESET ESTOP_LATCH WHEN NOT ESTOP
R03  TON T_JAM(PE_IN AND NOT MOTOR, 3.0s)       # jam supervision timer
R04  SET FAULT WHEN T_JAM.Q
R05  RESET FAULT WHEN RISE(RESET) AND NOT PE_IN
R06  RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT    # run mode, sealed in
R07  TON T_END(PE_END, 1.2s)                    # box at the pick position (debounced)
R08  MOTOR = RUN AND GUARD_CLOSED AND NOT T_END.Q
R09  LAMP_GREEN = MOTOR
R10  LAMP_AMBER = RUN AND NOT MOTOR
R11  LAMP_RED = ESTOP_LATCH OR FAULT
"""


def baseline_program() -> list[dict]:
    return parse_program(BASELINE_SOURCE)


# ---------------------------------------------------------------- tests
# A test is a scenario plus expectations: {"t": time, "sig": name, "val": 0/1} checked on the frame at
# that time, "min_picked": boxes the robot must have picked, and no safety violations (S1-S7, DROP).

def _press(t, name, d=0.3):
    return {"t": t, "kind": "press", "input": name, "duration": d}


def _set(t, name, v):
    return {"t": t, "kind": "set", "input": name, "value": v}


def _test(tid, title, desc, duration, events, expect, options=None, min_picked=0):
    return {"id": tid, "title": title, "description": desc, "duration": duration, "events": events,
            "options": options or {}, "expect": expect, "min_picked": min_picked}


VISIBLE_TESTS = [
    _test("V01", "Deliver one box", "START, place a box, the robot picks it, the belt keeps running.", 14,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}],
          [{"t": 1.5, "sig": "MOTOR", "val": 1}, {"t": 8.0, "sig": "LAMP_AMBER", "val": 1}, {"t": 12.0, "sig": "MOTOR", "val": 1}],
          {"autopick_after": 1.0}, min_picked=1),
    _test("V02", "STOP and restart", "STOP stops the belt; START runs it again.", 7,
          [_press(0.5, "START"), _press(3.0, "STOP"), _press(5.0, "START")],
          [{"t": 4.0, "sig": "MOTOR", "val": 0}, {"t": 6.0, "sig": "MOTOR", "val": 1}]),
    _test("V03", "E-stop, then START without RESET", "After an E-stop is released, START alone must not run the belt; RESET then START must.", 8,
          [_press(0.5, "START"), _set(2.0, "ESTOP", 1), _set(3.0, "ESTOP", 0), _press(4.0, "START"), _press(5.0, "RESET"), _press(6.0, "START")],
          [{"t": 2.5, "sig": "MOTOR", "val": 0}, {"t": 3.5, "sig": "LAMP_RED", "val": 1}, {"t": 4.5, "sig": "MOTOR", "val": 0},
           {"t": 5.5, "sig": "LAMP_RED", "val": 0}, {"t": 6.5, "sig": "MOTOR", "val": 1}]),
    _test("V04", "Guard door opened and closed", "Opening the guard stops the belt; closing it must not restart it until START.", 7,
          [_press(0.5, "START"), _set(2.0, "GUARD_CLOSED", 0), _set(4.0, "GUARD_CLOSED", 1), _press(5.0, "START")],
          [{"t": 3.0, "sig": "MOTOR", "val": 0}, {"t": 4.5, "sig": "MOTOR", "val": 0}, {"t": 5.5, "sig": "MOTOR", "val": 1}]),
    _test("V05", "Box stops at the pick position", "The belt must stop with the box at PE_END and not push it off the end.", 12,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}],
          [{"t": 9.0, "sig": "PE_END", "val": 1}, {"t": 9.0, "sig": "MOTOR", "val": 0}, {"t": 9.0, "sig": "LAMP_AMBER", "val": 1}]),
    _test("V06", "Stuck infeed sensor", "PE_IN sticks on while running: the belt must stop with a fault, and recover after repair, RESET and START.", 9,
          [_press(0.5, "START"), {"t": 2.0, "kind": "stick", "sensor": "PE_IN", "value": 1},
           {"t": 7.0, "kind": "unstick", "sensor": "PE_IN"}, _press(7.5, "RESET"), _press(8.0, "START")],
          [{"t": 6.0, "sig": "MOTOR", "val": 0}, {"t": 6.0, "sig": "LAMP_RED", "val": 1}, {"t": 8.5, "sig": "MOTOR", "val": 1}]),
    _test("V07", "Box waiting at the infeed", "A box placed while the belt is stopped must not raise a fault; START then runs the belt.", 8,
          [{"t": 0.5, "kind": "spawn"}, _press(5.0, "START")],
          [{"t": 4.5, "sig": "LAMP_RED", "val": 0}, {"t": 5.5, "sig": "MOTOR", "val": 1}]),
    _test("V08", "START and STOP together", "STOP wins when both are pressed in the same scan.", 4,
          [_press(1.0, "START"), _press(1.0, "STOP"), _press(2.0, "START")],
          [{"t": 1.1, "sig": "MOTOR", "val": 0}, {"t": 2.5, "sig": "MOTOR", "val": 1}]),
]

HELDOUT_TESTS = [
    _test("H01", "RESET while the E-stop is held", "A RESET press while the E-stop is still pressed must not clear it.", 7,
          [_press(0.5, "START"), _set(2.0, "ESTOP", 1), _press(3.0, "RESET"), _set(4.0, "ESTOP", 0), _press(5.0, "START")],
          [{"t": 4.5, "sig": "LAMP_RED", "val": 1}, {"t": 5.5, "sig": "MOTOR", "val": 0}]),
    _test("H02", "E-stop, release, RESET, START", "The normal E-stop recovery sequence works.", 6,
          [_press(0.5, "START"), _set(2.0, "ESTOP", 1), _set(3.0, "ESTOP", 0), _press(3.5, "RESET"), _press(4.5, "START")],
          [{"t": 3.2, "sig": "LAMP_RED", "val": 1}, {"t": 4.0, "sig": "LAMP_RED", "val": 0}, {"t": 5.0, "sig": "MOTOR", "val": 1}]),
    _test("H03", "Guard opened while paused at the pick position", "After the guard is opened during a pause, the belt must not resume after the pick until START.", 16,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}, _set(9.0, "GUARD_CLOSED", 0), _set(10.0, "GUARD_CLOSED", 1),
           {"t": 11.0, "kind": "pick"}, _press(13.0, "START")],
          [{"t": 12.0, "sig": "MOTOR", "val": 0}, {"t": 13.5, "sig": "MOTOR", "val": 1}]),
    _test("H04", "START held while the guard closes", "Holding START while the guard closes is not a new START press.", 7,
          [_set(1.0, "GUARD_CLOSED", 0), _press(1.5, "START", 4.0), _set(3.0, "GUARD_CLOSED", 1), _press(6.0, "START")],
          [{"t": 4.0, "sig": "MOTOR", "val": 0}, {"t": 6.5, "sig": "MOTOR", "val": 1}]),
    _test("H05", "Boxes accumulate at the end", "Several boxes queue up; none may be pushed off the end.", 24,
          [_press(0.5, "START")], [{"t": 23.0, "sig": "MOTOR", "val": 0}], {"autofeed_every": 3.0}),
    _test("H06", "One minute of production", "Continuous feeding and picking for 60 s without any violation.", 60,
          [_press(0.5, "START")], [{"t": 59.0, "sig": "LAMP_RED", "val": 0}], {"autofeed_every": 4.0, "autopick_after": 1.5}, min_picked=6),
    _test("H07", "Sensor stuck before START", "PE_IN is stuck on when the operator starts: the jam must still be detected.", 8,
          [{"t": 0.2, "kind": "stick", "sensor": "PE_IN", "value": 1}, _press(1.0, "START")],
          [{"t": 5.0, "sig": "MOTOR", "val": 0}, {"t": 5.0, "sig": "LAMP_RED", "val": 1}]),
    _test("H08", "RESET with the sensor still stuck", "RESET must not clear a jam fault while PE_IN is still blocked.", 12,
          [_press(0.5, "START"), {"t": 1.0, "kind": "stick", "sensor": "PE_IN", "value": 1}, _press(6.0, "RESET"), _press(6.5, "START"),
           {"t": 8.0, "kind": "unstick", "sensor": "PE_IN"}, _press(9.0, "RESET"), _press(10.0, "START")],
          [{"t": 7.0, "sig": "MOTOR", "val": 0}, {"t": 7.0, "sig": "LAMP_RED", "val": 1}, {"t": 10.5, "sig": "MOTOR", "val": 1}]),
    _test("H09", "PE_END stuck on", "A stuck pick-position sensor must hold the belt stopped (fail safe).", 6,
          [_press(0.5, "START"), {"t": 2.0, "kind": "stick", "sensor": "PE_END", "value": 1}],
          [{"t": 1.5, "sig": "MOTOR", "val": 1}, {"t": 2.1, "sig": "MOTOR", "val": 0}]),
    _test("H10", "Rapid START/STOP", "The operator toggles quickly; every STOP must hold.", 6,
          [_press(0.5, "START"), _press(1.0, "STOP"), _press(1.5, "START"), _press(2.0, "STOP"), _press(2.5, "START"), _press(4.0, "STOP")],
          [{"t": 1.1, "sig": "MOTOR", "val": 0}, {"t": 1.8, "sig": "MOTOR", "val": 1}, {"t": 4.1, "sig": "MOTOR", "val": 0}, {"t": 5.5, "sig": "MOTOR", "val": 0}]),
    _test("H11", "E-stop while a box waits", "E-stop during a pause, released, box picked: the belt must stay stopped until RESET and START.", 18,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}, _set(9.0, "ESTOP", 1), _set(10.0, "ESTOP", 0), {"t": 11.0, "kind": "pick"},
           _press(14.0, "RESET"), _press(15.0, "START")],
          [{"t": 10.5, "sig": "LAMP_RED", "val": 1}, {"t": 12.0, "sig": "MOTOR", "val": 0}, {"t": 15.5, "sig": "MOTOR", "val": 1}]),
    _test("H12", "RESET during normal running", "A RESET press with nothing to reset changes nothing.", 4,
          [_press(0.5, "START"), _press(2.0, "RESET")], [{"t": 2.5, "sig": "MOTOR", "val": 1}, {"t": 2.5, "sig": "LAMP_RED", "val": 0}]),
    _test("H13", "STOP while paused", "STOP during a pause ends run mode: the belt stays stopped after the pick until START.", 16,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}, _press(9.0, "STOP"), {"t": 10.0, "kind": "pick"}, _press(13.0, "START")],
          [{"t": 12.0, "sig": "MOTOR", "val": 0}, {"t": 13.5, "sig": "MOTOR", "val": 1}]),
    _test("H14", "Long wait at the infeed, then production", "A box waits 10 s at the infeed, then production runs normally.", 30,
          [{"t": 0.5, "kind": "spawn"}, _press(10.5, "START")], [{"t": 11.0, "sig": "MOTOR", "val": 1}, {"t": 29.0, "sig": "LAMP_RED", "val": 0}],
          {"autopick_after": 1.0}, min_picked=1),
    _test("H15", "Guard opened near the end", "The guard opens while a box approaches the end; after START it still stops at the pick position.", 16,
          [_press(0.5, "START"), {"t": 1.0, "kind": "spawn"}, _set(6.5, "GUARD_CLOSED", 0), _set(7.5, "GUARD_CLOSED", 1), _press(8.5, "START")],
          [{"t": 8.0, "sig": "MOTOR", "val": 0}, {"t": 14.0, "sig": "PE_END", "val": 1}, {"t": 14.0, "sig": "MOTOR", "val": 0}]),
    _test("H16", "Jam, then E-stop, then full recovery", "Jam fault and an E-stop together, recovered in order.", 16,
          [_press(0.5, "START"), {"t": 1.0, "kind": "stick", "sensor": "PE_IN", "value": 1}, _set(6.0, "ESTOP", 1), {"t": 7.0, "kind": "unstick", "sensor": "PE_IN"},
           _set(8.0, "ESTOP", 0), _press(9.0, "START"), _press(10.0, "RESET"), _press(11.0, "START")],
          [{"t": 9.5, "sig": "MOTOR", "val": 0}, {"t": 9.5, "sig": "LAMP_RED", "val": 1}, {"t": 11.5, "sig": "MOTOR", "val": 1}]),
]


def fuzz_scenarios(seed: int, n: int, duration: float = 30.0) -> list[dict]:
    """Random operator and plant behaviour, for checking the safety rules beyond the scripted tests."""
    rng = random.Random(seed)
    out = []
    for i in range(n):
        t, events = 0.5, []
        estop = 0
        guard = 1
        while t < duration - 1:
            r = rng.random()
            if r < 0.30:
                events.append(_press(round(t, 1), "START"))
            elif r < 0.40:
                events.append(_press(round(t, 1), "STOP"))
            elif r < 0.50:
                events.append(_press(round(t, 1), "RESET"))
            elif r < 0.58:
                estop = 1 - estop
                events.append(_set(round(t, 1), "ESTOP", estop))
            elif r < 0.66:
                guard = 1 - guard
                events.append(_set(round(t, 1), "GUARD_CLOSED", guard))
            elif r < 0.80:
                events.append({"t": round(t, 1), "kind": "spawn"})
            elif r < 0.90:
                events.append({"t": round(t, 1), "kind": "pick"})
            elif r < 0.95:
                events.append({"t": round(t, 1), "kind": "stick", "sensor": rng.choice(["PE_IN", "PE_END"]), "value": 1})
            else:
                events.append({"t": round(t, 1), "kind": "unstick", "sensor": rng.choice(["PE_IN", "PE_END"])})
            t += rng.choice([0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0])
        out.append({"id": f"FZ{seed}-{i:03d}", "title": "random", "description": "", "duration": duration, "events": events,
                    "options": {"autopick_after": rng.choice([1.0, 2.0])} if rng.random() < 0.5 else {}})
    return out
