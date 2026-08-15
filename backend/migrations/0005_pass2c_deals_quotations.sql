-- Pass 2c: Deals + Quotations.
--
-- Adds the feasibility_checks.deal_id FK deferred from Pass 2b's
-- migration (deals didn't exist yet).
--
-- pricing.ts (application/services) becomes the shared discount+tax
-- math for quotations now, and orders/purchase orders in Pass 2d --
-- same reasoning as number_series/settings/workflow/capacity: one
-- implementation, not three.

CREATE TABLE IF NOT EXISTS deals (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    deal_number     VARCHAR(30) NOT NULL UNIQUE,
    customer_id     BIGINT UNSIGNED NOT NULL,
    furthest_stage  ENUM('feasibility', 'quotation', 'order', 'production', 'delivery') NOT NULL DEFAULT 'feasibility',
    status          ENUM('open', 'cancelled') NOT NULL DEFAULT 'open',
    deleted_at      DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT UNSIGNED NULL,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by      BIGINT UNSIGNED NULL,
    CONSTRAINT fk_deals_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_deals_status (status),
    INDEX idx_deals_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE feasibility_checks
    ADD CONSTRAINT fk_feasibility_deal FOREIGN KEY (deal_id) REFERENCES deals(id);

CREATE TABLE IF NOT EXISTS quotations (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    quotation_number    VARCHAR(30) NOT NULL UNIQUE,
    customer_id         BIGINT UNSIGNED NOT NULL,
    deal_id             BIGINT UNSIGNED NULL,
    quotation_date      DATE NOT NULL,
    valid_until         DATE NULL,
    status              ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted') NOT NULL DEFAULT 'draft',
    subtotal_amount     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    discount_percent    DECIMAL(5, 2) NOT NULL DEFAULT 0,
    discount_amount     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    tax_rate            DECIMAL(5, 2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(14, 2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(14, 2) NOT NULL DEFAULT 0,
    notes               TEXT NULL,
    converted_order_id  BIGINT UNSIGNED NULL,
    feasibility_id      BIGINT UNSIGNED NULL,
    auto_created        TINYINT(1) NOT NULL DEFAULT 0,
    close_reason        TEXT NULL,
    approved_at         DATETIME NULL,
    approved_by         BIGINT UNSIGNED NULL,
    deleted_at          DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT UNSIGNED NULL,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by          BIGINT UNSIGNED NULL,
    CONSTRAINT fk_quotations_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT fk_quotations_deal FOREIGN KEY (deal_id) REFERENCES deals(id),
    CONSTRAINT fk_quotations_feasibility FOREIGN KEY (feasibility_id) REFERENCES feasibility_checks(id),
    CONSTRAINT fk_quotations_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
    INDEX idx_quotations_status (status),
    INDEX idx_quotations_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quotation_details (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    quotation_id      BIGINT UNSIGNED NOT NULL,
    product_id        BIGINT UNSIGNED NOT NULL,
    quantity          DECIMAL(14, 4) NOT NULL,
    unit_price        DECIMAL(14, 2) NOT NULL,
    discount_percent  DECIMAL(5, 2) NOT NULL DEFAULT 0,
    line_total        DECIMAL(14, 2) NOT NULL,
    CONSTRAINT fk_qd_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
    CONSTRAINT fk_qd_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_qd_quotation (quotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bootstrap-only defaults for settings this pass reads (mirrors Pass
-- 2b's factory_total_workers/workday_hours pattern) -- admin-editable
-- from Pass 4, empty/off by default until an admin actually sets a
-- threshold.
INSERT INTO settings (setting_key, setting_value) VALUES
    ('default_tax_rate', '0'),
    ('large_discount_approval_threshold', ''),
    ('auto_create_quotation_from_feasibility', 'true');

INSERT INTO number_series (doc_type, prefix, next_number, padding) VALUES
    ('DEAL', 'DEAL', 1, 5),
    ('QUOTATION', 'QTN', 1, 5);
