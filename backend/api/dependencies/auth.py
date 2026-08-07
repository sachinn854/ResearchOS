"""The dependency that turns a request into a verified user.

Every protected endpoint takes `current_user: User = Depends(get_current_user)`.
That is what makes auth real: the user's identity comes from a signed token the
server verifies, not from a query parameter or request body the client fills in.
"""
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.security import decode_access_token
from backend.db.models.user import User
from backend.db.postgres import get_db

log = logging.getLogger("researchos.auth")

# auto_error=False so a missing header reaches our own code and gets the same
# 401 shape as a bad token. With the default, FastAPI answers 403 for a missing
# header and 401 for a bad one, and the frontend then needs two cases to decide
# "send them to /login".
_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    # Without this header a 401 is not a well-formed challenge.
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        # Covers an expired token, a bad signature, and a payload we did not
        # issue. All three are the same answer to the caller — telling them
        # which one it was only helps someone probing.
        raise _UNAUTHORIZED

    user = await db.get(User, user_id)
    if user is None:
        # Token verified but the account is gone. Happens after a delete, and
        # would otherwise let a still-valid token act as a ghost user.
        log.warning("[auth] valid token for a user that no longer exists: %s", user_id)
        raise _UNAUTHORIZED

    if not user.is_active:
        # Checked on every request, not just at login. A token issued before the
        # account was disabled must stop working immediately.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled",
        )

    return user
