import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.customer import Customer
from app.models.product import Product
from app.models.user import Role, User

PASSWORD = "password123"

USERS = [
    {"full_name": "Walk-In User", "username": "walk_in_user", "role_name": "walk_in"},
    {"full_name": "Payment User", "username": "payment_user", "role_name": "payment"},
    {"full_name": "Releasing User", "username": "releasing_user", "role_name": "releasing"},
    {"full_name": "Admin User", "username": "admin_user", "role_name": "admin"},
]

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

        for entry in CUSTOMERS:
            existing = await db.execute(select(Customer).where(Customer.full_name == entry["full_name"]))
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(Customer(**entry))

        for entry in PRODUCTS:
            existing = await db.execute(select(Product).where(Product.product_name == entry["product_name"]))
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(Product(**entry))

        await db.commit()
        print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
