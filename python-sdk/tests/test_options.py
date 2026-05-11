from __future__ import annotations

import pytest

from arguslog import ArguslogOptions


def test_defaults() -> None:
    opts = ArguslogOptions(dsn="arguslog://k@localhost/api/1")
    assert opts.sample_rate == 1.0
    assert opts.max_queue_size == 256
    assert opts.scrubbing_enabled is True


def test_dsn_required() -> None:
    with pytest.raises(ValueError):
        ArguslogOptions(dsn="")


@pytest.mark.parametrize("rate", [-0.1, 1.1, 2.0])
def test_sample_rate_bounds(rate: float) -> None:
    with pytest.raises(ValueError):
        ArguslogOptions(dsn="arguslog://k@localhost/api/1", sample_rate=rate)


def test_max_queue_size_must_be_positive() -> None:
    with pytest.raises(ValueError):
        ArguslogOptions(dsn="arguslog://k@localhost/api/1", max_queue_size=0)
