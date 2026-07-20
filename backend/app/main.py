from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import engine, get_db
from app.core.security import create_access_token, decode_access_token_soft
from app.routers import admin, auth, customers, payment_methods, products, transactions, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(title="Lash Meatshop POS", lifespan=lifespan)

# LAN-only deployment behind nginx, no public internet exposure.
# Wide open for now; tighten once terminal origins are finalized.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Sliding session: a still-valid token on any authenticated request gets
# reissued with a fresh expiry, so an actively-used terminal is never logged
# out mid-transaction. A terminal that goes genuinely idle (no requests at
# all) gets no refresh and its token expires normally after
# ACCESS_TOKEN_EXPIRE_MINUTES. Stateless — no session store involved, just a
# new JWT handed back on top of the normal response.
@app.middleware("http")
async def refresh_token_middleware(request: Request, call_next):
    response = await call_next(request)

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
        payload = decode_access_token_soft(token)
        if payload is not None:
            payload.pop("exp", None)
            response.headers["X-Refreshed-Token"] = create_access_token(payload)

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
