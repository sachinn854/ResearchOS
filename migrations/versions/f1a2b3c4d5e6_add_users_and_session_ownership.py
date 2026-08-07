"""add users table and real ownership on conversation_history

Revision ID: f1a2b3c4d5e6
Revises: d4e5f6a7b8c9
Create Date: 2026-08-07

Before this, "which user does this chat belong to?" was answered by string
matching: session ids were built as f"{user_id}_{...}" and the API checked
`session_id.startswith(user_id + "_")`. Worse, that user_id arrived as a query
parameter, so anyone could pass someone else's id and read their history. The
FK column here lets the check use the id from the verified token instead.

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Unique index, not just unique=True on the column, so the lookup in
    # /auth/login uses it too — every login queries by email.
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # Nullable because rows already exist. Those rows belonged to localStorage-only
    # accounts that were never in any database, so there is nothing to backfill
    # from — old chats stay in the table but no longer belong to anyone and will
    # not be listed. Deleting them is left to the operator.
    op.add_column(
        "conversation_history",
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_conversation_history_user_id",
        "conversation_history",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Every session list query filters on user_id, so it needs an index.
    op.create_index("ix_conversation_history_user_id", "conversation_history", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_conversation_history_user_id", table_name="conversation_history")
    op.drop_constraint("fk_conversation_history_user_id", "conversation_history", type_="foreignkey")
    op.drop_column("conversation_history", "user_id")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
