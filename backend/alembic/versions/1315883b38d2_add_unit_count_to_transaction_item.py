"""add unit_count to transaction_item

Revision ID: 1315883b38d2
Revises: 
Create Date: 2026-07-07 19:34:57.428423

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1315883b38d2'
down_revision: Union[str, Sequence[str], None] = '101b1dc45309'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate also flagged ~15 indexes as "removed" purely because the ORM
    # models don't declare Index() objects matching schema.sql's hand-written
    # ones — those are pre-existing, unrelated to this change, and dropping them
    # would be a real, unwanted regression. Only the actual model change belongs here.
    op.add_column('transaction_item', sa.Column('unit_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_item', 'unit_count')
