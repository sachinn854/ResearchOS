import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.postgres import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Unique so two accounts cannot share an address. The constraint lives in the
    # database, not just in the register handler — two simultaneous signups with
    # the same email would both pass a "does this email exist" check.
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # The bcrypt hash, never the password. Named so that nobody mistakes it for
    # something readable.
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    # Lets us disable an account without deleting it and losing its documents and
    # chat history. Checked on every authenticated request.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):
        return f"<User id={self.id} email={self.email}>"
