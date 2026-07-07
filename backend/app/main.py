from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import engine, get_db
from app.routers import auth, customers, products, transactions, ws


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


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"data": None, "error": exc.detail},
        headers=exc.headers,
    )


app.include_router(auth.router)
app.include_router(customers.router)
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
