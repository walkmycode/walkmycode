# Lecture Hall's debugger: runs the student's code once, recording every line
# it executes with the variables at that moment, so the page can step
# forwards and backwards through the run afterwards (like Python Tutor).
#
# Shared by both engines: the page's MicroPython (which cannot see a
# function's local variables, so "locals" is None there) and the laptop's
# CPython. Written to run on both.
import sys

try:
    import json
except ImportError:  # pragma: no cover
    import ujson as json

FILENAME = "your_code.py"
# MicroPython's tracer does not pass a function's return value.
_LH_RETURNS = sys.implementation.name != "micropython"


class _LhStop(Exception):
    pass


def _lh_repr(v):
    try:
        s = repr(v)
    except Exception:
        s = "<?>"
    return s if len(s) <= 300 else s[:297] + "..."


def _lh_snap(d):
    out = {}
    for k in d:
        if k.startswith("__") or k == "print":
            continue
        v = d[k]
        t = type(v).__name__
        if t in ("function", "module", "type", "builtin_function_or_method", "bound_method", "generator"):
            continue  # definitions, not data
        out[k] = [_lh_repr(v), t]
    return out


def _lh_error(e):
    try:
        import traceback

        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == FILENAME]
        lines = ["Traceback (most recent call last):"] if frames else []
        lines += [l.rstrip("\n") for l in traceback.format_list(frames)]
        lines += [l.rstrip("\n") for l in traceback.format_exception_only(type(e), e)]
        return "\n".join(lines)
    except ImportError:
        import io

        buf = io.StringIO()
        sys.print_exception(e, buf)
        # Keep only the student's own lines, not the debugger's.
        lines = [l for l in buf.getvalue().strip().split("\n") if "<stdin>" not in l]
        return "\n".join(lines)


def _lh_debug(src, max_steps=2000):
    out = []
    size = [0]
    steps = []
    stack = []
    g = {"__name__": "__main__"}

    def _print(*args, sep=" ", end="\n", file=None, flush=False):
        s = sep.join([str(a) for a in args]) + end
        out.append(s)
        size[0] += len(s)

    g["print"] = _print

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return None
        if len(steps) >= max_steps:
            raise _LhStop()
        name = frame.f_code.co_name
        if event == "call":
            stack.append(name)
            return tracer
        try:
            loc = _lh_snap(frame.f_locals) if name != "<module>" else None
        except AttributeError:
            loc = None
        steps.append({
            "event": event,
            "line": frame.f_lineno,
            "stack": list(stack) or ["<module>"],
            "locals": loc,
            "globals": _lh_snap(g),
            "out": size[0],
            "ret": _lh_repr(arg) if _LH_RETURNS and event == "return" and name != "<module>" else None,
        })
        if event == "return" and stack:
            stack.pop()
        return tracer

    error = None
    truncated = False
    try:
        code = compile(src, FILENAME, "exec")
        sys.settrace(tracer)
        try:
            exec(code, g)
        finally:
            sys.settrace(None)
    except _LhStop:
        truncated = True
    except BaseException as e:
        error = _lh_error(e)
    return {"steps": steps, "output": "".join(out), "error": error, "truncated": truncated, "maxSteps": max_steps}
