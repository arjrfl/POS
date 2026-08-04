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
    # Postgres forbids referencing a value added via ALTER TYPE ... ADD VALUE
    # within the same transaction that added it (see 9c4f2a7e5d3b's safety-check
    # SELECT against 'pending_edit'). Historically these ran as separate
    # `alembic upgrade head` invocations days apart, so this never surfaced —
    # it only does when the full chain replays in one shot (e.g. from empty).
    # autocommit_block() commits this statement immediately, outside the
    # ambient migration transaction, before resuming it for later migrations.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'pending_edit'")


def downgrade() -> None:
    """Downgrade schema."""
    # PostgreSQL cannot remove a value from an enum type without recreating the
    # type and remapping every dependent column — no safe automatic downgrade.
    pass
