"""add_actual_qty_fields_to_transaction_item

Revision ID: 3623cd0e88d3
Revises: a1c5e8f2b4d6
Create Date: 2026-07-14 22:16:54.699635

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3623cd0e88d3'
down_revision: Union[str, Sequence[str], None] = 'a1c5e8f2b4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('transaction_item', sa.Column('actual_unit_count', sa.Integer(), nullable=True))
    op.add_column('transaction_item', sa.Column('actual_quantity_kg', sa.Numeric(10, 3), nullable=True))
    op.add_column(
        'transaction_item',
        sa.Column('actual_subtotal', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_item', 'actual_subtotal')
    op.drop_column('transaction_item', 'actual_quantity_kg')
    op.drop_column('transaction_item', 'actual_unit_count')
