import asyncio
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.transaction_service import run_end_of_day_auto_void


def _seconds_until_next_run(now: datetime | None = None) -> float:
    now = now or datetime.now()
    target = now.replace(
        hour=settings.END_OF_DAY_VOID_HOUR, minute=settings.END_OF_DAY_VOID_MINUTE, second=0, microsecond=0
    )
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _run_loop() -> None:
    while True:
        delay = _seconds_until_next_run()
        next_run_at = datetime.now() + timedelta(seconds=delay)
        print(
            f"[scheduler] end-of-day auto-void: next run at {next_run_at.isoformat(timespec='seconds')}",
            flush=True,
        )
        await asyncio.sleep(delay)

        print("[scheduler] end-of-day auto-void: job starting", flush=True)
        try:
            async with AsyncSessionLocal() as db:
                voided_count = await run_end_of_day_auto_void(db)
            print(f"[scheduler] end-of-day auto-void: job finished, {voided_count} transaction(s) voided", flush=True)
        except Exception as exc:
            # A failure here means something broke before/outside
            # run_end_of_day_auto_void's own per-transaction handling (e.g. the
            # eligibility query itself, or the DB being briefly unreachable) —
            # caught so the loop survives to try again the next night rather
            # than dying silently.
            print(f"[scheduler] end-of-day auto-void: job failed: {exc}", flush=True)


def start_scheduler() -> asyncio.Task:
    return asyncio.create_task(_run_loop())
