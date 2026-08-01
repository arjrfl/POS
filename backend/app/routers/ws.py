import asyncio

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.core.database import AsyncSessionLocal
from app.core.security import decode_access_token
from app.services import transaction_service
from app.websocket.manager import manager

router = APIRouter()

ROOM_ALLOWED_ROLES: dict[str, set[str]] = {
    "payment-queue": {"payment", "admin"},
    "releasing-queue": {"releasing", "admin"},
    "admin": {"admin"},
    "receiver": {"receiver", "admin"},
    "operations": {"operations", "admin"},
}

# A page reload closes the old socket and opens a new one for the same user
# within well under a second on this LAN (no internet round-trip involved) —
# releasing immediately on every disconnect would drop a reloading payment
# member's in-progress hold before their new connection has a chance to land.
# This grace period lets a reload's reconnect "cancel" the pending release;
# someone who actually closes the tab for good still gets released shortly after.
RECONNECT_GRACE_SECONDS = 5


@router.websocket("/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str, token: str | None = Query(default=None)):
    # Accept first: a close() sent before accept() only ever reaches the client
    # as an opaque HTTP-level rejection (browsers can't even read the status),
    # so validation failures are reported via a real post-accept close code instead.
    await websocket.accept()

    if room not in manager.rooms:
        await websocket.close(code=4004)
        return

    if not token:
        await websocket.close(code=4001)
        return

    try:
        payload = decode_access_token(token)
    except HTTPException:
        await websocket.close(code=4001)
        return

    if payload.get("role_name") not in ROOM_ALLOWED_ROLES[room]:
        await websocket.close(code=4003)
        return

    user_id = payload.get("user_id")

    manager.connect(websocket, room)
    if user_id is not None:
        manager.user_connected(user_id)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, room)

        if user_id is not None:
            manager.user_disconnected(user_id)

            # Give a reload's new connection a chance to land before treating
            # this as a real disconnect. The WS's own request scope is tearing
            # down along with the connection, so releasing needs a fresh session.
            await asyncio.sleep(RECONNECT_GRACE_SECONDS)
            if not manager.user_has_connection(user_id):
                async with AsyncSessionLocal() as session:
                    await transaction_service.release_processing_transactions(session, user_id)
