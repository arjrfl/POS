"""add pending_edit to transaction_status_enum

Revision ID: b7e3f9a1c2d4
Revises: a4f7c2e9b1d3
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e3f9a1c2d4'
down_revision: Union[str, Sequence[str], None] = 'a4f7c2e9b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'pending_edit'")


def downgrade() -> None:
    """Downgrade schema."""
    # PostgreSQL cannot remove a value from an enum type without recreating the
    # type and remapping every dependent column — no safe automatic downgrade.
    pass
