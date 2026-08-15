-- Pass 2b: Feasibility + MRP, plus two small reusable services
-- (number_series, settings) that feasibility needs today and every
-- later document-numbered domain (quotations, orders, POs, production
-- batches) will reuse unchanged.
--
-- This migration also creates MINIMAL stub tables for `orders`,
-- `order_lines`, and `production_schedules` -- just the columns
-- feasibility's capacity check and MRP's demand aggregation actually
-- read. This is deliberate: those queries run against real (if empty)
-- tables now, so the algorithm is correct by construction rather than
-- faked, and reports "no demand yet" honestly instead of nothing at
-- all. Pass 2d (Orders) and Pass 2e (Production Schedules) will ALTER
-- these tables to add their full column sets (discounts, tax,
-- approval workflow, actual timestamps, etc.) and build the real
-- CRUD/state-machine domains around them -- this migration does not
-- attempt to anticipate that design.
--
-- feasibility_checks.deal_id is added as a plain nullable column with
-- no FK yet, since `deals` doesn't exist until Pass 2c -- that
-- migration adds the constraint once the table it references exists.

CREATE TABLE IF NOT EXISTS number_series (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doc_type     VARCHAR(30) NOT NULL UNIQUE,
    prefix       VARCHAR(10) NOT NULL,
    next_number  INT UNSIGNED NOT NULL DEFAULT 1,
    padding      TINYINT UNSIGNED NOT NULL DEFAULT 5,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO number_series (doc_type, prefix, next_number, padding) VALUES
    ('FEASIBILITY', 'FSB', 1, 5);

CREATE TABLE IF NOT EXISTS settings (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    setting_key    VARCHAR(80) NOT NULL UNIQUE,
    setting_value  TEXT NULL,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (setting_key, setting_value) VALUES
    ('factory_total_workers', '0'),
    ('factory_workday_hours', '8');

-- ---------------------------------------------------------------
-- Minimal stubs -- see migration header. Not full domains yet.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_number  VARCHAR(30) NULL UNIQUE,
    customer_id   BIGINT UNSIGNED NOT NULL,
    status        ENUM('draft', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled')
                  NOT NULL DEFAULT 'draft',
    deleted_at    DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_lines (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id    BIGINT UNSIGNED NOT NULL,
    product_id  BIGINT UNSIGNED NOT NULL,
    quantity    DECIMAL(14, 4) NOT NULL,
    CONSTRAINT fk_order_lines_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_lines_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_order_lines_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS production_schedules (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_number       VARCHAR(30) NULL UNIQUE,
    product_id         BIGINT UNSIGNED NOT NULL,
    machine_id         BIGINT UNSIGNED NULL,
    order_id           BIGINT UNSIGNED NULL,
    planned_quantity   DECIMAL(14, 4) NOT NULL,
    scheduled_start    DATE NOT NULL,
    scheduled_end      DATE NOT NULL,
    status             ENUM('planned', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
    deleted_at         DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ps_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_ps_machine FOREIGN KEY (machine_id) REFERENCES machines(id),
    CONSTRAINT fk_ps_order FOREIGN KEY (order_id) REFERENCES orders(id),
    INDEX idx_ps_status (status),
    INDEX idx_ps_machine (machine_id),
    INDEX idx_ps_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- FEASIBILITY
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feasibility_checks (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feasibility_number     VARCHAR(30) NOT NULL UNIQUE,
    customer_id            BIGINT UNSIGNED NOT NULL,
    deal_id                BIGINT UNSIGNED NULL, -- FK added in Pass 2c once `deals` exists
    status                 ENUM('draft', 'feasible', 'exception_pending', 'exception_approved', 'exception_rejected', 'closed', 'converted')
                           NOT NULL DEFAULT 'draft',
    required_by_date       DATE NULL,
    checked_at             DATETIME NULL,
    exception_reason       TEXT NULL,
    exception_by           BIGINT UNSIGNED NULL,
    close_reason           TEXT NULL,
    notes                  TEXT NULL,
    admin_review_required  TINYINT(1) NOT NULL DEFAULT 0,
    admin_review_reason    ENUM('override', 'stale_open') NULL,
    admin_reviewed_at      DATETIME NULL,
    admin_reviewed_by      BIGINT UNSIGNED NULL,
    admin_review_notes     TEXT NULL,
    deleted_at             DATETIME NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by             BIGINT UNSIGNED NULL,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by             BIGINT UNSIGNED NULL,
    CONSTRAINT fk_feasibility_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT fk_feasibility_exception_by FOREIGN KEY (exception_by) REFERENCES users(id),
    CONSTRAINT fk_feasibility_admin_reviewed_by FOREIGN KEY (admin_reviewed_by) REFERENCES users(id),
    INDEX idx_feasibility_status (status),
    INDEX idx_feasibility_deleted_at (deleted_at),
    INDEX idx_feasibility_admin_review (admin_review_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feasibility_lines (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feasibility_id           BIGINT UNSIGNED NOT NULL,
    product_id               BIGINT UNSIGNED NOT NULL,
    quantity                 DECIMAL(14, 4) NOT NULL,
    covered_by_stock         DECIMAL(14, 4) NULL,
    bom_missing              TINYINT(1) NULL,
    is_feasible               TINYINT(1) NULL,
    shortfall_json            TEXT NULL,
    capacity_ok               TINYINT(1) NULL,
    capacity_shortfall_json   TEXT NULL,
    CONSTRAINT fk_fl_feasibility FOREIGN KEY (feasibility_id) REFERENCES feasibility_checks(id) ON DELETE CASCADE,
    CONSTRAINT fk_fl_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_fl_feasibility (feasibility_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
