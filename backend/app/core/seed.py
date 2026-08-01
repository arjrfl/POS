import asyncio
import secrets
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.customer import Customer
from app.models.ledger import CustomerLedger, LedgerEntryTypeEnum
from app.models.product import Product
from app.models.transaction import CustomerTypeEnum, QueueStatusEnum, SalesTransaction, TransactionStatusEnum, TransactionTypeEnum
from app.models.user import Role, User

PASSWORD = "password123"

USERS = [
    {"full_name": "Receiver User", "username": "receiver_user", "role_name": "receiver"},
    {"full_name": "Payment User", "username": "payment_user", "role_name": "payment"},
    {"full_name": "Releasing User", "username": "releasing_user", "role_name": "releasing"},
    {"full_name": "Admin User", "username": "admin_user", "role_name": "admin"},
    {"full_name": "Receiver User 2", "username": "receiver_user2", "role_name": "receiver"},
    {"full_name": "Receiver User 3", "username": "receiver_user3", "role_name": "receiver"},
    {"full_name": "Payment User 2", "username": "payment_user2", "role_name": "payment"},
    {"full_name": "Payment User 3", "username": "payment_user3", "role_name": "payment"},
    {"full_name": "Releasing User 2", "username": "releasing_user2", "role_name": "releasing"},
    {"full_name": "Releasing User 3", "username": "releasing_user3", "role_name": "releasing"},
    {"full_name": "Operations User", "username": "operations_user", "role_name": "operations"},
]

# System-only account — attribution for the end-of-day auto-void job
# (see transaction_service.run_end_of_day_auto_void). is_active=False and a
# random, never-surfaced password mean this account can never log in; it
# exists purely to satisfy transaction_void_log/transaction_audit_log's
# changed_by/voided_by FK. Never delete or reactivate this account.
SYSTEM_AUTO_VOID_USER = {
    "full_name": "System (Automated End-of-Day Void)",
    "username": "system_auto_void",
    "role_name": "admin",
}

CUSTOMERS = [
    {
        "full_name": "Juan Dela Cruz",
        "address": "123 Mabini St, Manila",
        "contact_number": "09171234567",
        "net_balance": "0.00",
    },
    {
        "full_name": "Maria Santos",
        "address": "45 Rizal Ave, Quezon City",
        "contact_number": "09181234567",
        "net_balance": "-150.00",
    },
    {
        "full_name": "Pedro Reyes",
        "address": "78 Bonifacio St, Makati",
        "contact_number": "09191234567",
        "net_balance": "300.00",
    },
    {
        "full_name": "Ana Garcia",
        "address": None,
        "contact_number": "09201234567",
        "net_balance": "0.00",
    },
    {
        "full_name": "Jose Ramirez",
        "address": "12 Aguinaldo St, Pasig",
        "contact_number": None,
        "net_balance": "-75.50",
    },
    {
        "full_name": "Ramon Villanueva",
        "address": "34 Del Pilar St, Marikina",
        "contact_number": "09221234567",
        "net_balance": "-320.00",
    },
    {
        "full_name": "Carmen Aquino",
        "address": "56 Luna St, San Juan",
        "contact_number": "09231234567",
        "net_balance": "250.00",
    },
]

