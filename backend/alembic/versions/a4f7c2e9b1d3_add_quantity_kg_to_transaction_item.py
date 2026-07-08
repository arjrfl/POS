"""add quantity_kg to transaction_item

Revision ID: a4f7c2e9b1d3
Revises: 1315883b38d2
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4f7c2e9b1d3'
down_revision: Union[str, Sequence[str], None] = '1315883b38d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('transaction_item', sa.Column('quantity_kg', sa.Numeric(10, 3), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_item', 'quantity_kg')
