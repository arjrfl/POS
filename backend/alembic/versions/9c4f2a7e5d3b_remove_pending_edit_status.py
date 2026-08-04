"""remove_pending_edit_status

Revision ID: 9c4f2a7e5d3b
Revises: 76d3a5dc2561
Create Date: 2026-07-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c4f2a7e5d3b'
down_revision: Union[str, Sequence[str], None] = '76d3a5dc2561'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Safety check first — the Return to Receiver flow that produced this status
    # has been removed from the app; abort rather than silently orphaning data
    # if any transaction is still sitting in 'pending_edit'.
    # Wrapped in autocommit_block(): 'pending_edit' was added via ALTER TYPE
    # ... ADD VALUE in b7e3f9a1c2d4, and Postgres won't let a query reference
    # a value added that way until the adding transaction commits. That
    # migration commits it independently via its own autocommit_block, but
    # this SELECT is wrapped too so it doesn't rely on that ordering detail.
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        count = conn.execute(
            sa.text("SELECT COUNT(*) FROM sales_transaction WHERE transaction_status = 'pending_edit'")
        ).scalar_one()
    if count > 0:
        raise RuntimeError(
            f"Aborting migration: {count} sales_transaction row(s) have "
            "transaction_status='pending_edit'. Cannot drop this enum value "
            "while rows still reference it."
        )

    op.execute("ALTER TYPE transaction_status_enum RENAME TO transaction_status_enum_old")

    op.execute(
        "CREATE TYPE transaction_status_enum AS ENUM ("
        "'pending_payment', 'pending_settlement', 'pending_adjustment', "
        "'settled', 'pending_handover', 'completed', 'voided'"
        ")"
    )

    op.execute(
        "ALTER TABLE sales_transaction "
        "ALTER COLUMN transaction_status TYPE transaction_status_enum "
        "USING transaction_status::text::transaction_status_enum"
    )

    op.execute("DROP TYPE transaction_status_enum_old")


def downgrade() -> None:
    """Downgrade schema."""
    # No data to restore — this status will simply be unused again, not repopulated.
    op.execute("ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'pending_edit'")
