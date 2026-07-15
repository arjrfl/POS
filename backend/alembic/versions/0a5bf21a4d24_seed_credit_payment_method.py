"""seed credit payment_method row

Revision ID: 0a5bf21a4d24
Revises: 3623cd0e88d3
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0a5bf21a4d24'
down_revision: Union[str, Sequence[str], None] = '3623cd0e88d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        INSERT INTO payment_method (payment_method_name)
        SELECT 'credit'
        WHERE NOT EXISTS (
            SELECT 1 FROM payment_method WHERE payment_method_name = 'credit'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM payment_method WHERE payment_method_name = 'credit'")
