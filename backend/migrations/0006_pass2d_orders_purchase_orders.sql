-- Pass 2d: Orders + Purchase Orders.
--
-- Widens the orders/order_lines stub tables from Pass 2b (see that
-- migration's header) to the full domain. Both tables are still
-- empty at this point in the rollout (nothing has inserted into them
-- except test fixtures for production_schedules, which references
-- orders.id but never actually created a row) -- safe to add NOT NULL
-- columns without a data backfill.

ALTER TABLE orders
    ADD COLUMN deal_id BIGINT UNSIGNED NULL AFTER customer_id,
    ADD COLUMN order_date DATE NOT NULL AFTER deal_id,
    ADD COLUMN requested_delivery_date DATE NULL AFTER order_date,
    ADD COLUMN confirmed_delivery_date DATE NULL AFTER requested_delivery_date,
    ADD COLUMN subtotal_amount DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER status,
    ADD COLUMN discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0 AFTER subtotal_amount,
    ADD COLUMN discount_amount DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER discount_percent,
    ADD COLUMN tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 0 AFTER discount_amount,
    ADD COLUMN tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER tax_rate,
    ADD COLUMN total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER tax_amount,
    ADD COLUMN notes TEXT NULL AFTER total_amount,
    ADD COLUMN close_reason TEXT NULL AFTER notes,
    ADD COLUMN approved_at DATETIME NULL AFTER close_reason,
    ADD COLUMN approved_by BIGINT UNSIGNED NULL AFTER approved_at,
    ADD COLUMN admin_review_required TINYINT(1) NOT NULL DEFAULT 0 AFTER approved_by,
    ADD COLUMN admin_reviewed_at DATETIME NULL AFTER admin_review_required,
    ADD COLUMN admin_reviewed_by BIGINT UNSIGNED NULL AFTER admin_reviewed_at,
    ADD COLUMN admin_review_notes TEXT NULL AFTER admin_reviewed_by,
    ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER created_at,
    ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_by,
    ADD COLUMN updated_by BIGINT UNSIGNED NULL AFTER updated_at,
    MODIFY COLUMN status ENUM('draft', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'draft',
    ADD CONSTRAINT fk_orders_deal FOREIGN KEY (deal_id) REFERENCES deals(id),
    ADD CONSTRAINT fk_orders_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
    ADD CONSTRAINT fk_orders_admin_reviewed_by FOREIGN KEY (admin_reviewed_by) REFERENCES users(id),
    ADD INDEX idx_orders_admin_review (admin_review_required);

ALTER TABLE order_lines
    ADD COLUMN unit_price DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER quantity,
    ADD COLUMN discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0 AFTER unit_price,
    ADD COLUMN line_total DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER discount_percent;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    po_number              VARCHAR(30) NOT NULL UNIQUE,
    supplier_id            BIGINT UNSIGNED NOT NULL,
    order_date             DATE NOT NULL,
    expected_delivery_date DATE NULL,
    status                 ENUM('draft', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled') NOT NULL DEFAULT 'draft',
    subtotal_amount        DECIMAL(14, 2) NOT NULL DEFAULT 0,
    discount_percent       DECIMAL(5, 2) NOT NULL DEFAULT 0,
    discount_amount        DECIMAL(14, 2) NOT NULL DEFAULT 0,
    tax_rate               DECIMAL(5, 2) NOT NULL DEFAULT 0,
    tax_amount             DECIMAL(14, 2) NOT NULL DEFAULT 0,
    total_amount           DECIMAL(14, 2) NOT NULL DEFAULT 0,
    notes                  TEXT NULL,
    auto_created            TINYINT(1) NOT NULL DEFAULT 0,
    cancel_reason           TEXT NULL,
    approved_at             DATETIME NULL,
    approved_by             BIGINT UNSIGNED NULL,
    admin_review_required   TINYINT(1) NOT NULL DEFAULT 0,
    admin_reviewed_at       DATETIME NULL,
    admin_reviewed_by       BIGINT UNSIGNED NULL,
    admin_review_notes      TEXT NULL,
    deleted_at              DATETIME NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by               BIGINT UNSIGNED NULL,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by               BIGINT UNSIGNED NULL,
    CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    CONSTRAINT fk_po_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
    CONSTRAINT fk_po_admin_reviewed_by FOREIGN KEY (admin_reviewed_by) REFERENCES users(id),
    INDEX idx_po_status (status),
    INDEX idx_po_deleted_at (deleted_at),
    INDEX idx_po_admin_review (admin_review_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_order_id BIGINT UNSIGNED NOT NULL,
    raw_material_id   BIGINT UNSIGNED NOT NULL,
    quantity           DECIMAL(14, 4) NOT NULL,
    unit_price         DECIMAL(14, 2) NOT NULL,
    discount_percent   DECIMAL(5, 2) NOT NULL DEFAULT 0,
    line_total         DECIMAL(14, 2) NOT NULL,
    received_quantity DECIMAL(14, 4) NOT NULL DEFAULT 0,
    CONSTRAINT fk_pol_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_pol_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id),
    INDEX idx_pol_po (purchase_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (setting_key, setting_value) VALUES
    ('large_po_approval_threshold', ''),
    ('auto_schedule_production_on_confirm', 'true'),
    ('auto_create_delivery_note_on_ready', 'true');

INSERT INTO number_series (doc_type, prefix, next_number, padding) VALUES
    ('ORDER', 'ORD', 1, 5),
    ('PURCHASE_ORDER', 'PO', 1, 5);
