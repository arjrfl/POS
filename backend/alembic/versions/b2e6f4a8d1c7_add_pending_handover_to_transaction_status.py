"""add pending_handover to transaction_status_enum

Revision ID: b2e6f4a8d1c7
Revises: e5a2c7f1b3d8
Create Date: 2026-07-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2e6f4a8d1c7'
down_revision: Union[str, Sequence[str], None] = 'e5a2c7f1b3d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'pending_handover'")


def downgrade() -> None:
    """Downgrade schema."""
    # PostgreSQL cannot remove a value from an enum type without recreating the
    # type and remapping every dependent column — no safe automatic downgrade.
    pass
