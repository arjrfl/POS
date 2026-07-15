"""add draft_credit_sources_json to payment_detail

Revision ID: a7c3f9e2d5b1
Revises: 0a5bf21a4d24
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3f9e2d5b1'
down_revision: Union[str, Sequence[str], None] = '0a5bf21a4d24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'payment_detail',
        sa.Column('draft_credit_sources_json', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('payment_detail', 'draft_credit_sources_json')
