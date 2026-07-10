"""add is_draft to payment_detail

Revision ID: c9d1e5f3a7b2
Revises: b7e3f9a1c2d4
Create Date: 2026-07-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d1e5f3a7b2'
down_revision: Union[str, Sequence[str], None] = 'b7e3f9a1c2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'payment_detail',
        sa.Column('is_draft', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('payment_detail', 'is_draft')
