-- =============================================================
-- LASH MEATSHOP POS DATABASE SCHEMA
-- PostgreSQL version
--
-- Assumes it is run against an already-existing, already-connected
-- database (POSTGRES_DB via docker-entrypoint-initdb.d, or `psql -d
-- lash_meatshop_db -f schema.sql` manually) — it does not create or
-- connect to the database itself.
-- =============================================================

-- =============================================================
-- REUSABLE TRIGGER FUNCTION FOR updated_at
-- Write once, applied to every table that needs it
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- ENUMS
-- Enforces allowed values at the database level
-- =============================================================

CREATE TYPE customer_status_enum AS ENUM (
    'active',
    'inactive'
);

CREATE TYPE product_status_enum AS ENUM (
    'active',
    'inactive'
);

CREATE TYPE customer_type_enum AS ENUM (
    'walk_in',
    'online'
);

CREATE TYPE transaction_status_enum AS ENUM (
    'pending_payment',
    -- walk_in:  Walk-In done, waiting for Team Payment
    -- online:   Releasing done, waiting for Team Payment
    'pending_settlement',
    -- walk_in:  Payment done, waiting for Team Releasing to confirm weight
    -- online:   Walk-In done, goes DIRECTLY to Releasing (skips Payment first)
    'pending_adjustment',
    -- Releasing confirmed variance, child adjustment/refund sent to Payment
    -- queue, waiting for Payment to resolve
    'settled',
    -- Payment has resolved the adjustment/refund child (paid in full,
    --   partially paid, or saved as credit). Parent is waiting for
    --   Releasing's final handover confirmation before moving to 'completed'.
    'pending_handover',
    -- online only: Payment has confirmed payment for the order.
    -- Waiting on Releasing's final confirmation before the
    -- transaction moves to 'completed'. Distinct from 'settled',
    -- which is reserved for substandard adjustment/refund resolution.
    'completed',
    -- Fully done, no pending actions
    'voided'
    -- Cancelled
);

CREATE TYPE transaction_type_enum AS ENUM (
    'original',           -- standard / first transaction
    'adjustment',         -- substandard: customer pays extra
    'refund',             -- substandard: store returns money
    'balance_settlement'  -- customer paying their utang
);

CREATE TYPE queue_status_enum AS ENUM (
    'waiting',    -- in queue, available for any team member to grab
    'processing', -- claimed by a team member, locked from others
    'parked',     -- temporarily set aside (e.g. customer online payment pending)
    'done'        -- phase completed, moved to next queue
);

CREATE TYPE item_type_enum AS ENUM (
    'product',            -- regular order item
    'balance_settlement', -- paying off utang from a previous transaction
    'credit_usage'        -- using stored credit (deduction)
);

CREATE TYPE ledger_entry_type_enum AS ENUM (
    'balance_added',    -- releasing found item heavier, customer chose utang
    'balance_settled',  -- customer paid off utang
    'credit_added',     -- releasing found item lighter, customer chose to save as credit
    'credit_used',      -- customer applied credit to a transaction
    'credit_auto_used'  -- system auto-deducted credit to cover balance at releasing
);

CREATE TYPE audit_change_type_enum AS ENUM (
    'transaction_status', -- phase moved (e.g. pending_payment → pending_settlement)
    'queue_status'        -- queue state changed (e.g. waiting → processing)
);

CREATE TYPE product_change_type_enum AS ENUM (
    'created',
    'updated',
    'stock_adjusted',
    'deactivated',
    'reactivated'
);

CREATE TYPE user_change_type_enum AS ENUM (
    'created',
    'updated',
    'deactivated',
    'reactivated',
    'password_reset'
);

-- =============================================================
-- ROLE
-- =============================================================
CREATE TABLE role (
    id        SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
    -- 'receiver' | 'payment' | 'releasing' | 'admin'
);