PRODUCTS = [
    {
        "product_name": "Chicken Breast",
        "brand_name": "Bounty Fresh",
        "unit_weight_kg": "1.000",
        "unit_price_php": "220.00",
        "stock_quantity": "80.000",
    },
    {
        "product_name": "Chicken Thigh",
        "brand_name": "Magnolia",
        "unit_weight_kg": "1.000",
        "unit_price_php": "190.00",
        "stock_quantity": "60.000",
    },
    {
        "product_name": "Whole Chicken",
        "brand_name": "Bounty Fresh",
        "unit_weight_kg": "1.200",
        "unit_price_php": "180.00",
        "stock_quantity": "35.000",
    },
    {
        "product_name": "Pork Belly",
        "brand_name": "Monterey",
        "unit_weight_kg": "1.000",
        "unit_price_php": "320.00",
        "stock_quantity": "50.000",
    },
    {
        "product_name": "Pork Chop",
        "brand_name": "Monterey",
        "unit_weight_kg": "1.000",
        "unit_price_php": "280.00",
        "stock_quantity": "40.000",
    },
    {
        "product_name": "Ground Pork",
        "brand_name": None,
        "unit_weight_kg": "1.000",
        "unit_price_php": "260.00",
        "stock_quantity": "45.000",
    },
    {
        "product_name": "Beef Brisket",
        "brand_name": "CDO",
        "unit_weight_kg": "1.000",
        "unit_price_php": "420.00",
        "stock_quantity": "30.000",
    },
    {
        "product_name": "Beef Cube Steak",
        "brand_name": "CDO",
        "unit_weight_kg": "1.000",
        "unit_price_php": "380.00",
        "stock_quantity": "25.000",
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        roles_by_name = {role.role_name: role for role in (await db.execute(select(Role))).scalars().all()}

        for entry in USERS:
            existing = await db.execute(select(User).where(User.username == entry["username"]))
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(
                User(
                    full_name=entry["full_name"],
                    username=entry["username"],
                    password_hash=hash_password(PASSWORD),
                    role_id=roles_by_name[entry["role_name"]].id,
                )
            )

        existing_system_user = await db.execute(
            select(User).where(User.username == SYSTEM_AUTO_VOID_USER["username"])
        )
        if existing_system_user.scalar_one_or_none() is None:
            db.add(
                User(
                    full_name=SYSTEM_AUTO_VOID_USER["full_name"],
                    username=SYSTEM_AUTO_VOID_USER["username"],
                    # random, unguessable, never surfaced anywhere — this account
                    # is not a login path (is_active=False blocks login regardless)
                    password_hash=hash_password(secrets.token_urlsafe(32)),
                    role_id=roles_by_name[SYSTEM_AUTO_VOID_USER["role_name"]].id,
                    is_active=False,
                )
            )

        for entry in CUSTOMERS:
            existing = await db.execute(select(Customer).where(Customer.full_name == entry["full_name"]))
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(Customer(**entry))

        await db.flush()  # assigns ids to any customers just added, needed below

        # A customer's net_balance must trace back to a real ledger entry (Walk-In
        # looks up the most recent one to satisfy transaction_item.reference_transaction_id
        # for balance_settlement/credit_usage lines) — seed data sets net_balance
        # directly, so back it with a placeholder transaction + ledger entry here.
        walkin_user = (
            await db.execute(select(User).where(User.username == "receiver_user"))
        ).scalar_one_or_none()

        for entry in CUSTOMERS:
            net_balance = Decimal(entry["net_balance"])
            if net_balance == 0:
                continue

            customer = (
                await db.execute(select(Customer).where(Customer.full_name == entry["full_name"]))
            ).scalar_one()

            has_ledger_entry = (
                await db.execute(
                    select(CustomerLedger.id).where(CustomerLedger.customer_id == customer.id).limit(1)
                )
            ).scalar_one_or_none()
            if has_ledger_entry is not None:
                continue

            placeholder_transaction = SalesTransaction(
                order_number=f"LSH-SEED-{customer.id:04d}",
                transaction_type=TransactionTypeEnum.original,
                transaction_status=TransactionStatusEnum.completed,
                customer_type=CustomerTypeEnum.walk_in,
                walkin_user_id=walkin_user.id if walkin_user else None,
                customer_id=customer.id,
                queue_status=QueueStatusEnum.done,
                walkin_at=datetime.now(timezone.utc),
            )
            db.add(placeholder_transaction)
            await db.flush()  # assigns transaction.id

            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=placeholder_transaction.id,
                    entry_type=LedgerEntryTypeEnum.credit_added
                    if net_balance > 0
                    else LedgerEntryTypeEnum.balance_added,
                    amount=abs(net_balance),
                    running_balance=net_balance,
                    notes="Seed data — opening balance",
                )
            )

        for entry in PRODUCTS:
            existing = await db.execute(select(Product).where(Product.product_name == entry["product_name"]))
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(Product(**entry))

        await db.commit()
        print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
