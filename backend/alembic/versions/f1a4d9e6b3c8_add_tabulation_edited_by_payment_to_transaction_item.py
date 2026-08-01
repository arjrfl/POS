"""add tabulation_edited_by_payment to transaction_item

Revision ID: f1a4d9e6b3c8
Revises: e8f3a1b7c9d2
Create Date: 2026-08-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a4d9e6b3c8'
down_revision: Union[str, Sequence[str], None] = 'e8f3a1b7c9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'transaction_item',
        sa.Column('tabulation_edited_by_payment', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_item', 'tabulation_edited_by_payment')
