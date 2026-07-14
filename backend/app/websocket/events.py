ADMIN_ROOM = "admin"

# new_status/transaction_status alone identifies the next/current team - both
# customer_type flows land on the same status for the same team, so customer_type
# never changes the room (see transaction_status_enum comments in schema.sql).
STATUS_TEAM_ROOM: dict[str, str] = {
    "pending_payment": "payment-queue",
    "pending_settlement": "releasing-queue",
    # Releasing already handed this off (child sent to payment-queue) but still
    # holds a read-only card for it until Payment resolves the child — so it
    # stays routed to releasing-queue rather than dropping out of team rooms.
    "pending_adjustment": "releasing-queue",
    "pending_edit": "receiver-queue",
}


def _rooms_for_status(status: str) -> list[str]:
    team_room = STATUS_TEAM_ROOM.get(status)
    return [team_room, ADMIN_ROOM] if team_room else [ADMIN_ROOM]


def _rooms_for_transition(old_status: str | None, new_status: str) -> list[str]:
    # A transition needs to reach both the team losing the transaction (old_status,
    # e.g. payment-queue when a payment completes) and the team gaining it
    # (new_status, e.g. releasing-queue) — rooming on new_status alone leaves the
    # departing team's queue stuck until they manually refresh.
    rooms = {ADMIN_ROOM}
    for status in (old_status, new_status):
        team_room = STATUS_TEAM_ROOM.get(status)
        if team_room:
            rooms.add(team_room)
    return list(rooms)


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
    return _rooms_for_transition(old_status, new_status), event


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
