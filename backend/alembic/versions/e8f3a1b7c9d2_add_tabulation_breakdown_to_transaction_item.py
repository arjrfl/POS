"""add tabulation_breakdown to transaction_item

Revision ID: e8f3a1b7c9d2
Revises: c8b3e6f1a2d9
Create Date: 2026-08-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8f3a1b7c9d2'
down_revision: Union[str, Sequence[str], None] = 'c8b3e6f1a2d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('transaction_item', sa.Column('tabulation_breakdown', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_item', 'tabulation_breakdown')
