"""add draft_balance_settled and draft_credit_applied to payment_detail

Revision ID: d2f4a8b6e1c9
Revises: c9d1e5f3a7b2
Create Date: 2026-07-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f4a8b6e1c9'
down_revision: Union[str, Sequence[str], None] = 'c9d1e5f3a7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'payment_detail',
        sa.Column('draft_balance_settled', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
    )
    op.add_column(
        'payment_detail',
        sa.Column('draft_credit_applied', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('payment_detail', 'draft_credit_applied')
    op.drop_column('payment_detail', 'draft_balance_settled')
