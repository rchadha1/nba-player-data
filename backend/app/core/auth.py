import json
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from app.core.config import settings

_bearer = HTTPBearer()


def _get_jwt_key():
    """Return the key and algorithm to use for JWT verification."""
    if settings.supabase_jwt_public_key:
        return json.loads(settings.supabase_jwt_public_key), ["ES256"]
    return settings.supabase_jwt_secret, ["HS256"]


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """Validates a Supabase JWT and returns {id, email, role}."""
    token = credentials.credentials
    key, algorithms = _get_jwt_key()
    try:
        payload = jwt.decode(token, key, algorithms=algorithms, audience="authenticated")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")

    return {
        "id": user_id,
        "email": payload.get("email", ""),
        "role": payload.get("app_metadata", {}).get("role", "standard"),
    }


def require_premium(user: dict = Depends(get_current_user)) -> dict:
    """Same as get_current_user but blocks non-premium users."""
    if user.get("role") != "premium":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Premium access required")
    return user
