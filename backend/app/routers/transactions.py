from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.transaction import (
    CustomerTypeEnum,
    ItemTypeEnum,
    QueueStatusEnum,
    TransactionStatusEnum,
    TransactionTypeEnum,
)
from app.schemas.transaction import (
    DraftPaymentSaveRequest,
    PaymentProcessRequest,
    SubstandardOutcomeRequest,
    TransactionCreate,
    TransactionItemEditRequest,
    WeightConfirmRequest,
)
from app.services import transaction_service
from app.websocket.events import transaction_status_changed
from app.websocket.manager import manager

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_role("receiver"))])
async def create_transaction(
    payload: TransactionCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.create_transaction(db, payload, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=None,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    return {"data": transaction, "error": None}


@router.get("")
async def list_transactions(
    status_filter: TransactionStatusEnum | None = Query(default=None, alias="status"),
    queue_status_filter: QueueStatusEnum | None = Query(default=None, alias="queue_status"),
    processing_by: str | None = Query(default=None),
    customer_type: CustomerTypeEnum | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    payment_user_id: int | None = Query(default=None),
    date_from_filter: date | None = Query(default=None, alias="date_from"),
    date_to_filter: date | None = Query(default=None, alias="date_to"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    include_payment_status: bool = Query(default=False),
    payment_status_filter: Literal["full", "partial", "voided", "pending"] | None = Query(
        default=None, alias="payment_status"
    ),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role_name = current_user.get("role_name")
    walkin_user_id = None
    processing_by_user_id = None

    if processing_by == "me":
        if role_name not in ("payment", "receiver"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        processing_by_user_id = current_user["user_id"]
        queue_status_filter = QueueStatusEnum.processing

    if role_name == "admin":
        pass  # no forced filter — admin sees everything
    elif role_name == "receiver":
        # own transactions only — Receiver has no queue of its own
        walkin_user_id = current_user["user_id"]
    elif role_name in transaction_service.ROLE_QUEUE_LIST_STATUSES:
        # a list even for single-status roles — list_transactions accepts either
        # and this keeps one code path for the "releasing also sees
        # pending_adjustment" case instead of special-casing just that role
        status_filter = transaction_service.ROLE_QUEUE_LIST_STATUSES[role_name]
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")

    # date_to is inclusive of the whole day, so the actual upper bound is midnight
    # the day after — matches date_from's own midnight-start convention.
    walkin_at_from = (
        datetime.combine(date_from_filter, time.min, tzinfo=timezone.utc) if date_from_filter is not None else None
    )
    walkin_at_to = (
        datetime.combine(date_to_filter, time.min, tzinfo=timezone.utc) + timedelta(days=1)
        if date_to_filter is not None
        else None
    )

    result = await transaction_service.list_transactions(
        db,
        page=page,
        page_size=page_size,
        transaction_status=status_filter,
        queue_status=queue_status_filter,
        customer_type=customer_type,
        customer_id=customer_id,
        search=search,
        payment_user_id=payment_user_id,
        walkin_user_id=walkin_user_id,
        processing_by_user_id=processing_by_user_id,
        walkin_at_from=walkin_at_from,
        walkin_at_to=walkin_at_to,
        include_payment_status=include_payment_status,
        payment_status_filter=payment_status_filter,
    )
    return {"data": result, "error": None}


@router.get("/history", dependencies=[Depends(get_current_user)])
async def get_transaction_history(db: AsyncSession = Depends(get_db)):
    history = await transaction_service.get_transaction_history(db)
    return {"data": history, "error": None}


@router.get("/{transaction_id}", dependencies=[Depends(get_current_user)])
async def get_transaction(transaction_id: int, db: AsyncSession = Depends(get_db)):
    try:
        transaction = await transaction_service.get_transaction(db, transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return {"data": transaction, "error": None}


@router.get("/{transaction_id}/chain", dependencies=[Depends(get_current_user)])
async def get_transaction_chain(transaction_id: int, db: AsyncSession = Depends(get_db)):
    try:
        chain = await transaction_service.get_transaction_chain(db, transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return {"data": chain, "error": None}


@router.post("/{transaction_id}/grab", dependencies=[Depends(require_role("payment", "releasing", "receiver"))])
async def grab_transaction(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.grab_transaction(
            db, transaction_id, current_user["user_id"], current_user["role_name"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/park", dependencies=[Depends(require_role("payment", "releasing"))])
async def park_transaction(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.park_transaction(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/release", dependencies=[Depends(require_role("payment", "releasing", "receiver"))])
async def release_transaction(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.release_transaction(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/unpark", dependencies=[Depends(require_role("payment", "releasing"))])
async def unpark_transaction(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.unpark_transaction(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.put("/{transaction_id}/payment-drafts", dependencies=[Depends(require_role("payment"))])
async def save_draft_payments(
    transaction_id: int,
    payload: DraftPaymentSaveRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        drafts = await transaction_service.save_draft_payments(
            db,
            transaction_id,
            payload.entries,
            current_user["user_id"],
            balances_to_settle=payload.draft_balances_to_settle,
            credit_entries_checked=payload.credit_entries_checked,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": drafts, "error": None}


@router.patch("/{transaction_id}/items", dependencies=[Depends(require_role("payment"))])
async def edit_transaction_items(
    transaction_id: int,
    payload: TransactionItemEditRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.edit_transaction_items(
            db, transaction_id, payload, current_user["user_id"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.ItemEditValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/revert-items", dependencies=[Depends(require_role("payment"))])
async def revert_transaction_items(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.revert_transaction_items(
            db, transaction_id, current_user["user_id"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.ItemEditValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


# This endpoint still fully supports transaction_type == 'refund' transactions
# (cash/online payout through the normal payment flow) — intentionally left in
# place, but Payment's UI no longer opens PaymentModal for refund children
# (see POST /{transaction_id}/resolve-as-credit below). May be re-enabled in
# the UI later if a cash-refund option is needed again.
@router.post("/{transaction_id}/pay", dependencies=[Depends(require_role("payment"))])
async def process_payment(
    transaction_id: int,
    payload: PaymentProcessRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        current = await transaction_service.get_transaction(db, transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    # balance-settlement-only orders, and adjustment/refund children generated by
    # Releasing (which have no items of their own — see resolve_substandard), both
    # skip Releasing entirely once paid
    skip_releasing = current.transaction_type != TransactionTypeEnum.original or (
        bool(current.items) and all(item.item_type == ItemTypeEnum.balance_settlement for item in current.items)
    )

    try:
        transaction = await transaction_service.process_payment(
            db, transaction_id, payload, current_user["user_id"], skip_releasing=skip_releasing
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.PaymentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/confirm-weight", dependencies=[Depends(require_role("releasing"))])
async def confirm_weight(
    transaction_id: int,
    payload: WeightConfirmRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.confirm_weight(db, transaction_id, payload, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except transaction_service.WeightConfirmValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/confirm-ready", dependencies=[Depends(require_role("releasing"))])
async def confirm_items_ready(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.confirm_items_ready(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/resolve", dependencies=[Depends(require_role("releasing"))])
async def resolve_substandard(
    transaction_id: int,
    payload: SubstandardOutcomeRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.resolve_substandard(
            db, transaction_id, payload, current_user["user_id"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except transaction_service.SubstandardValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/complete-exact", dependencies=[Depends(require_role("releasing"))])
async def complete_exact(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.complete_exact(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except transaction_service.WeightConfirmValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except transaction_service.SubstandardValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": transaction, "error": None}


@router.get("/{transaction_id}/handover-outcome", dependencies=[Depends(require_role("releasing"))])
async def get_handover_outcome(
    transaction_id: int,
    db: AsyncSession = Depends(get_db),
):
    try:
        outcome = await transaction_service.get_handover_outcome(db, transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": outcome, "error": None}


@router.post("/{transaction_id}/confirm-handover", dependencies=[Depends(require_role("releasing"))])
async def confirm_handover(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.confirm_handover(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/complete-online", dependencies=[Depends(require_role("releasing"))])
async def complete_online(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.complete_online(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


@router.post("/{transaction_id}/resolve-as-credit", dependencies=[Depends(require_role("payment"))])
async def resolve_refund_as_credit(
    transaction_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transaction = await transaction_service.resolve_refund_as_credit(db, transaction_id, current_user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except transaction_service.QueuePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except transaction_service.QueueConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"data": transaction, "error": None}


