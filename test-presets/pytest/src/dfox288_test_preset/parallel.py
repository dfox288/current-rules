"""Parallel runs (README, "Parallel runs"): the worker count `-n auto` resolves to."""

import os

from . import WORKERS


def auto_workers(cpus: int | None = None) -> int:
    """One worker per core that this process may use, but at least `WORKERS[0]` and at most `WORKERS[1]`.

    A worker waits on the database (commits, checkpoints) as much as it computes, so a runner with 2 cores still
    gains from 4; past 6 the workers only queue on the server."""
    low, high = WORKERS
    cpus = cpus or os.process_cpu_count() or 1
    return min(high, max(low, cpus))
