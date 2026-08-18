-- Pass 2e: Production Schedules + Delivery Notes + Calendar.
--
-- Widens the production_schedules stub table from Pass 2b (see that
-- migration's header) to the full domain. The stub already carried
-- everything feasibility's capacity check and MRP needed to read
-- (product/machine/order/quantity/dates/status); this adds what the
-- real production domain needs to write (actuals, produced_quantity,
-- auto_scheduled flag, cancel_reason, notes, audit columns).

ALTER TABLE production_schedules
    ADD COLUMN produced_quantity DECIMAL(14, 4) NOT NULL DEFAULT 0 AFTER planned_quantity,
    ADD COLUMN actual_start DATETIME NULL AFTER scheduled_end,
    ADD COLUMN actual_end DATETIME NULL AFTER actual_start,
    ADD COLUMN auto_scheduled TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
    ADD COLUMN cancel_reason TEXT NULL AFTER auto_scheduled,
    ADD COLUMN notes TEXT NULL AFTER cancel_reason,
    ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER created_at,
    ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_by,
    ADD COLUMN updated_by BIGINT UNSIGNED NULL AFTER updated_at;

CREATE TABLE IF NOT EXISTS delivery_notes (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delivery_note_number   VARCHAR(30) NOT NULL UNIQUE,
    order_id               BIGINT UNSIGNED NOT NULL,
    delivery_date          DATE NOT NULL,
    status                 ENUM('draft', 'issued', 'cancelled') NOT NULL DEFAULT 'draft',
    auto_created           TINYINT(1) NOT NULL DEFAULT 0,
    cancel_reason          TEXT NULL,
    notes                  TEXT NULL,
    deleted_at             DATETIME NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by             BIGINT UNSIGNED NULL,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by             BIGINT UNSIGNED NULL,
    CONSTRAINT fk_dn_order FOREIGN KEY (order_id) REFERENCES orders(id),
    INDEX idx_dn_status (status),
    INDEX idx_dn_order (order_id),
    INDEX idx_dn_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delivery_note_id    BIGINT UNSIGNED NOT NULL,
    product_id          BIGINT UNSIGNED NOT NULL,
    quantity_delivered  DECIMAL(14, 4) NOT NULL,
    CONSTRAINT fk_dnl_note FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id) ON DELETE CASCADE,
    CONSTRAINT fk_dnl_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_dnl_note (delivery_note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_events (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_date  DATE NOT NULL,
    title       VARCHAR(200) NOT NULL,
    notes       TEXT NULL,
    all_users   TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at  DATETIME NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  BIGINT UNSIGNED NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by  BIGINT UNSIGNED NULL,
    CONSTRAINT fk_calendar_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_calendar_event_date (event_date),
    INDEX idx_calendar_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_event_mentions (
    id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_id  BIGINT UNSIGNED NOT NULL,
    user_id   BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_mention_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    CONSTRAINT fk_mention_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_mention_event (event_id),
    INDEX idx_mention_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO number_series (doc_type, prefix, next_number, padding) VALUES
    ('PRODUCTION_BATCH', 'BATCH', 1, 5),
    ('DELIVERY_NOTE', 'DN', 1, 5);
