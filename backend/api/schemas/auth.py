from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    # EmailStr rejects malformed addresses before they reach the database, where
    # the unique constraint would otherwise happily store "not an email".
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    # 8 is a floor, not a policy. Enforced here rather than in the frontend,
    # because the frontend is not the only thing that can call this endpoint.
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class UserResponse(BaseModel):
    # Deliberately does not include hashed_password. This model is what defines
    # the response body, so the hash cannot leak by someone returning the ORM
    # object directly.
    id: str
    email: str
    name: str
    created_at: datetime | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
