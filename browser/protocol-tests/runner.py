import io
import logging
from pathlib import Path
import platform
import sys
import unittest
from importlib.metadata import version
import nbxmpp
from .async_checks import run_checks


def suite_report(directory, root):
    suite = unittest.defaultTestLoader.discover(str(directory), top_level_dir=str(root))
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    return {"tests": result.testsRun, "failures": len(result.failures),
            "errors": len(result.errors), "skipped": len(result.skipped),
            "passed": result.wasSuccessful() and not result.skipped,
            "output": output.getvalue()}


async def run():
    logging.disable(logging.CRITICAL)
    root = Path(__file__).resolve().parent.parent
    upstream = suite_report(root / "test/unit", root)
    added = suite_report(root / "browser_protocol_tests", root)
    timers = await run_checks() if upstream["passed"] and added["passed"] else {"passed": False, "checks": []}
    return {"passed": upstream["passed"] and added["passed"] and timers["passed"],
            "platform": sys.platform, "python": platform.python_version(),
            "nbxmpp": nbxmpp.__version__, "idna": version("idna"),
            "precis_i18n": version("precis-i18n"), "omemo_dr": version("omemo-dr"),
            "upstream": upstream, "browser_adaptation": added, "async_integration": timers,
            "network": "Disabled in this increment; no socket, sign-in or contact messaging"}
