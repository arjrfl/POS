"""add change_claimed to sales_transaction

Revision ID: e5a2c7f1b3d8
Revises: a7c3f9e2d5b1
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5a2c7f1b3d8'
down_revision: Union[str, Sequence[str], None] = 'a7c3f9e2d5b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sales_transaction',
        sa.Column('change_claimed', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sales_transaction', 'change_claimed')
