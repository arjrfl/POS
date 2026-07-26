"""add original_items_snapshot_archive to sales_transaction

Revision ID: f7c2a9e4d6b1
Revises: e1b4d7a9c2f6
Create Date: 2026-07-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7c2a9e4d6b1'
down_revision: Union[str, Sequence[str], None] = 'e1b4d7a9c2f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sales_transaction',
        sa.Column('original_items_snapshot_archive', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sales_transaction', 'original_items_snapshot_archive')
