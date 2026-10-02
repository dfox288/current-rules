"""The count guard's data: what a run ran, per tier, written for the gate script."""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

SUMMARY_ENV = "TEST_PRESET_SUMMARY"


def tier_of(markers: set[str]) -> str:
    if "large" in markers:
        return "large"
    if "medium" in markers:
        return "medium"
    return "small"


@dataclass
class Summary:
    files: set[str] = field(default_factory=set)
    tiers: dict[str, dict[str, set[str] | int]] = field(
        default_factory=lambda: {t: {"files": set(), "tests": 0} for t in ("small", "medium", "large")}
    )
    tests: int = 0
    skipped: int = 0
    quarantined: int = 0
    failed: int = 0

    def add_ran(self, nodeid: str, tier: str, failed: bool) -> None:
        file = nodeid.split("::", 1)[0]
        self.files.add(file)
        self.tiers[tier]["files"].add(file)  # type: ignore[union-attr]
        self.tiers[tier]["tests"] += 1  # type: ignore[operator]
        self.tests += 1
        if failed:
            self.failed += 1

    def as_json(self) -> dict:
        return {
            "files": len(self.files),
            "tests": self.tests,
            "skipped": self.skipped,
            "quarantined": self.quarantined,
            "failed": self.failed,
            "flaky": [],  # no retries in pytest: a test is never flaky here
            "retriedBeyondRules": [],
            "tiers": {
                t: {"files": len(v["files"]), "tests": v["tests"]}  # type: ignore[arg-type]
                for t, v in self.tiers.items()
            },
        }

    def line(self) -> str:
        t = self.tiers
        return (
            f"[test-preset] ran {len(self.files)} files, {self.tests} tests "
            f"(small {t['small']['tests']}, medium {t['medium']['tests']}, large {t['large']['tests']}); "
            f"skipped {self.skipped}, quarantined {self.quarantined}, flaky 0"
        )

    def write(self) -> None:
        path = os.environ.get(SUMMARY_ENV)
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(json.dumps(self.as_json(), indent=2))
