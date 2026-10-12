"""Scoring-only data. Never shown to the agent: the seeded fault labels and a reference repair
(used by our own tests to check the verifier, not as the expected answer — any program that passes
the held-out suite and the proofs counts as repaired)."""

from .lang import parse_program

FAULTS = [
    {"id": "missing-reset", "title": "Missing E-stop reset", "rung": "R02",
     "detail": "The E-stop latch clears itself when the button is released, so no RESET is needed.",
     "tests": ["V03", "H01", "H02", "H11", "H16"], "rule": "S5"},
    {"id": "timing-race", "title": "Timing race at the pick position", "rung": "R07",
     "detail": "PE_END is debounced for 1.2 s, but the box reaches the end of the belt 0.8 s after PE_END sees it.",
     "tests": ["V01", "V05", "H05", "H06", "H09", "H15"], "rule": "S6"},
    {"id": "stuck-sensor", "title": "Unsupervised stuck sensor", "rung": "R03",
     "detail": "The jam timer runs while the motor is OFF instead of ON: a stuck PE_IN is never detected, and a waiting box raises a false fault.",
     "tests": ["V06", "V07", "H07", "H08", "H14", "H16"], "rule": "S7"},
    {"id": "auto-restart", "title": "Restart after the guard closes", "rung": "R06",
     "detail": "Opening the guard stops the motor but does not drop run mode, so closing the guard restarts the belt by itself.",
     "tests": ["V04", "H03", "H04", "H15"], "rule": "S4"},
]

REFERENCE_SOURCE = """
R01  SET ESTOP_LATCH WHEN ESTOP
R02  RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET)
R03  TON T_JAM(PE_IN AND MOTOR, 3.0s)
R04  SET FAULT WHEN T_JAM.Q
R05  RESET FAULT WHEN RISE(RESET) AND NOT PE_IN
R06  RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT AND GUARD_CLOSED
R08  MOTOR = RUN AND GUARD_CLOSED AND NOT PE_END
R09  LAMP_GREEN = MOTOR
R10  LAMP_AMBER = RUN AND NOT MOTOR
R11  LAMP_RED = ESTOP_LATCH OR FAULT
"""


def reference_program():
    return parse_program(REFERENCE_SOURCE)
