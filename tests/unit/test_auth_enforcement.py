"""Structural tests: is auth actually wired onto the endpoints?

The old auth failed not because hashing was weak but because the backend never
checked anything — every /research endpoint was open. Unit-testing security.py
would not have caught that. These tests inspect the live FastAPI app instead, so
adding a new unprotected endpoint fails the suite.
"""
import uuid

import pytest
from fastapi import HTTPException

from backend.api.dependencies.auth import get_current_user
from backend.core.security import create_access_token
from backend.db.models.user import User

import main

# Endpoints that are meant to be reachable without a token.
PUBLIC_PATHS = {
    "/health",
    "/auth/register",
    "/auth/login",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
    "/openapi.json",
}


def _dependency_names(route) -> set[str]:
    return {
        dependency.call.__name__
        for dependency in route.dependant.dependencies
        if getattr(dependency, "call", None) is not None
    }


def _protected_routes():
    return [
        route for route in main.app.routes
        if hasattr(route, "dependant") and route.path not in PUBLIC_PATHS
    ]


def test_there_are_protected_routes_to_check():
    """Guards against the checks below silently passing on an empty list."""
    assert len(_protected_routes()) >= 7


@pytest.mark.parametrize("route", _protected_routes(), ids=lambda r: r.path)
def test_every_non_public_route_requires_authentication(route):
    assert "get_current_user" in _dependency_names(route), (
        f"{route.path} is reachable without a token. Add "
        f"current_user: User = Depends(get_current_user), or list it in PUBLIC_PATHS."
    )


def test_session_endpoints_no_longer_accept_a_user_id_parameter():
    """The original hole: /research/sessions took user_id as a query parameter
    and trusted it, so anyone could read anyone's chat history by passing their
    id. Identity must come from the token only."""
    session_routes = [
        route for route in main.app.routes
        if hasattr(route, "dependant") and route.path.startswith("/research/sessions")
    ]
    assert session_routes

    for route in session_routes:
        names = {param.name for param in route.dependant.query_params}
        assert "user_id" not in names, f"{route.path} still accepts a client-supplied user_id"


# --- the dependency itself -------------------------------------------------

class _FakeDB:
    """Stands in for AsyncSession.get()."""
    def __init__(self, user=None):
        self.user = user

    async def get(self, model, key):
        return self.user


def _credentials(token: str):
    from fastapi.security import HTTPAuthorizationCredentials
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _user(**overrides) -> User:
    user = User(
        id=overrides.get("id", uuid.uuid4()),
        email="a@b.com",
        name="A",
        hashed_password="x",
        is_active=overrides.get("is_active", True),
    )
    return user


async def _call(credentials, db):
    return await get_current_user(credentials=credentials, db=db)


@pytest.mark.asyncio
async def test_valid_token_returns_the_user():
    user = _user()
    result = await _call(_credentials(create_access_token(user.id)), _FakeDB(user))
    assert result is user


@pytest.mark.asyncio
async def test_missing_header_is_401():
    with pytest.raises(HTTPException) as raised:
        await _call(None, _FakeDB())
    assert raised.value.status_code == 401


@pytest.mark.asyncio
async def test_garbage_token_is_401():
    with pytest.raises(HTTPException) as raised:
        await _call(_credentials("not-a-token"), _FakeDB())
    assert raised.value.status_code == 401


@pytest.mark.asyncio
async def test_valid_token_for_deleted_user_is_401():
    """The signature still verifies, but the account is gone. Without the
    database lookup the token would keep working as a ghost user."""
    with pytest.raises(HTTPException) as raised:
        await _call(_credentials(create_access_token(uuid.uuid4())), _FakeDB(user=None))
    assert raised.value.status_code == 401


@pytest.mark.asyncio
async def test_disabled_account_is_403_on_every_request():
    """is_active is checked per request, not only at login, so disabling an
    account takes effect immediately instead of when its token expires."""
    user = _user(is_active=False)
    with pytest.raises(HTTPException) as raised:
        await _call(_credentials(create_access_token(user.id)), _FakeDB(user))
    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_response_carries_a_challenge_header():
    with pytest.raises(HTTPException) as raised:
        await _call(None, _FakeDB())
    assert raised.value.headers.get("WWW-Authenticate") == "Bearer"
