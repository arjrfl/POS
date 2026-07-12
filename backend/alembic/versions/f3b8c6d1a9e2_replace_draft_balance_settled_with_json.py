"""replace draft_balance_settled with draft_balances_json on payment_detail

Revision ID: f3b8c6d1a9e2
Revises: d2f4a8b6e1c9
Create Date: 2026-07-12 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3b8c6d1a9e2'
down_revision: Union[str, Sequence[str], None] = 'd2f4a8b6e1c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'payment_detail',
        sa.Column('draft_balances_json', sa.Text(), nullable=True),
    )
    op.drop_column('payment_detail', 'draft_balance_settled')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'payment_detail',
        sa.Column('draft_balance_settled', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
    )
    op.drop_column('payment_detail', 'draft_balances_json')
