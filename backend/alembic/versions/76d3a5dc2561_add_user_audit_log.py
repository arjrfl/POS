"""add user_change_type_enum and user_audit_log table

Revision ID: 76d3a5dc2561
Revises: c4e8a1f6b3d5
Create Date: 2026-07-23 21:54:35.885006

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '76d3a5dc2561'
down_revision: Union[str, Sequence[str], None] = 'c4e8a1f6b3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # create_type defaults to True, so op.create_table below creates the enum
    # type as part of the same DDL sequence — no separate .create() call needed.
    user_change_type_enum = sa.Enum(
        'created', 'updated', 'deactivated', 'reactivated', 'password_reset',
        name='user_change_type_enum',
    )

    op.create_table(
        'user_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('changed_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('change_type', user_change_type_enum, nullable=False),
        sa.Column('old_value', sa.Text(), nullable=True),
        sa.Column('new_value', sa.Text(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
    )
    op.create_index('idx_ual_user', 'user_audit_log', ['user_id'])
    op.create_index('idx_ual_change_type', 'user_audit_log', ['change_type'])


def downgrade() -> None:
    """Downgrade schema."""
    # drop_table below drops the enum type too (same before/after DDL pairing
    # SQLAlchemy uses for the create side).
    op.drop_index('idx_ual_change_type', table_name='user_audit_log')
    op.drop_index('idx_ual_user', table_name='user_audit_log')
    op.drop_table('user_audit_log')
