"""The moves placed by hand (static/characters/made_moves.json): where the athletes' hands, feet and
hips go, and how the chest turns, at each key moment of the moves no animation library has (the
rows marked "made here" in docs/ANIMATIONS.md). The game reads the file (static/js/athlete.js);
the moves page's editor (static/js/move_edit.js) changes it and sends it to the server to be saved.

A save is checked against the file it replaces: the same moves and parts, each value the same
shape (a number, or a place of three), key times in order, sane numbers. The editor changes
values and key moments only, never what the file holds. It's written in the file's own layout, so
an unchanged file comes out byte for byte the same, and the file it replaces is kept in
move_saves/.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime
from pathlib import Path

LIMIT = 10.0            # metres or radians: anything bigger is a mistake
BLEND = (0.0, 2.0)      # a blend's seconds
MIN_OUT = 0.01          # a blend out takes at least this long (0 would divide by zero)
MAX_BYTES = 200_000


def _num(v) -> str:
    """A number as the file writes it: at most 4 decimals, whole numbers without a point."""
    v = round(float(v), 4)
    if v == 0:
        return "0"
    if v == int(v):
        return str(int(v))
    return repr(v)


def _inline(v) -> str:
    if isinstance(v, bool) or v is None:
        raise ValueError("no true, false or null in the moves file")
    if isinstance(v, (int, float)):
        return _num(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_inline(x) for x in v) + "]"
    return "{" + ", ".join(f"{json.dumps(k)}: {_inline(x)}" for k, x in v.items()) + "}"


def _expanded_list(v) -> bool:
    """Keys (lists of lists) and text (lists of strings) take a line each."""
    return isinstance(v, list) and bool(v) and all(isinstance(x, (list, str)) for x in v)


def _expanded_dict(v) -> bool:
    return isinstance(v, dict) and any(isinstance(x, (dict, list)) for x in v.values())


def _block(v, depth: int) -> str:
    pad = "  " * (depth + 1)
    end = "  " * depth
    if _expanded_dict(v):
        items = [f"{pad}{json.dumps(k)}: {_block(x, depth + 1)}" for k, x in v.items()]
        return "{\n" + ",\n".join(items) + "\n" + end + "}"
    if _expanded_list(v):
        return "[\n" + ",\n".join(pad + _inline(x) for x in v) + "\n" + end + "]"
    return _inline(v)


def text(data: dict) -> str:
    """The file's layout: each move and part on its own lines, each key on one line."""
    return _block(data, 0) + "\n"


def _shape(v):
    """What a value is: 'number', 'place' (three numbers), 'keys' (of numbers or of places), or None."""
    if _is_num(v):
        return "number"
    if isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v):
        return "place"
    if isinstance(v, list) and v and all(isinstance(k, list) and len(k) >= 2 for k in v):
        inner = {_shape(k[1]) for k in v}
        if len(inner) == 1 and inner <= {"number", "place"}:
            return f"keys of {inner.pop()}"
    return None


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check(new, old, where: str = "") -> str | None:
    """Why `new` can't replace `old` (None: it can). Their "about" texts aren't compared: the old
    file's are kept (merge)."""
    if isinstance(old, dict):
        if not isinstance(new, dict):
            return f"{where or 'the file'}: should be a set of parts"
        want = [k for k in old if k != "about"]
        got = [k for k in new if k != "about"]
        if sorted(want) != sorted(got):
            missing = [k for k in want if k not in new]
            extra = [k for k in got if k not in old]
            return f"{where or 'the file'}: " + "; ".join(
                ([f"missing {', '.join(missing)}"] if missing else []) + ([f"unknown {', '.join(extra)}"] if extra else []))
        for k in want:
            problem = check(new[k], old[k], f"{where}.{k}" if where else k)
            if problem:
                return problem
        return None
    shape = _shape(old)
    if shape is None:               # text, or something only the file's author changes
        return None
    if _shape(new) != shape:
        return f"{where}: should be {shape}"
    if shape == "number":
        if where.split(".")[-1] in ("in", "out"):
            low = MIN_OUT if where.endswith(".out") else BLEND[0]
            if not low <= new <= BLEND[1]:
                return f"{where}: a blend of {new} s (it should be {low} to {BLEND[1]} s)"
        elif abs(new) > LIMIT:
            return f"{where}: {new} is too big"
        return None
    if shape == "place":
        return f"{where}: too big" if any(abs(x) > LIMIT for x in new) else None
    last = old[-1][0]
    times = [k[0] for k in new]
    if any(not _is_num(t) for t in times):
        return f"{where}: a key's time isn't a number"
    if times[0] < 0 or times[-1] > last + 1e-9:
        return f"{where}: key times should be from 0 to {last}"
    if any(b <= a for a, b in zip(times, times[1:])):
        return f"{where}: two keys at the same time, or out of order"
    for k in new:
        if len(k) > 3 or (len(k) == 3 and k[2] != "pass"):
            return f"{where}: a key is [time, value] or [time, value, \"pass\"]"
        values = [k[1]] if _is_num(k[1]) else k[1]
        if any(abs(x) > LIMIT for x in values):
            return f"{where}: a key's value is too big"
    return None


def merge(new: dict, old: dict) -> dict:
    """`new` with the old file's "about" texts (the editor doesn't change them), in the old's order."""
    if not isinstance(old, dict):
        return new
    return {k: (old[k] if k == "about" else merge(new[k], old[k])) for k in old}


def save(data, path: Path, saves: Path) -> tuple[dict, Path | None]:
    """Checks `data` against the file at `path`, then writes it there (in the file's layout),
    keeping the file it replaces in `saves`. Returns what was written and where the old one went
    (None if nothing changed). Raises ValueError when `data` can't be saved."""
    old_text = path.read_text(encoding="utf-8")
    old = json.loads(old_text)
    problem = check(data, old)
    if problem:
        raise ValueError(problem)
    merged = merge(data, old)
    new_text = text(merged)
    if new_text == old_text:
        return json.loads(new_text), None
    saves.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    kept = saves / f"{path.stem}_{stamp}{path.suffix}"
    n = 2
    while kept.exists():
        kept = saves / f"{path.stem}_{stamp}_{n}{path.suffix}"
        n += 1
    kept.write_text(old_text, encoding="utf-8", newline="\n")
    tmp = path.with_suffix(".saving")
    tmp.write_text(new_text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return json.loads(new_text), kept
