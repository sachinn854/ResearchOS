"""Tests for password hashing and JWT handling.

All pure functions — no database, no network.
"""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from backend.core import security
from backend.core.config import settings


# --- password hashing ------------------------------------------------------

def test_hash_is_not_the_password():
    """The old implementation used btoa(), which is reversible. A hash must not
    contain the password and must differ every time."""
    hashed = security.hash_password("correct horse battery")

    assert "correct horse battery" not in hashed
    assert hashed.startswith("$2b$")  # bcrypt
    # Different salt each call, so the same password hashes differently.
    assert hashed != security.hash_password("correct horse battery")


def test_verify_accepts_correct_password():
    assert security.verify_password("s3cret-pass", security.hash_password("s3cret-pass"))


def test_verify_rejects_wrong_password():
    assert not security.verify_password("wrong-pass", security.hash_password("s3cret-pass"))


def test_long_password_does_not_crash():
    """bcrypt 4.1+ raises ValueError above 72 bytes. Without explicit truncation
    a long passphrase would 500 the register endpoint."""
    long_password = "a" * 200
    hashed = security.hash_password(long_password)

    assert security.verify_password(long_password, hashed)


def test_passwords_differing_only_past_72_bytes_are_equivalent():
    """An honest consequence of bcrypt's 72-byte limit, documented rather than
    hidden: everything past byte 72 is ignored."""
    base = "x" * 72
    hashed = security.hash_password(base + "AAAA")

    assert security.verify_password(base + "ZZZZ", hashed)


def test_unicode_password_round_trips():
    password = "पासवर्ड-मुश्किल-123"
    assert security.verify_password(password, security.hash_password(password))


def test_verify_rejects_malformed_hash_without_raising():
    """A corrupt row must read as a failed login, never as a pass and never as
    a 500."""
    assert not security.verify_password("anything", "not-a-bcrypt-hash")
    assert not security.verify_password("anything", "")


def test_empty_password_still_verifiable():
    assert security.verify_password("", security.hash_password(""))
    assert not security.verify_password("x", security.hash_password(""))


# --- JWT -------------------------------------------------------------------

def test_token_round_trip():
    user_id = uuid.uuid4()
    assert security.decode_access_token(security.create_access_token(user_id)) == user_id


def test_token_accepts_string_user_id():
    user_id = uuid.uuid4()
    assert security.decode_access_token(security.create_access_token(str(user_id))) == user_id


def test_expired_token_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "access_token_expire_minutes", -1)
    token = security.create_access_token(uuid.uuid4())

    assert security.decode_access_token(token) is None


def test_token_signed_with_another_secret_is_rejected():
    """The whole point of signing. A token minted elsewhere must not verify."""
    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "some-other-secret",
        algorithm=settings.jwt_algorithm,
    )

    assert security.decode_access_token(forged) is None


def test_unsigned_token_is_rejected():
    """alg=none is the classic JWT attack. It works when the library is allowed
    to read the algorithm from the token's own header, which is why
    decode_access_token passes `algorithms=` explicitly."""
    unsigned = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        key="",
        algorithm="none",
    )

    assert security.decode_access_token(unsigned) is None


def test_tampered_token_is_rejected():
    token = security.create_access_token(uuid.uuid4())
    header, payload, signature = token.split(".")
    tampered = f"{header}.{payload}.{signature[:-4]}AAAA"

    assert security.decode_access_token(tampered) is None


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c", "..."])
def test_malformed_tokens_are_rejected(token):
    assert security.decode_access_token(token) is None


def test_token_without_subject_is_rejected():
    valid_shape = jwt.encode(
        {"exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    assert security.decode_access_token(valid_shape) is None


def test_token_with_non_uuid_subject_is_rejected():
    """Guards against a token whose sub is an email or an integer id."""
    odd_subject = jwt.encode(
        {"sub": "admin@example.com", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    assert security.decode_access_token(odd_subject) is None


def test_token_carries_an_expiry():
    payload = jwt.decode(
        security.create_access_token(uuid.uuid4()),
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )

    assert "exp" in payload
    assert payload["exp"] > payload["iat"]
