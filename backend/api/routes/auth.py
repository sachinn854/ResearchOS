import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.dependencies.auth import get_current_user
from backend.api.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from backend.core.security import create_access_token, hash_password, verify_password
from backend.db.models.user import User
from backend.db.postgres import get_db

log = logging.getLogger("researchos.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        created_at=user.created_at,
    )


def _issue(user: User) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(user.id), user=_to_response(user))


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Create an account and return a token, so the user is signed in already."""
    # Emails are stored lowercase so that Sachin@x.com and sachin@x.com are the
    # same account. Without this the unique index treats them as two accounts and
    # login silently fails for whichever casing you did not sign up with.
    email = payload.email.lower().strip()

    user = User(
        email=email,
        name=payload.name.strip(),
        hashed_password=hash_password(payload.password),
        # Set explicitly even though the column has default=True. SQLAlchemy
        # applies that default at INSERT, so until the flush the attribute is
        # None — and anything reading user.is_active before then (an is_active
        # guard, a response model) would see a new account as disabled.
        is_active=True,
    )
    db.add(user)

    try:
        await db.commit()
    except IntegrityError:
        # We rely on the unique index rather than a "does this email exist?"
        # SELECT first. Two simultaneous signups would both pass that check and
        # only the database can actually settle the race.
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    await db.refresh(user)
    log.info("[auth] registered user=%s", email)
    return _issue(user)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.lower().strip()
    user = await db.scalar(select(User).where(User.email == email))

    # One message for both "no such email" and "wrong password". Saying which one
    # was wrong tells an attacker which addresses are registered.
    if user is None or not verify_password(payload.password, user.hashed_password):
        log.info("[auth] failed login for %s", email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been disabled")

    log.info("[auth] login ok user=%s", email)
    return _issue(user)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Who the current token belongs to.

    The frontend calls this on load to check whether a stored token is still
    good, instead of trusting whatever user object it cached in localStorage.
    """
    return _to_response(current_user)
