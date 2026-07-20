from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import CustomerLedger, LedgerEntryTypeEnum
from app.models.transaction import SalesTransaction
from app.schemas.customer import CustomerBalanceEntryResponse, CustomerLedgerCategoryEntryResponse

# balance_added/credit_added increase what's outstanding; balance_settled and
# credit_used/credit_auto_used pay it back down — same bucket/sign convention
# as computeLedgerTotals in CustomerDetailPanel.jsx (the existing correct
# source for these totals), just computed backend-side.
_LEDGER_ENTRY_SIGN: dict[LedgerEntryTypeEnum, tuple[str, int]] = {
    LedgerEntryTypeEnum.balance_added: ("balance", 1),
    LedgerEntryTypeEnum.balance_settled: ("balance", -1),
    LedgerEntryTypeEnum.credit_added: ("credit", 1),
    LedgerEntryTypeEnum.credit_used: ("credit", -1),
    LedgerEntryTypeEnum.credit_auto_used: ("credit", -1),
}


def compute_ledger_totals(ledger_entries: list[CustomerLedger]) -> tuple[Decimal, Decimal]:
    """Independently computed gross totals (not derived from customer.net_balance),
    so a customer can show nonzero balance AND credit at the same time. Floored at
    0 — total_credit - total_balance equals customer.net_balance before flooring."""
    total_balance = Decimal("0")
    total_credit = Decimal("0")
    for entry in ledger_entries:
        rule = _LEDGER_ENTRY_SIGN.get(entry.entry_type)
        if rule is None:
            continue
        bucket, sign = rule
        signed_amount = entry.amount * sign
        if bucket == "balance":
            total_balance += signed_amount
        else:
            total_credit += signed_amount
    return max(total_balance, Decimal("0")), max(total_credit, Decimal("0"))


_LEDGER_CATEGORY_TYPES: dict[str, tuple[LedgerEntryTypeEnum, ...]] = {
    "balance": (LedgerEntryTypeEnum.balance_added, LedgerEntryTypeEnum.balance_settled),
    "credit": (LedgerEntryTypeEnum.credit_added, LedgerEntryTypeEnum.credit_used, LedgerEntryTypeEnum.credit_auto_used),
}

# Display sign for the per-entry ledger history (Admin Customer Details modal).
# credit_auto_used is a consumption — same direction as credit_used, per the
# schema.sql comment ("system auto-deducted credit to cover balance at
# releasing") and the same grouping get_outstanding_credit_entries already
# uses below — so it stays negative here too, consistent with _LEDGER_ENTRY_SIGN.
_LEDGER_ENTRY_DISPLAY_SIGN: dict[LedgerEntryTypeEnum, int] = {
    LedgerEntryTypeEnum.balance_added: 1,
    LedgerEntryTypeEnum.balance_settled: -1,
    LedgerEntryTypeEnum.credit_added: 1,
    LedgerEntryTypeEnum.credit_used: -1,
    LedgerEntryTypeEnum.credit_auto_used: -1,
}


async def get_ledger_entries_by_category(
    db: AsyncSession, customer_id: int, category: str
) -> list[CustomerLedgerCategoryEntryResponse]:
    entry_types = _LEDGER_CATEGORY_TYPES[category]
    stmt = (
        select(CustomerLedger, SalesTransaction.order_number)
        .join(SalesTransaction, CustomerLedger.transaction_id == SalesTransaction.id)
        .where(
            CustomerLedger.customer_id == customer_id,
            CustomerLedger.entry_type.in_(entry_types),
        )
        .order_by(CustomerLedger.created_at.desc())
    )
    result = await db.execute(stmt)
    return [
        CustomerLedgerCategoryEntryResponse(
            id=entry.id,
            transaction_id=entry.transaction_id,
            order_number=order_number,
            signed_amount=entry.amount * _LEDGER_ENTRY_DISPLAY_SIGN[entry.entry_type],
            created_at=entry.created_at,
        )
        for entry, order_number in result.all()
    ]


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
