from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {
            "payment-queue": set(),
            "releasing-queue": set(),
            "receiver-queue": set(),
            "admin": set(),
        }
        # Reference-counted per user_id, independent of room — a page reload
        # closes the old socket and opens a new one for the same user, and
        # ws.py needs to know whether *any* connection for that user is still
        # (or once again) alive before treating it as a real disconnect.
        self._user_connection_counts: dict[int, int] = {}

    def connect(self, websocket: WebSocket, room: str) -> None:
        self.rooms[room].add(websocket)

    def disconnect(self, websocket: WebSocket, room: str) -> None:
        self.rooms[room].discard(websocket)

    def user_connected(self, user_id: int) -> None:
        self._user_connection_counts[user_id] = self._user_connection_counts.get(user_id, 0) + 1

    def user_disconnected(self, user_id: int) -> None:
        remaining = self._user_connection_counts.get(user_id, 0) - 1
        if remaining <= 0:
            self._user_connection_counts.pop(user_id, None)
        else:
            self._user_connection_counts[user_id] = remaining

    def user_has_connection(self, user_id: int) -> bool:
        return self._user_connection_counts.get(user_id, 0) > 0

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
