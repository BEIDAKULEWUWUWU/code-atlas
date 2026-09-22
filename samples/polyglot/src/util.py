"""Small helpers shared by the report generator."""
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class Report:
    title: str
    rows: list = field(default_factory=list)

    def total(self) -> int:
        return sum(len(row) for row in self.rows)

    def render(self) -> str:
        width = max((len(r) for r in self.rows), default=0)
        return "\n".join(f"{r:<{width}}" for r in self.rows)


def chunked(items: Iterable, size: int):
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch
