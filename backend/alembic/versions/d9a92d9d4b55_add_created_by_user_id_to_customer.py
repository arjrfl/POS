"""add created_by_user_id to customer

Revision ID: d9a92d9d4b55
Revises: d4a1f7c3b9e6
Create Date: 2026-07-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9a92d9d4b55'
down_revision: Union[str, Sequence[str], None] = 'd4a1f7c3b9e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # No backfill for existing rows — left NULL, per project convention for
    # additive columns that predate their own tracking.
    op.add_column(
        'customer',
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='RESTRICT'),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('customer', 'created_by_user_id')
