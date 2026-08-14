-- Pass 2a: BOM (Bill of Materials) + Inventory.
--
-- BOM_LINES: component_type/component_id is a polymorphic reference
-- (raw_material or product, for sub-assemblies / multi-level BOM)
-- rather than two nullable FK columns. Depth/cycle guarding is
-- enforced in application code (bom rules), not the schema.
--
-- Two separate inventory-balance tables (finished_goods_inventory,
-- raw_material_inventory) rather than one polymorphic table, so the
-- FK to products/raw_materials stays a real, enforceable constraint.
-- stock_movements is the append-only ledger; the two balance tables
-- are the current-state cache kept in sync with it inside the same
-- transaction on every adjustment.

CREATE TABLE IF NOT EXISTS bom_lines (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_product_id BIGINT UNSIGNED NOT NULL,
    component_type    ENUM('raw_material', 'product') NOT NULL,
    component_id      BIGINT UNSIGNED NOT NULL,
    quantity          DECIMAL(14, 4) NOT NULL,
    unit              VARCHAR(20) NOT NULL,
    scrap_percent     DECIMAL(5, 2) NOT NULL DEFAULT 0,
    deleted_at        DATETIME NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by        BIGINT UNSIGNED NULL,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by        BIGINT UNSIGNED NULL,
    CONSTRAINT fk_bom_parent FOREIGN KEY (parent_product_id) REFERENCES products(id),
    INDEX idx_bom_parent (parent_product_id),
    INDEX idx_bom_component (component_type, component_id),
    INDEX idx_bom_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS finished_goods_inventory (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id         BIGINT UNSIGNED NOT NULL UNIQUE,
    quantity_on_hand   DECIMAL(14, 4) NOT NULL DEFAULT 0,
    quantity_reserved  DECIMAL(14, 4) NOT NULL DEFAULT 0,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_fgi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_material_inventory (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    raw_material_id    BIGINT UNSIGNED NOT NULL UNIQUE,
    quantity_on_hand   DECIMAL(14, 4) NOT NULL DEFAULT 0,
    quantity_reserved  DECIMAL(14, 4) NOT NULL DEFAULT 0,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_rmi_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_movements (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_type       ENUM('raw_material', 'product') NOT NULL,
    item_id         BIGINT UNSIGNED NOT NULL,
    movement_type   ENUM('receipt', 'issue', 'adjustment', 'production_in', 'production_out', 'return') NOT NULL,
    quantity        DECIMAL(14, 4) NOT NULL,
    reference_type  VARCHAR(40) NULL,
    reference_id    BIGINT UNSIGNED NULL,
    notes           VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT UNSIGNED NULL,
    INDEX idx_stock_mov_item (item_type, item_id),
    INDEX idx_stock_mov_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
