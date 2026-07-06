from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.websocket.manager import manager

router = APIRouter()

ROOM_ALLOWED_ROLES: dict[str, set[str]] = {
    "payment-queue": {"payment", "admin"},
    "releasing-queue": {"releasing", "admin"},
    "admin": {"admin"},
}


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

    manager.connect(websocket, room)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, room)
