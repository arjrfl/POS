"""seed operations role row

Revision ID: c8b3e6f1a2d9
Revises: a3d6f8c1e9b4
Create Date: 2026-08-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c8b3e6f1a2d9'
down_revision: Union[str, Sequence[str], None] = 'a3d6f8c1e9b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        INSERT INTO role (role_name)
        SELECT 'operations'
        WHERE NOT EXISTS (
            SELECT 1 FROM role WHERE role_name = 'operations'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM role WHERE role_name = 'operations'")
