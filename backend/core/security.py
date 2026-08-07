"""Password hashing and JWT creation/verification.

This is the whole trust boundary of the app, so it is deliberately small and has
no clever parts.

Replaces the previous frontend-only "auth", where `frontend/lib/auth.ts` stored
accounts in `localStorage` and "hashed" passwords with `btoa()` — base64, which
is an encoding, not a hash, and decodes back to the plaintext in one line. The
backend enforced nothing at all, so hitting the API directly skipped login
entirely.
"""
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from backend.core.config import settings

# bcrypt only ever looks at the first 72 bytes of a password. Since version 4.1
# it raises ValueError instead of truncating silently, so a user with a long
# passphrase would get a 500 from /auth/register if we did not cut it ourselves.
_BCRYPT_MAX_BYTES = 72


def _prepare(password: str) -> bytes:
    """Encode a password for bcrypt, trimmed to the length bcrypt accepts.

    Slicing bytes can cut a multi-byte character in half. That is fine here —
    bcrypt hashes raw bytes, and hashing and verifying both go through this same
    function, so the two always agree.
    """
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), hashed.encode("utf-8"))
    except ValueError:
        # Malformed hash in the database — treat as a failed login, never as a
        # pass, and never let it bubble up as a 500.
        return False


def create_access_token(user_id: uuid.UUID | str) -> str:
    """Sign a token identifying this user.

    The subject is the user's database id, not their email. Emails can change;
    ids cannot, and a token should not stop working because someone updated
    their address.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> uuid.UUID | None:
    """Return the user id from a valid token, or None if it is not usable.

    Returns None rather than raising so callers can answer 401 without a
    try/except at every call site. Expiry and signature are both checked by
    `jwt.decode`; we only have to reject a payload that decodes but is not
    shaped the way we issue them.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            # Passing the algorithm explicitly matters. If this list came from
            # the token's own header, an attacker could set alg=none and hand us
            # an unsigned token that verifies.
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None

    subject = payload.get("sub")
    if not subject:
        return None

    try:
        return uuid.UUID(str(subject))
    except ValueError:
        return None
