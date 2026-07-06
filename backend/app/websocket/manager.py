from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {
            "payment-queue": set(),
            "releasing-queue": set(),
            "admin": set(),
        }

    def connect(self, websocket: WebSocket, room: str) -> None:
        self.rooms[room].add(websocket)

    def disconnect(self, websocket: WebSocket, room: str) -> None:
        self.rooms[room].discard(websocket)

    async def broadcast(self, room: str, event: dict) -> None:
        dead_connections = []
        for connection in self.rooms.get(room, set()):
            try:
                await connection.send_json(event)
            except Exception:
                dead_connections.append(connection)

        for connection in dead_connections:
            self.rooms[room].discard(connection)

    async def broadcast_multi(self, rooms: list[str], event: dict) -> None:
        for room in rooms:
            await self.broadcast(room, event)


manager = ConnectionManager()
