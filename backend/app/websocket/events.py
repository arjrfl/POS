ADMIN_ROOM = "admin"

# new_status/transaction_status alone identifies the next/current team - both
# customer_type flows land on the same status for the same team, so customer_type
# never changes the room (see transaction_status_enum comments in schema.sql).
STATUS_TEAM_ROOM: dict[str, str] = {
    "pending_payment": "payment-queue",
    "pending_settlement": "releasing-queue",
}


def _rooms_for_status(status: str) -> list[str]:
    team_room = STATUS_TEAM_ROOM.get(status)
    return [team_room, ADMIN_ROOM] if team_room else [ADMIN_ROOM]


def transaction_status_changed(
    transaction_id: int, old_status: str | None, new_status: str, customer_type: str
) -> tuple[list[str], dict]:
    event = {
        "type": "transaction_status_changed",
        "transaction_id": transaction_id,
        "old_status": old_status,
        "new_status": new_status,
        "customer_type": customer_type,
    }
    return _rooms_for_status(new_status), event


def queue_status_changed(
    transaction_id: int, old_queue_status: str, new_queue_status: str, transaction_status: str
) -> tuple[list[str], dict]:
    event = {
        "type": "queue_status_changed",
        "transaction_id": transaction_id,
        "old_queue_status": old_queue_status,
        "new_queue_status": new_queue_status,
        "transaction_status": transaction_status,
    }
    return _rooms_for_status(transaction_status), event
