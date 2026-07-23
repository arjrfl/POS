"""drop credit_usage from transaction_type_enum

Revision ID: c4e8a1f6b3d5
Revises: d9a92d9d4b55
Create Date: 2026-07-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e8a1f6b3d5'
down_revision: Union[str, Sequence[str], None] = 'd9a92d9d4b55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Safety check first — 'credit_usage' has no live code path that ever
    # produces a sales_transaction row (see CLAUDE.md); abort rather than
    # silently orphaning data if that assumption turns out to be wrong.
    conn = op.get_bind()
    count = conn.execute(
        sa.text("SELECT COUNT(*) FROM sales_transaction WHERE transaction_type = 'credit_usage'")
    ).scalar_one()
    if count > 0:
        raise RuntimeError(
            f"Aborting migration: {count} sales_transaction row(s) have "
            "transaction_type='credit_usage'. Cannot drop this enum value "
            "while rows still reference it."
        )

    op.execute("ALTER TYPE transaction_type_enum RENAME TO transaction_type_enum_old")

    op.execute(
        "CREATE TYPE transaction_type_enum AS ENUM ("
        "'original', 'adjustment', 'refund', 'balance_settlement'"
        ")"
    )

    op.execute(
        "ALTER TABLE sales_transaction "
        "ALTER COLUMN transaction_type TYPE transaction_type_enum "
        "USING transaction_type::text::transaction_type_enum"
    )

    op.execute("DROP TYPE transaction_type_enum_old")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'credit_usage'")
