"""add pending_adjustment to transaction_status_enum

Revision ID: a1c5e8f2b4d6
Revises: f3b8c6d1a9e2
Create Date: 2026-07-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c5e8f2b4d6'
down_revision: Union[str, Sequence[str], None] = 'f3b8c6d1a9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'pending_adjustment'")


def downgrade() -> None:
    """Downgrade schema."""
    # PostgreSQL cannot remove a value from an enum type without recreating the
    # type and remapping every dependent column — no safe automatic downgrade.
    pass
