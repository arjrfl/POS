import asyncio
import json
from decimal import Decimal

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.customer import Customer, CustomerStatusEnum
from app.models.ledger import CustomerLedger, LedgerEntryTypeEnum
from app.models.transaction import (
    CustomerTypeEnum,
    QueueStatusEnum,
    SalesTransaction,
    TransactionStatusEnum,
    TransactionTypeEnum,
)
from app.services import customer_service, transaction_service
from app.schemas.transaction import (
    DraftPaymentEntry,
    PaymentProcessItem,
    PaymentProcessRequest,
    TransactionCreate,
    TransactionItemCreate,
)


async def make_dummy_source_txn(db, order_number, customer_id):
    t = SalesTransaction(
        order_number=order_number,
        transaction_type=TransactionTypeEnum.original,
        transaction_status=TransactionStatusEnum.completed,
        customer_type=CustomerTypeEnum.walk_in,
        customer_id=customer_id,
        estimated_amount=Decimal("0.00"),
        total_due=Decimal("0.00"),
        queue_status=QueueStatusEnum.done,
    )
    db.add(t)
    await db.flush()
    return t


async def main():
    async with AsyncSessionLocal() as db:
        customer = Customer(full_name="Verify Credit Test Customer", customer_status=CustomerStatusEnum.active, net_balance=Decimal("0.00"))
        db.add(customer)
        await db.flush()

        src1 = await make_dummy_source_txn(db, "TXN-VERIFY-0001", customer.id)
        src2 = await make_dummy_source_txn(db, "TXN-VERIFY-0002", customer.id)

        # entry1 created first (older -> consumed first by FIFO), amount 300
        db.add(CustomerLedger(
            customer_id=customer.id, transaction_id=src1.id,
            entry_type=LedgerEntryTypeEnum.credit_added, amount=Decimal("300.00"),
            running_balance=Decimal("300.00"),
        ))
        customer.net_balance = Decimal("300.00")
        await db.flush()

        # entry2 created second (newer), amount 250
        db.add(CustomerLedger(
            customer_id=customer.id, transaction_id=src2.id,
            entry_type=LedgerEntryTypeEnum.credit_added, amount=Decimal("250.00"),
            running_balance=Decimal("550.00"),
        ))
        customer.net_balance = Decimal("550.00")
        await db.commit()

        print("== Step 1: get_outstanding_credit_entries (should be oldest first: TXN-VERIFY-0001 300, TXN-VERIFY-0002 250) ==")
        entries = await customer_service.get_outstanding_credit_entries(db, customer.id)
        for e in entries:
            print(f"  {e.order_number} amount={e.amount} ledger_entry_id={e.ledger_entry_id}")

        print("\n== Step 2: get_credit_breakdown_for_entries(both checked) -> full amount per entry, TXN-0001 300 + TXN-0002 250 ==")
        checked_ids = [e.ledger_entry_id for e in entries]
        breakdown = await customer_service.get_credit_breakdown_for_entries(db, customer.id, checked_ids)
        for b in breakdown:
            print(f"  {b}")

        # Create a payment_user id to act as (reuse seeded payment_user, id likely 2, but query it to be safe)
        from app.models.user import User
        result = await db.execute(select(User).where(User.username == "payment_user"))
        payment_user = result.scalar_one()

        # Create the transaction to actually pay (original, walk_in, total_due 900)
        create_data = TransactionCreate(
            customer_id=customer.id,
            customer_type=CustomerTypeEnum.walk_in,
            transaction_type="original",
            items=[TransactionItemCreate(
                item_type="product", product_id=1, unit_count=1,
                quantity_kg=Decimal("1.000"), unit_price=Decimal("900.00"),
            )],
        )
        txn_response = await transaction_service.create_transaction(db, create_data, payment_user.id)
        print(f"\n== Step 3: created transaction {txn_response.order_number} total_due={txn_response.total_due} ==")

        grabbed = await transaction_service.grab_transaction(db, txn_response.id, payment_user.id, "payment")
        print(f"  grabbed, status={grabbed.queue_status}")

        # Save draft with both entries explicitly checked (full amount each, 300 + 250 = 550)
        drafts = await transaction_service.save_draft_payments(
            db, txn_response.id, entries=[], user_id=payment_user.id,
            balances_to_settle=[], credit_entries_checked=checked_ids,
        )
        first_draft = drafts[0]
        print(f"\n== Step 4: save_draft_payments credit_entries_checked=both -> draft_credit_applied={first_draft.draft_credit_applied}, draft_credit_sources_json ==")
        print(f"  {first_draft.draft_credit_sources_json}")

        # Simulate park/unpark round-trip and re-fetch transaction to confirm persistence
        parked = await transaction_service.park_transaction(db, txn_response.id, payment_user.id)
        unparked = await transaction_service.unpark_transaction(db, txn_response.id, payment_user.id)
        fetched = await transaction_service.get_transaction(db, txn_response.id)
        print(f"\n== Step 5: after park/unpark, TransactionResponse.draft_credit_sources_json ==")
        print(f"  {fetched.draft_credit_sources_json}")
        assert fetched.draft_credit_sources_json == first_draft.draft_credit_sources_json, "MISMATCH after park/unpark!"
        print("  MATCH OK")

        # Now actually pay it: remaining amount after 550 credit = 350, pay via cash
        pay_request = PaymentProcessRequest(
            payments=[PaymentProcessItem(payment_method_id=1, amount=Decimal("350.00"), tendered_amount=Decimal("350.00"))],
            credit_entries_checked=checked_ids,
            balances_to_settle=[],
            is_partial=False,
            amount_paid=Decimal("350.00"),
        )
        paid = await transaction_service.process_payment(db, txn_response.id, pay_request, payment_user.id)
        print(f"\n== Step 6: paid transaction, status={paid.transaction_status}, credit_applied={paid.credit_applied} ==")

        result = await db.execute(
            select(CustomerLedger).where(
                CustomerLedger.transaction_id == txn_response.id,
                CustomerLedger.entry_type == LedgerEntryTypeEnum.credit_used,
            )
        )
        credit_used = result.scalar_one()
        print(f"\n== Step 7: credit_used ledger entry notes (both sources listed in full) ==")
        print(f"  {credit_used.notes}")

        print("\n== Step 8: overshoot case — customer has no credit left, add a fresh 200 entry and check it against a 120 transaction ==")
        src3 = await make_dummy_source_txn(db, "TXN-VERIFY-0003", customer.id)
        db.add(CustomerLedger(
            customer_id=customer.id, transaction_id=src3.id,
            entry_type=LedgerEntryTypeEnum.credit_added, amount=Decimal("200.00"),
            running_balance=customer.net_balance + Decimal("200.00"),
        ))
        customer.net_balance += Decimal("200.00")
        await db.commit()

        small_create_data = TransactionCreate(
            customer_id=customer.id,
            customer_type=CustomerTypeEnum.walk_in,
            transaction_type="original",
            items=[TransactionItemCreate(
                item_type="product", product_id=1, unit_count=1,
                quantity_kg=Decimal("1.000"), unit_price=Decimal("120.00"),
            )],
        )
        small_txn = await transaction_service.create_transaction(db, small_create_data, payment_user.id)
        await transaction_service.grab_transaction(db, small_txn.id, payment_user.id, "payment")

        overshoot_entries = await customer_service.get_outstanding_credit_entries(db, customer.id)
        overshoot_id = overshoot_entries[0].ledger_entry_id
        overshoot_pay_request = PaymentProcessRequest(
            payments=[],
            credit_entries_checked=[overshoot_id],
            balances_to_settle=[],
            is_partial=False,
            amount_paid=Decimal("0.00"),
        )
        overshoot_paid = await transaction_service.process_payment(db, small_txn.id, overshoot_pay_request, payment_user.id)
        print(f"  transaction total_due=120, credit checked=200 -> credit_applied={overshoot_paid.credit_applied} (expect capped at 120.00)")
        remainder = await customer_service.get_outstanding_credit_entries(db, customer.id)
        for e in remainder:
            print(f"  remaining credit after overshoot: {e.order_number} amount={e.amount} (expect TXN-VERIFY-0003 80.00)")

        print("\nALL STEPS COMPLETED WITHOUT ERROR")


asyncio.run(main())
