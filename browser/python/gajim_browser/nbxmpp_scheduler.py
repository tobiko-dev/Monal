"""nbxmpp's cancellable timer boundary on asyncio/Pyodide's browser event loop.

This provides the timer operations used by the pinned protocol core. It is not
a GLib implementation and cannot provide thread, I/O or priority semantics.
"""

import asyncio
import inspect
import itertools
import math
from collections.abc import Callable

SOURCE_CONTINUE = True
SOURCE_REMOVE = False


class TimerScheduler:
    def __init__(self):
        self._ids = itertools.count(1)
        self._sources: dict[int, asyncio.TimerHandle] = {}
        self._closed = False

    @property
    def pending(self) -> int:
        return len(self._sources)

    def timeout_add_seconds(self, interval: float, callback: Callable, *args) -> int:
        if self._closed:
            raise RuntimeError("Scheduler is closed")
        if isinstance(interval, bool) or not isinstance(interval, (int, float)):
            raise ValueError("Invalid timer interval")
        if interval < 0 or interval > 0xFFFFFFFF or not math.isfinite(interval) or not callable(callback):
            raise ValueError("Invalid timer arguments")
        loop = asyncio.get_running_loop()
        source_id = next(self._ids)

        def dispatch():
            if source_id not in self._sources:
                return
            try:
                repeat = callback(*args)
                if inspect.isawaitable(repeat):
                    if inspect.iscoroutine(repeat):
                        repeat.close()
                    raise TypeError("Timer callbacks must be synchronous")
                repeat = bool(repeat)
            except Exception:
                self.source_remove(source_id)
                # No exception values: callbacks could carry credentials/stanzas.
                loop.call_exception_handler({"message": "nbxmpp timer callback failed; source removed"})
                return
            # A callback can remove itself or close the scheduler. Do not revive it.
            if source_id not in self._sources:
                return
            if repeat:
                self._sources[source_id] = loop.call_later(interval, dispatch)
            else:
                self.source_remove(source_id)

        self._sources[source_id] = loop.call_later(interval, dispatch)
        return source_id

    def source_remove(self, source_id: int | None) -> bool:
        handle = self._sources.pop(source_id, None)
        if handle is None:
            return False
        handle.cancel()
        return True

    def close(self):
        self._closed = True
        for source_id in list(self._sources):
            self.source_remove(source_id)


_scheduler = TimerScheduler()
timeout_add_seconds = _scheduler.timeout_add_seconds
source_remove = _scheduler.source_remove


def pending_count() -> int:
    return _scheduler.pending
