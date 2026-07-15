from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import CustomerLedger, LedgerEntryTypeEnum
from app.models.transaction import SalesTransaction
from app.schemas.customer import CustomerBalanceEntryResponse


async def _get_outstanding_entries(
    db: AsyncSession,
    customer_id: int,
    added_type: LedgerEntryTypeEnum,
    consumed_types: tuple[LedgerEntryTypeEnum, ...],
) -> list[CustomerBalanceEntryResponse]:
    # customer_ledger has no column linking a consuming row (balance_settled /
    # credit_used / credit_auto_used) back to the specific *_added row(s) it
    # paid off, so "already consumed" is computed rather than stored: walk the
    # *_added rows oldest-first and consume them against the running total of
    # consuming-entry amounts (consumption always applies to the oldest
    # outstanding entry first, and can never exceed what's outstanding at the
    # time — enforced in process_payment) — whatever's left over is what's
    # still actually outstanding on that entry.
    stmt = (
        select(CustomerLedger, SalesTransaction.order_number)
        .join(SalesTransaction, CustomerLedger.transaction_id == SalesTransaction.id)
        .where(
            CustomerLedger.customer_id == customer_id,
            CustomerLedger.entry_type.in_([added_type, *consumed_types]),
        )
        .order_by(CustomerLedger.created_at.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    remaining_consumed = sum(
        (entry.amount for entry, _ in rows if entry.entry_type in consumed_types),
        Decimal("0"),
    )

    entries = []
    for entry, order_number in rows:
        if entry.entry_type != added_type:
            continue
        if remaining_consumed >= entry.amount:
            remaining_consumed -= entry.amount
            continue
        outstanding = entry.amount - remaining_consumed
        remaining_consumed = Decimal("0")
        entries.append(
            CustomerBalanceEntryResponse(
                ledger_entry_id=entry.id,
                transaction_id=entry.transaction_id,
                order_number=order_number,
                amount=outstanding,
                created_at=entry.created_at,
            )
        )
    return entries


async def get_outstanding_balance_entries(db: AsyncSession, customer_id: int) -> list[CustomerBalanceEntryResponse]:
    return await _get_outstanding_entries(
        db, customer_id, LedgerEntryTypeEnum.balance_added, (LedgerEntryTypeEnum.balance_settled,)
    )


async def get_outstanding_credit_entries(db: AsyncSession, customer_id: int) -> list[CustomerBalanceEntryResponse]:
    return await _get_outstanding_entries(
        db,
        customer_id,
        LedgerEntryTypeEnum.credit_added,
        (LedgerEntryTypeEnum.credit_used, LedgerEntryTypeEnum.credit_auto_used),
    )


async def get_outstanding_balance_total(db: AsyncSession, customer_id: int) -> Decimal:
    entries = await get_outstanding_balance_entries(db, customer_id)
    return sum((e.amount for e in entries), Decimal("0"))


async def get_credit_breakdown_for_entries(
    db: AsyncSession, customer_id: int, ledger_entry_ids: list[int]
) -> list[dict]:
    """Full remaining amount for each explicitly checked credit_added entry, in the
    order given. Payment now checks specific entries directly (like the balance
    checkboxes) instead of typing a target amount for the system to break down FIFO —
    so this looks each checked id up by identity rather than walking oldest-first."""
    if not ledger_entry_ids:
        return []
    entries_by_id = {e.ledger_entry_id: e for e in await get_outstanding_credit_entries(db, customer_id)}
    breakdown = []
    for ledger_entry_id in ledger_entry_ids:
        entry = entries_by_id.get(ledger_entry_id)
        if entry is None:
            raise ValueError(f"credit ledger entry {ledger_entry_id} is not outstanding for this customer")
        breakdown.append(
            {
                "source_transaction_id": entry.transaction_id,
                "order_number": entry.order_number,
                "ledger_entry_id": entry.ledger_entry_id,
                "amount": entry.amount,
            }
        )
    return breakdown
