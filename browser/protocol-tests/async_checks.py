"""Run on the actual current loop; do not replace Pyodide's browser WebLoop."""

import asyncio
import logging
from unittest.mock import Mock
from nbxmpp.client import Client
from nbxmpp.const import StreamState
from nbxmpp.errors import CancelledError, TimeoutStanzaError
from nbxmpp.protocol import Iq
from nbxmpp.task import IqRequestTask
from gajim_browser import nbxmpp_scheduler
from gajim_browser.nbxmpp_scheduler import TimerScheduler
from gajim_browser.nbxmpp_values import UnsupportedPlatformOperation


async def run_checks():
    checks = []
    loop = asyncio.get_running_loop()
    s = TimerScheduler()
    done = asyncio.Event()
    calls = []
    try:
        def once(value):
            calls.append(value)
            done.set()
        s.timeout_add_seconds(0, once, "once")
        assert not calls
        await asyncio.wait_for(done.wait(), 2)
        assert calls == ["once"] and s.pending == 0
        checks.append({"name": "timer callback runs asynchronously and is removed after one shot", "passed": True})

        first = s.timeout_add_seconds(0, calls.append, "cancelled")
        assert s.source_remove(first)
        done.clear()
        second = s.timeout_add_seconds(0, once, "later")
        assert second > first and not s.source_remove(first)
        await asyncio.wait_for(done.wait(), 2)
        assert calls == ["once", "later"]
        checks.append({"name": "cancellation prevents callbacks and stale IDs do not cancel later work", "passed": True})

        done.clear()
        repeats = []
        def repeat():
            repeats.append(True)
            if len(repeats) == 3:
                s.source_remove(repeating_id)
                done.set()
            return True
        repeating_id = s.timeout_add_seconds(0, repeat)
        await asyncio.wait_for(done.wait(), 2)
        await asyncio.sleep(.01)
        assert len(repeats) == 3 and s.pending == 0
        checks.append({"name": "repeating callback can cancel itself without being revived", "passed": True})

        errors = []
        prior_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: errors.append(context))
        try:
            def bad():
                raise ValueError("synthetic secret must not enter diagnostics")
            s.timeout_add_seconds(0, bad)
            await asyncio.sleep(.01)
            assert s.pending == 0 and len(errors) == 1
            assert "synthetic secret" not in repr(errors) and "exception" not in errors[0]
        finally:
            loop.set_exception_handler(prior_handler)
        checks.append({"name": "failing callback is removed with redacted diagnostics", "passed": True})

        s.timeout_add_seconds(0, calls.append, "closed")
        s.close()
        await asyncio.sleep(.01)
        assert "closed" not in calls and s.pending == 0
        try:
            s.timeout_add_seconds(0, once, "invalid")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Closed scheduler accepted new work")
        checks.append({"name": "scheduler disposal cancels outstanding callbacks", "passed": True})
    finally:
        s.close()

    baseline = nbxmpp_scheduler.pending_count()
    client = Client("synthetic-offline")
    try:
        assert nbxmpp_scheduler.pending_count() == baseline + 1
        assert client.state == StreamState.DISCONNECTED
        try:
            client.connect()
        except UnsupportedPlatformOperation:
            pass
        else:
            raise AssertionError("Offline core unexpectedly connected")
        assert client.state == StreamState.DISCONNECTED
    finally:
        client.destroy()
    assert nbxmpp_scheduler.pending_count() == baseline
    checks.append({"name": "actual client initializes and disposes timers while networking fails before state changes", "passed": True})

    for cancel in (False, True):
        done = asyncio.Event()
        observed = []
        transport = Mock()  # A synthetic IQ boundary, not a replacement protocol implementation.
        transport.send_stanza.return_value = "synthetic-iq"
        def request():
            yield
            yield Iq(typ="get", to="example.invalid")
        task = IqRequestTask(request(), logging.getLogger("synthetic-iq"), transport)
        def finished(t):
            observed.append(type(t.get_result()))
            done.set()
        task.add_done_callback(finished, weak=False)
        task.set_timeout(1 if cancel else 0)
        task.start()
        if cancel:
            callback = transport.send_stanza.call_args.kwargs["callback"]
            task.cancel()
            callback(transport, Iq(typ="result"))
        await asyncio.wait_for(done.wait(), 2)
        assert observed == [CancelledError if cancel else TimeoutStanzaError]
        transport._dispatcher.remove_iq_callback.assert_called_once_with("synthetic-iq")
        assert nbxmpp_scheduler.pending_count() == baseline
        checks.append({"name": "actual IQ task cancellation ignores late replies" if cancel else "actual IQ task timeout finalizes and removes pending callbacks", "passed": True})
    return {"passed": True, "checks": checks, "remaining_timers": nbxmpp_scheduler.pending_count() - baseline}
