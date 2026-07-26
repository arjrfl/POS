"""add original_items_snapshot to sales_transaction

Revision ID: bfa2c83f3989
Revises: 9c4f2a7e5d3b
Create Date: 2026-07-26 03:47:55.304846

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bfa2c83f3989'
down_revision: Union[str, Sequence[str], None] = '9c4f2a7e5d3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sales_transaction',
        sa.Column('original_items_snapshot', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sales_transaction', 'original_items_snapshot')
