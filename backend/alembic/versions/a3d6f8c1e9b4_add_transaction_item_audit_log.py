"""add item_edit_source_enum and transaction_item_audit_log table

Revision ID: a3d6f8c1e9b4
Revises: f7c2a9e4d6b1
Create Date: 2026-07-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3d6f8c1e9b4'
down_revision: Union[str, Sequence[str], None] = 'f7c2a9e4d6b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # create_type defaults to True, so op.create_table below creates the enum
    # type as part of the same DDL sequence — no separate .create() call needed.
    # Separate from audit_change_type_enum/transaction_audit_log (transaction_status/
    # queue_status phase moves) — this tracks item-content edits instead.
    item_edit_source_enum = sa.Enum(
        'payment_item_edit', 'releasing_item_correction',
        name='item_edit_source_enum',
    )

    op.create_table(
        'transaction_item_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'transaction_id', sa.Integer(), sa.ForeignKey('sales_transaction.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'changed_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False,
        ),
        sa.Column('edit_source', item_edit_source_enum, nullable=False),
        sa.Column('old_value', sa.Text(), nullable=True),
        sa.Column('new_value', sa.Text(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
    )
    op.create_index('idx_tial_transaction', 'transaction_item_audit_log', ['transaction_id'])
    op.create_index('idx_tial_edit_source', 'transaction_item_audit_log', ['edit_source'])


def downgrade() -> None:
    """Downgrade schema."""
    # drop_table below drops the enum type too (same before/after DDL pairing
    # SQLAlchemy uses for the create side).
    op.drop_index('idx_tial_edit_source', table_name='transaction_item_audit_log')
    op.drop_index('idx_tial_transaction', table_name='transaction_item_audit_log')
    op.drop_table('transaction_item_audit_log')
