from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine, get_db
from app.core.security import create_access_token, decode_access_token_soft
from app.models.user import User
from app.routers import admin, auth, customers, payment_methods, products, transactions, users, ws
from app.services.scheduler_service import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler_task = start_scheduler()
    yield
    scheduler_task.cancel()
    await engine.dispose()


app = FastAPI(title="Lash Meatshop POS", lifespan=lifespan)

# LAN-only deployment behind nginx, no public internet exposure. Allowed
# origins come from CORS_ALLOWED_ORIGINS (see app/core/config.py) — never a
# wildcard. allow_credentials stays False: auth is a Bearer JWT via the
# Authorization header, not cookies, so there's nothing for credentialed
# CORS to protect here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Refreshed-Token"],
)


# Sliding session: a still-valid token on any authenticated request gets
# reissued with a fresh expiry, so an actively-used terminal is never logged
# out mid-transaction. A terminal that goes genuinely idle (no requests at
# all) gets no refresh and its token expires normally after
# ACCESS_TOKEN_EXPIRE_MINUTES. Stateless — no session store involved, just a
# new JWT handed back on top of the normal response.
#
# is_active is re-verified against the DB on every request here (never
# trusted from the JWT — the token doesn't even carry it, see
# create_access_token's claims). This runs before call_next so a
# deactivated account is rejected before the route handler executes, not
# just denied a refreshed token after the fact — applies to every router
# uniformly since this is global HTTP middleware, not a per-route
# dependency. WebSocket connections are a separate ASGI path and aren't
# covered by this middleware — see CLAUDE.md Session management.
@app.middleware("http")
async def refresh_token_middleware(request: Request, call_next):
    auth_header = request.headers.get("Authorization")
    refreshed_token = None

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
        payload = decode_access_token_soft(token)
        if payload is not None:
            async with AsyncSessionLocal() as db:
                is_active = await db.scalar(select(User.is_active).where(User.id == payload.get("user_id")))

            if is_active is not True:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={
                        "data": None,
                        "error": "Your account has been deactivated. Please contact an administrator.",
                    },
                )

            payload.pop("exp", None)
            refreshed_token = create_access_token(payload)

    response = await call_next(request)

    if refreshed_token:
        response.headers["X-Refreshed-Token"] = refreshed_token

    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"data": None, "error": exc.detail},
        headers=exc.headers,
    )


app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(customers.router)
app.include_router(payment_methods.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(users.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}


@app.get("/api/db-health")
async def db_health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
