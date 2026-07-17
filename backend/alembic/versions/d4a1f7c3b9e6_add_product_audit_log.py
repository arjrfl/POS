"""add product_change_type_enum and product_audit_log table

Revision ID: d4a1f7c3b9e6
Revises: b2e6f4a8d1c7
Create Date: 2026-07-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a1f7c3b9e6'
down_revision: Union[str, Sequence[str], None] = 'b2e6f4a8d1c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    """Upgrade schema."""
    # create_type defaults to True, so op.create_table below creates the enum
    # type as part of the same DDL sequence — no separate .create() call needed.
    product_change_type_enum = sa.Enum(
        'created', 'updated', 'stock_adjusted', 'deactivated', 'reactivated',
        name='product_change_type_enum',
    )

    op.create_table(
        'product_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('product.id', ondelete='CASCADE'), nullable=False),
        sa.Column('changed_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('change_type', product_change_type_enum, nullable=False),
        sa.Column('old_value', sa.Text(), nullable=True),
        sa.Column('new_value', sa.Text(), nullable=False),
        sa.Column('stock_delta', sa.Numeric(10, 3), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
    )
    op.create_index('idx_pal_product', 'product_audit_log', ['product_id'])
    op.create_index('idx_pal_change_type', 'product_audit_log', ['change_type'])


def downgrade() -> None:
    """Downgrade schema."""
    # drop_table below drops the enum type too (same before/after DDL pairing
    # SQLAlchemy uses for the create side).
    op.drop_index('idx_pal_change_type', table_name='product_audit_log')
    op.drop_index('idx_pal_product', table_name='product_audit_log')
    op.drop_table('product_audit_log')
