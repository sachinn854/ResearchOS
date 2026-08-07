"""End-to-end auth flow over real HTTP, with the database faked.

These go through the actual FastAPI app: real routing, real dependency
resolution, real status codes and response bodies. Only the database is
substituted, because the project's Postgres is remote and a test suite should
not need it.

What this catches that the unit tests cannot: whether the endpoints are actually
wired up — the previous auth failed precisely because nothing was enforced at
this layer.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

import main
from backend.db.models.user import User
from backend.db.postgres import get_db


class FakeResult:
    def __init__(self, rows=()):
        self._rows = list(rows)

    def fetchall(self):
        return self._rows


class FakeSession:
    """Minimal stand-in for AsyncSession covering what the auth routes use."""

    def __init__(self, store: dict[str, User]):
        self.store = store          # email -> User
        self._pending: list[User] = []

    def add(self, obj):
        self._pending.append(obj)

    async def commit(self):
        for obj in self._pending:
            if isinstance(obj, User):
                if obj.email in self.store:
                    # Mirror what Postgres' unique index would do, so the route's
                    # IntegrityError branch is genuinely exercised.
                    from sqlalchemy.exc import IntegrityError
                    self._pending.clear()
                    raise IntegrityError("duplicate", None, Exception("unique"))
                # Postgres applies column defaults on INSERT. The fake has to do
                # the same, otherwise `id` and `is_active` stay None and every
                # authenticated request reads the new account as disabled.
                if obj.id is None:
                    obj.id = uuid.uuid4()
                if obj.is_active is None:
                    obj.is_active = True
                self.store[obj.email] = obj
        self._pending.clear()

    async def rollback(self):
        self._pending.clear()

    async def refresh(self, obj):
        return obj

    async def scalar(self, statement):
        """Serves select(User).where(User.email == ...) — the login lookup."""
        params = statement.compile().params
        email = params.get("email_1")
        return self.store.get(email)

    async def get(self, model, key):
        """Serves the get_current_user lookup by primary key."""
        return next((u for u in self.store.values() if u.id == key), None)

    async def execute(self, statement, params=None):
        # The /research/sessions queries. No chat rows in these tests.
        return FakeResult()


@pytest.fixture
def client(monkeypatch):
    store: dict[str, User] = {}

    async def override_get_db():
        yield FakeSession(store)

    main.app.dependency_overrides[get_db] = override_get_db
    # The app's lifespan calls init_collection(), which reaches out to Qdrant.
    # Stubbing it keeps these tests offline while still running the real startup
    # path, so a crash in lifespan would still fail the suite.
    monkeypatch.setattr(main, "init_collection", lambda: None)

    with TestClient(main.app) as test_client:
        test_client.store = store
        yield test_client

    main.app.dependency_overrides.clear()


CREDENTIALS = {"name": "Sachin", "email": "sachin@example.com", "password": "long-enough-pw"}


def _register(client, **overrides):
    return client.post("/auth/register", json={**CREDENTIALS, **overrides})


# --- register --------------------------------------------------------------

def test_register_returns_a_token_and_the_user(client):
    response = _register(client)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "sachin@example.com"
    assert body["user"]["name"] == "Sachin"


def test_register_never_returns_the_password_or_its_hash(client):
    body = _register(client).text

    assert "long-enough-pw" not in body
    assert "hashed_password" not in body
    assert "$2b$" not in body


def test_register_stores_a_hash_not_the_password(client):
    _register(client)
    stored = client.store["sachin@example.com"]

    assert stored.hashed_password != "long-enough-pw"
    assert stored.hashed_password.startswith("$2b$")


def test_register_lowercases_the_email(client):
    """Otherwise Sachin@x.com and sachin@x.com become two accounts and login
    fails for whichever casing the user did not sign up with."""
    response = _register(client, email="SACHIN@Example.COM")

    assert response.json()["user"]["email"] == "sachin@example.com"
    assert "sachin@example.com" in client.store


def test_duplicate_email_is_rejected(client):
    _register(client)
    response = _register(client)

    assert response.status_code == 409


def test_short_password_is_rejected(client):
    assert _register(client, password="short").status_code == 422


def test_invalid_email_is_rejected(client):
    assert _register(client, email="not-an-email").status_code == 422


def test_password_longer_than_bcrypts_limit_is_accepted(client):
    """bcrypt raises above 72 bytes. Without explicit truncation this is a 500."""
    response = _register(client, password="p" * 100)
    assert response.status_code == 201


def test_absurdly_long_password_is_a_clean_422_not_a_crash(client):
    """The schema caps at 200 characters, so this is rejected by validation
    rather than reaching bcrypt."""
    assert _register(client, password="p" * 5000).status_code == 422


# --- login -----------------------------------------------------------------

def test_login_with_correct_password(client):
    _register(client)
    response = client.post("/auth/login", json={
        "email": CREDENTIALS["email"], "password": CREDENTIALS["password"],
    })

    assert response.status_code == 200
    assert response.json()["access_token"]


def test_login_with_wrong_password_is_401(client):
    _register(client)
    response = client.post("/auth/login", json={
        "email": CREDENTIALS["email"], "password": "wrong-password",
    })

    assert response.status_code == 401


def test_login_hides_whether_the_email_exists(client):
    """Both failures must read identically, or the endpoint becomes a way to
    enumerate which addresses are registered."""
    _register(client)

    wrong_password = client.post("/auth/login", json={
        "email": CREDENTIALS["email"], "password": "wrong-password",
    })
    no_such_user = client.post("/auth/login", json={
        "email": "nobody@example.com", "password": "wrong-password",
    })

    assert wrong_password.status_code == no_such_user.status_code == 401
    assert wrong_password.json()["detail"] == no_such_user.json()["detail"]


def test_login_is_case_insensitive_on_email(client):
    _register(client)
    response = client.post("/auth/login", json={
        "email": "SACHIN@EXAMPLE.COM", "password": CREDENTIALS["password"],
    })

    assert response.status_code == 200


def test_disabled_account_cannot_log_in(client):
    _register(client)
    client.store["sachin@example.com"].is_active = False

    response = client.post("/auth/login", json={
        "email": CREDENTIALS["email"], "password": CREDENTIALS["password"],
    })

    assert response.status_code == 403


# --- protected endpoints ---------------------------------------------------

PROTECTED_GETS = ["/auth/me", "/research/sessions", "/research/tasks/abc123"]


@pytest.mark.parametrize("path", PROTECTED_GETS)
def test_no_token_is_401(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", PROTECTED_GETS)
def test_garbage_token_is_401(client, path):
    response = client.get(path, headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_query_endpoints_reject_anonymous_callers(client):
    """The original hole: these were fully open, so the login screen was
    decoration."""
    payload = {"query": "what is RAG?"}

    assert client.post("/research/query", json=payload).status_code == 401
    assert client.post("/research/query/stream", json=payload).status_code == 401
    assert client.post("/research/ingest", json={"source": "x", "title": "y"}).status_code == 401
    assert client.post("/research/ingest/async", json={"source": "x", "title": "y"}).status_code == 401
    assert client.post("/research/upload").status_code == 401


def test_token_from_register_grants_access(client):
    token = _register(client).json()["access_token"]

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "sachin@example.com"


def test_token_from_login_grants_access(client):
    _register(client)
    token = client.post("/auth/login", json={
        "email": CREDENTIALS["email"], "password": CREDENTIALS["password"],
    }).json()["access_token"]

    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_sessions_endpoint_no_longer_accepts_a_user_id(client):
    """Passing someone else's id used to return their chat history. The parameter
    is gone, so supplying it must not change anything."""
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    without = client.get("/research/sessions", headers=headers)
    with_injected = client.get("/research/sessions?user_id=" + str(uuid.uuid4()), headers=headers)

    assert without.status_code == with_injected.status_code == 200
    assert without.json() == with_injected.json() == []


def test_reading_someone_elses_session_is_404(client):
    token = _register(client).json()["access_token"]

    response = client.get(
        "/research/sessions/someone-elses-session/messages",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_disabled_account_is_rejected_mid_token_life(client):
    """is_active is re-checked per request, so disabling an account takes effect
    immediately rather than when its token expires."""
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/auth/me", headers=headers).status_code == 200

    client.store["sachin@example.com"].is_active = False

    assert client.get("/auth/me", headers=headers).status_code == 403


def test_health_stays_public(client):
    """Needed by Render's health check, which sends no token."""
    assert client.get("/health").status_code == 200