-- =============================================================
-- USER
-- =============================================================
CREATE TABLE "user" (
    id            SERIAL PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT          NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON "user"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- USER AUDIT LOG
-- Tracks every create/update/status/password-reset change on a user
-- account. Full traceability: who did what, when, and what changed.
-- =============================================================
CREATE TABLE user_audit_log (
    id                 SERIAL PRIMARY KEY,
    user_id            INT                    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    -- the user this entry is ABOUT — cascades if that user is ever hard-deleted
    changed_by_user_id INT                    NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    -- the admin who performed the action
    change_type        user_change_type_enum  NOT NULL,
    old_value          TEXT                   NULL,     -- JSON, only changed fields, NULL for 'created'
    new_value          TEXT                   NOT NULL, -- JSON, only changed fields
    -- CRITICAL: password_hash must never appear in old_value/new_value, in any form.
    -- 'password_reset' entries log new_value = '{"password_reset": true}' only.
    notes              TEXT                   NULL,
    changed_at         TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ual_user        ON user_audit_log (user_id);
CREATE INDEX idx_ual_change_type ON user_audit_log (change_type);

-- =============================================================
-- CUSTOMER
-- =============================================================
CREATE TABLE customer (
    id              SERIAL PRIMARY KEY,
    full_name       VARCHAR(100)         NOT NULL,
    address         VARCHAR(255),
    contact_number  VARCHAR(20),
    customer_status customer_status_enum NOT NULL DEFAULT 'active',

    -- NET ledger balance (always up to date)
    -- positive = customer has CREDIT (store owes customer)
    -- negative = customer has BALANCE/utang (customer owes store)
    net_balance     DECIMAL(10,2)        NOT NULL DEFAULT 0.00,

    created_by_user_id INT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    -- which user created this customer record
    -- NULL for customers created before this column existed (no backfill)
    -- set at insert time going forward from the "Add Customer" flow

    created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_status ON customer (customer_status);

CREATE TRIGGER trg_customer_updated_at
    BEFORE UPDATE ON customer
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- PRODUCT
-- =============================================================
CREATE TABLE product (
    id              SERIAL PRIMARY KEY,
    product_name    VARCHAR(100)        NOT NULL,
    brand_name      VARCHAR(100),
    unit_weight_kg  DECIMAL(10,3),               -- expected weight per unit/box
    unit_price_php  DECIMAL(10,2)       NOT NULL, -- price per kg
    stock_quantity  DECIMAL(10,3)       NOT NULL DEFAULT 0,
    -- decremented at Releasing handover as actual_unit_count x unit_weight_kg
    -- (falls back to actual_weight_kg when unit_weight_kg is NULL — see
    -- transaction_item.actual_unit_count below and transaction_service.py)
    product_status  product_status_enum NOT NULL DEFAULT 'active',

    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_status ON product (product_status);

CREATE TRIGGER trg_product_updated_at
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- PRODUCT AUDIT LOG
-- Tracks every create/update/stock/status change on a product.
-- Full traceability: who did what, when, and what changed.
-- =============================================================
CREATE TABLE product_audit_log (
    id                 SERIAL PRIMARY KEY,
    product_id         INT                       NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    changed_by_user_id INT                       NOT NULL REFERENCES "user"(id)   ON DELETE RESTRICT,
    change_type        product_change_type_enum  NOT NULL,
    old_value          TEXT                      NULL,     -- JSON, only changed fields, NULL for 'created'
    new_value          TEXT                      NOT NULL, -- JSON, only changed fields
    stock_delta        DECIMAL(10,3)             NULL,     -- only for 'stock_adjusted', signed (+/-)
    notes              TEXT                      NULL,
    changed_at         TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pal_product     ON product_audit_log (product_id);
CREATE INDEX idx_pal_change_type ON product_audit_log (change_type);

-- =============================================================
-- PAYMENT METHOD
-- e.g. 'cash', 'gcash', 'maya', 'bank_transfer'
-- =============================================================
CREATE TABLE payment_method (
    id                  SERIAL PRIMARY KEY,
    payment_method_name VARCHAR(50) NOT NULL UNIQUE
);

-- =============================================================
-- SALES TRANSACTION
-- One record per transaction. Adjustments and refunds are
-- also rows here, linked via parent_transaction_id.
-- =============================================================
CREATE TABLE sales_transaction (
    id                    SERIAL PRIMARY KEY,
    order_number          VARCHAR(50)              NOT NULL UNIQUE,

    -- relationships
    parent_transaction_id INT                      NULL REFERENCES sales_transaction(id) ON DELETE RESTRICT,
    -- NULL for originals; points to the original for adjustments/refunds

    transaction_type      transaction_type_enum    NOT NULL,
    transaction_status    transaction_status_enum  NOT NULL,

    -- customer channel — determines the workflow order
    customer_type         customer_type_enum       NOT NULL DEFAULT 'walk_in',
    -- 'walk_in' → Walk-In → Payment → Releasing
    -- 'online'  → Walk-In → Releasing → Payment (ship)

    -- team members who touched this transaction
    walkin_user_id        INT                      NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    payment_user_id       INT                      NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    releasing_user_id     INT                      NULL REFERENCES "user"(id) ON DELETE RESTRICT,

    customer_id           INT                      NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,

    -- amounts
    estimated_amount      DECIMAL(10,2)            NOT NULL DEFAULT 0.00,
    -- total as computed at Walk-In phase (what customer is expected to pay)
    -- = SUM(unit_price × unit_weight_kg × unit_count) for all product items

    actual_amount         DECIMAL(10,2)            NULL,
    -- filled in by Releasing after weight confirmation
    -- NULL until releasing confirms
    -- for online orders: set equal to estimated_amount by confirm_items_ready

    balance_due           DECIMAL(10,2)            GENERATED ALWAYS AS (
                              CASE
                                  WHEN actual_amount IS NOT NULL
                                  THEN actual_amount - estimated_amount
                                  ELSE NULL
                              END
                          ) STORED,
    -- positive = customer owes more (adjustment needed)
    -- negative = store owes customer (refund needed)
    -- zero     = exact weight, no action needed

    -- credit/balance applied at Walk-In phase
    credit_applied        DECIMAL(10,2)            NOT NULL DEFAULT 0.00,
    -- amount of customer's existing credit used in this transaction

    balance_settled       DECIMAL(10,2)            NOT NULL DEFAULT 0.00,
    -- amount of customer's existing utang added to this transaction

    -- final amount customer actually pays at Team Payment
    -- walk_in: estimated_amount + balance_settled - credit_applied
    -- online:  actual_amount (set by Releasing) + balance_settled - credit_applied
    total_due             DECIMAL(10,2)            NOT NULL DEFAULT 0.00,

    -- payment details (filled by Team Payment)
    cash_tendered         DECIMAL(10,2)            NOT NULL DEFAULT 0.00,
    -- physical cash handed by customer at payment time
    -- only relevant when payment includes a cash portion

    change_given          DECIMAL(10,2)            NOT NULL DEFAULT 0.00,
    -- change returned to customer
    -- = cash_tendered - cash portion of total_due

    change_claimed        BOOLEAN                  NOT NULL DEFAULT TRUE,
    -- TRUE  = customer took the change as cash (normal case)
    -- FALSE = customer declined, change was added to customer.net_balance
    --         as credit instead
    -- Only meaningful when change_given > 0; defaults TRUE for all
    -- transactions with no change or where change is simply handed back

    invoice_pdf           VARCHAR(255)             NULL,

    -- timestamps per phase
    walkin_at             TIMESTAMPTZ              NULL,
    payment_at            TIMESTAMPTZ              NULL,
    releasing_at          TIMESTAMPTZ              NULL,

    -- =========================================================
    -- QUEUE CONTROL
    -- Prevents two team members from grabbing the same transaction
    -- =========================================================
    queue_status          queue_status_enum        NOT NULL DEFAULT 'waiting',
    -- resets to 'waiting' each time transaction moves to next phase

    processing_by_user_id INT                      NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    -- which team member currently has this transaction locked
    -- NULL when queue_status is 'waiting', 'parked', or 'done'

    processing_started_at TIMESTAMPTZ              NULL,
    -- when the team member grabbed it
    -- useful for admin to detect stuck/abandoned transactions

    parked_by_user_id     INT                      NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    -- who parked this transaction (accountability)
    -- NULL when queue_status is not 'parked'

    parked_at             TIMESTAMPTZ              NULL,
    -- when the transaction was parked
    -- admin can flag transactions parked beyond a threshold (e.g. 30 mins)
    -- reset to NULL when transaction is unparked

    original_items_snapshot TEXT                   NULL,
    -- JSON-serialized list of this transaction's product-type transaction_item
    -- rows, captured ONCE — the very first time Payment's Edit Items feature is
    -- confirmed for this transaction. Exists so "Revert All" can restore all the
    -- way back to what Receiver originally listed, even across multiple Confirm
    -- Edits calls and modal reopens.
    -- Cleared back to NULL once the transaction successfully completes payment
    -- (POST /{id}/pay) — no longer needed once Payment phase is done for this
    -- transaction.

    created_at            TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_st_parent_transaction   ON sales_transaction (parent_transaction_id);
CREATE INDEX idx_st_transaction_status   ON sales_transaction (transaction_status);
CREATE INDEX idx_st_transaction_type     ON sales_transaction (transaction_type);
CREATE INDEX idx_st_customer             ON sales_transaction (customer_id);
CREATE INDEX idx_st_queue_status         ON sales_transaction (queue_status);
CREATE INDEX idx_st_customer_type        ON sales_transaction (customer_type);
CREATE INDEX idx_st_processing_by        ON sales_transaction (processing_by_user_id);
CREATE INDEX idx_st_parked_by            ON sales_transaction (parked_by_user_id);

CREATE TRIGGER trg_sales_transaction_updated_at
    BEFORE UPDATE ON sales_transaction
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- TRANSACTION ITEM
-- Line items of a transaction.
-- Includes regular product items, balance settlement lines,
-- and credit usage lines.
-- =============================================================
CREATE TABLE transaction_item (
    id                       SERIAL PRIMARY KEY,
    transaction_id           INT            NOT NULL REFERENCES sales_transaction(id) ON DELETE CASCADE,

    item_type                item_type_enum NOT NULL DEFAULT 'product',
    -- 'product'            → regular order item
    -- 'balance_settlement' → paying off utang from a previous transaction
    -- 'credit_usage'       → using stored credit (deduction)

    -- for product items
    product_id               INT            NULL REFERENCES product(id) ON DELETE RESTRICT,

    unit_count               INT            NULL,
    -- number of units/boxes ordered (product items only)
    -- NULL for balance_settlement and credit_usage items

    estimated_weight_kg      DECIMAL(10,3)  NULL,
    -- pre-filled from product.unit_weight_kg at Walk-In, editable by Receiver
    -- purely an estimate for reference — does NOT drive subtotal
    -- NULL for balance_settlement and credit_usage items, and may be left NULL for product items

    quantity_kg              DECIMAL(10,3)  NULL,
    -- QTY — the value that actually drives subtotal for product items
    -- defaults to Estimated Weight or Unit Count depending on which the
    -- Receiver last edited, but is always freely overridable
    -- NULL for balance_settlement and credit_usage items

    actual_weight_kg         DECIMAL(10,3)  NULL,
    -- confirmed by Releasing team after physical weighing
    -- NULL until Releasing confirms
    -- NULL for balance_settlement and credit_usage items
    -- reference only — actual_quantity_kg still drives pricing/variance/
    -- balance_due, UNCHANGED. Used as the stock-decrement basis only as a
    -- fallback when product.unit_weight_kg is NULL — see actual_unit_count

    unit_price               DECIMAL(10,2)  NULL,
    -- price per kg at time of transaction
    -- snapshotted from product.unit_price_php at Walk-In
    -- NULL for balance_settlement and credit_usage items

    -- for balance_settlement and credit_usage items
    reference_transaction_id INT            NULL REFERENCES sales_transaction(id) ON DELETE RESTRICT,
    -- points to which transaction this balance/credit came from
    -- NULL for product items

    subtotal                 DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    -- product items:            unit_price × quantity_kg
    -- balance_settlement items: positive amount (adds to total_due)
    -- credit_usage items:       negative amount (deducts from total_due)

    actual_unit_count        INT            NULL,
    -- confirmed by Releasing team after physical count
    -- NULL until Releasing confirms
    -- NULL for balance_settlement and credit_usage items
    -- drives STOCK DECREMENT (see product.stock_quantity above and
    -- transaction_service.py) — does NOT drive pricing/variance;
    -- actual_quantity_kg still does that, UNCHANGED

    actual_quantity_kg       DECIMAL(10,3)  NULL,
    -- confirmed by Releasing, mirrors quantity_kg (QTY), THIS drives
    -- actual_subtotal — new variance baseline
    -- NULL for balance_settlement and credit_usage items

    actual_subtotal          DECIMAL(10,2)  NOT NULL DEFAULT 0.00
    -- actual_quantity_kg × unit_price, per-item actual amount
    -- NULL/0.00 for balance_settlement and credit_usage items
);

CREATE INDEX idx_ti_transaction ON transaction_item (transaction_id);
CREATE INDEX idx_ti_item_type   ON transaction_item (item_type);

-- =============================================================
-- PAYMENT DETAIL
-- Supports split payment (e.g. part cash, part GCash)
-- =============================================================
CREATE TABLE payment_detail (
    id                SERIAL PRIMARY KEY,
    transaction_id    INT           NOT NULL REFERENCES sales_transaction(id) ON DELETE CASCADE,
    payment_method_id INT           NOT NULL REFERENCES payment_method(id)    ON DELETE RESTRICT,
    ref_number        VARCHAR(100)  NULL,         -- for online payment reference (GCash, Maya, etc.)
    tendered_amount   DECIMAL(10,2) NULL,         -- only for cash rows; NULL for online
    amount            DECIMAL(10,2) NOT NULL,     -- actual amount credited for this method
    is_draft          BOOLEAN       NOT NULL DEFAULT FALSE,
    -- TRUE  = entered during payment process, not yet confirmed
    --         persists through park/unpark cycles
    -- FALSE = confirmed final payment record

    draft_balances_json   TEXT          NULL,
    -- Only used on is_draft=TRUE rows (first row of a save only)
    -- JSON-serialized list of {source_transaction_id, ledger_entry_id, amount}
    -- balance settlements checked at time of parking
    -- NULL on confirmed rows and non-first draft rows

    draft_credit_applied  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    -- Only used on is_draft=TRUE rows
    -- Stores the credit_applied amount at time of parking
    -- 0.00 on confirmed (is_draft=FALSE) rows

    draft_credit_sources_json TEXT NULL,
    -- Only used on is_draft=TRUE rows (first row of a save only)
    -- JSON-serialized list of {source_transaction_id, order_number,
    -- ledger_entry_id, amount} — which credit_added entries were
    -- consumed to cover draft_credit_applied
    -- NULL on confirmed rows and non-first draft rows

    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pd_transaction ON payment_detail (transaction_id);

-- =============================================================
-- CUSTOMER LEDGER
-- Append-only log of every credit/balance movement per customer.
-- net_balance on customer table is always the running sum of this.
-- =============================================================
CREATE TABLE customer_ledger (
    id              SERIAL PRIMARY KEY,
    customer_id     INT                    NOT NULL REFERENCES customer(id)           ON DELETE RESTRICT,
    transaction_id  INT                    NOT NULL REFERENCES sales_transaction(id)  ON DELETE CASCADE,

    entry_type      ledger_entry_type_enum NOT NULL,
    -- 'balance_added'    → releasing found item heavier, customer chose utang
    -- 'balance_settled'  → customer paid off utang (via Walk-In line item or standalone)
    -- 'credit_added'     → releasing found item lighter, customer chose to save as credit
    -- 'credit_used'      → customer applied credit to a transaction at Walk-In
    -- 'credit_auto_used' → system auto-deducted credit to cover balance at Releasing

    amount          DECIMAL(10,2)          NOT NULL,
    -- always positive; entry_type tells you the direction

    running_balance DECIMAL(10,2)          NOT NULL,
    -- snapshot of customer.net_balance after this entry was applied
    -- positive = credit (store owes customer)
    -- negative = utang (customer owes store)

    notes           VARCHAR(255)           NULL,
    created_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cl_customer    ON customer_ledger (customer_id);
CREATE INDEX idx_cl_transaction ON customer_ledger (transaction_id);

-- =============================================================
-- TRANSACTION VOID LOG
-- Only for voided transactions. Requires supervisor action.
-- =============================================================
CREATE TABLE transaction_void_log (
    id                SERIAL PRIMARY KEY,
    transaction_id    INT         NOT NULL REFERENCES sales_transaction(id) ON DELETE CASCADE,
    void_reason       TEXT        NOT NULL,
    voided_by_user_id INT         NOT NULL REFERENCES "user"(id)            ON DELETE RESTRICT,
    voided_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TRANSACTION AUDIT LOG
-- Tracks every status AND queue status change on a transaction.
-- Full traceability: who did what, when, and at which phase.
-- =============================================================
CREATE TABLE transaction_audit_log (
    id                 SERIAL PRIMARY KEY,
    transaction_id     INT                    NOT NULL REFERENCES sales_transaction(id) ON DELETE CASCADE,
    changed_by_user_id INT                    NOT NULL REFERENCES "user"(id)            ON DELETE RESTRICT,

    change_type        audit_change_type_enum NOT NULL,
    -- 'transaction_status' → phase moved (e.g. pending_payment → pending_settlement)
    -- 'queue_status'       → queue state changed (e.g. waiting → processing)

    old_value          VARCHAR(50)            NULL,     -- previous value
    new_value          VARCHAR(50)            NOT NULL, -- new value

    notes              TEXT                   NULL,
    changed_at         TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tal_transaction ON transaction_audit_log (transaction_id);
CREATE INDEX idx_tal_change_type ON transaction_audit_log (change_type);

-- =============================================================
-- SEED DATA
-- =============================================================

INSERT INTO role (role_name)
VALUES ('receiver'), ('payment'), ('releasing'), ('admin');

INSERT INTO payment_method (payment_method_name)
VALUES ('cash'), ('gcash'), ('maya'), ('bank_transfer'), ('credit');