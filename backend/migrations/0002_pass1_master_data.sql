-- Pass 1: master data domains (users extension, customers, suppliers,
-- raw_materials, supplier_materials, machines, products), plus the
-- infrastructure for two Pass 0 promises this pass makes real:
-- department-based permission matrix, and admin-configurable field
-- metadata (required/searchable/filterable) per entity.

-- ---------------------------------------------------------------
-- USERS: extend the Pass 0 bootstrap table to full parity with the
-- current system (department, soft delete, audit columns, profile
-- fields). Avatar/signature file upload itself is explicitly deferred
-- to Pass 3 (adapters/storage) -- these columns exist now so the
-- Users domain's shape is right, but no upload endpoint ships in
-- Pass 1. See docs/PARITY_CHECKLIST.md sign-off note.
--
-- Also widens id from Pass 0's plain INT to BIGINT UNSIGNED, matching
-- jdk_clean's convention -- Pass 0 didn't anticipate this pass's FK
-- references and used a narrower type. audit_log.performed_by widens
-- to match. Both tables are still nearly empty at this point in the
-- rollout, so this is a cheap fix now rather than a debt later.
-- ---------------------------------------------------------------
ALTER TABLE audit_log
    DROP FOREIGN KEY fk_audit_performed_by,
    MODIFY COLUMN performed_by BIGINT UNSIGNED NULL;

ALTER TABLE users
    MODIFY COLUMN role ENUM('admin', 'manager', 'staff', 'viewer') NOT NULL DEFAULT 'staff',
    MODIFY COLUMN id BIGINT UNSIGNED AUTO_INCREMENT,
    ADD COLUMN phone VARCHAR(30) NULL AFTER full_name,
    ADD COLUMN avatar_filename VARCHAR(255) NULL AFTER phone,
    ADD COLUMN department ENUM('sales', 'procurement', 'warehouse') NULL AFTER avatar_filename,
    ADD COLUMN signature_filename VARCHAR(255) NULL AFTER department,
    ADD COLUMN deleted_at DATETIME NULL AFTER is_active,
    ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER created_at,
    ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_by,
    ADD COLUMN updated_by BIGINT UNSIGNED NULL AFTER updated_at,
    ADD INDEX idx_users_deleted_at (deleted_at);

ALTER TABLE audit_log
    ADD CONSTRAINT fk_audit_performed_by FOREIGN KEY (performed_by) REFERENCES users(id);

-- ---------------------------------------------------------------
-- DEPARTMENT PERMISSIONS -- the admin-configurable page-level matrix.
-- A (department, page_key) pair with no row means "none" (deny by
-- default). admin/manager bypass this entirely; viewer is read-only
-- everywhere; only 'staff' is governed by this table.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_permissions (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    department   ENUM('sales', 'procurement', 'warehouse') NOT NULL,
    page_key     VARCHAR(50) NOT NULL,
    access_level ENUM('none', 'read', 'write') NOT NULL DEFAULT 'none',
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by   BIGINT UNSIGNED NULL,
    CONSTRAINT uq_dept_perm UNIQUE (department, page_key),
    CONSTRAINT fk_dept_perm_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- FIELD CONFIG -- admin-configurable, per entity, which fields are
-- required/searchable/filterable, overriding each domain's code
-- defaults without a redeploy. Absence of a row means "use the code
-- default" (see fieldConfigService.ts).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_config (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_type   VARCHAR(50) NOT NULL,
    field_name    VARCHAR(100) NOT NULL,
    is_required   TINYINT(1) NULL,
    is_searchable TINYINT(1) NULL,
    is_filterable TINYINT(1) NULL,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by    BIGINT UNSIGNED NULL,
    CONSTRAINT uq_field_config UNIQUE (entity_type, field_name),
    CONSTRAINT fk_field_config_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code               VARCHAR(30)  NOT NULL UNIQUE,
    name               VARCHAR(150) NOT NULL,
    contact_person     VARCHAR(120) NULL,
    email              VARCHAR(120) NULL,
    phone              VARCHAR(30)  NULL,
    billing_address    VARCHAR(255) NULL,
    shipping_address   VARCHAR(255) NULL,
    city               VARCHAR(80)  NULL,
    country            VARCHAR(80)  NULL,
    tax_id             VARCHAR(50)  NULL,
    credit_limit       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    payment_terms_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    status             ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    notes              TEXT NULL,
    deleted_at         DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         BIGINT UNSIGNED NULL,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by         BIGINT UNSIGNED NULL,
    INDEX idx_customers_deleted_at (deleted_at),
    INDEX idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code               VARCHAR(30)  NOT NULL UNIQUE,
    name               VARCHAR(150) NOT NULL,
    contact_person     VARCHAR(120) NULL,
    email              VARCHAR(120) NULL,
    phone              VARCHAR(30)  NULL,
    address            VARCHAR(255) NULL,
    city               VARCHAR(80)  NULL,
    country            VARCHAR(80)  NULL,
    tax_id             VARCHAR(50)  NULL,
    payment_terms_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    mode_of_supply     ENUM('direct', 'distributor', 'broker', 'import') NULL,
    rating             TINYINT UNSIGNED NULL,
    status             ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    deleted_at         DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         BIGINT UNSIGNED NULL,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by         BIGINT UNSIGNED NULL,
    INDEX idx_suppliers_deleted_at (deleted_at),
    INDEX idx_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- RAW MATERIALS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_materials (
    id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                 VARCHAR(30)  NOT NULL UNIQUE,
    name                 VARCHAR(150) NOT NULL,
    unit                 VARCHAR(20)  NOT NULL,
    reorder_point        DECIMAL(14, 4) NOT NULL DEFAULT 0,
    default_supplier_id  BIGINT UNSIGNED NULL,
    unit_cost            DECIMAL(14, 4) NOT NULL DEFAULT 0,
    status               ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    deleted_at           DATETIME NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by           BIGINT UNSIGNED NULL,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by           BIGINT UNSIGNED NULL,
    CONSTRAINT fk_rm_supplier FOREIGN KEY (default_supplier_id) REFERENCES suppliers(id),
    INDEX idx_rm_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- SUPPLIER MATERIALS -- which raw materials a supplier can supply.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_materials (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id         BIGINT UNSIGNED NOT NULL,
    raw_material_id     BIGINT UNSIGNED NOT NULL,
    max_supply_quantity DECIMAL(14, 4) NOT NULL,
    lead_time_days      SMALLINT UNSIGNED NULL,
    deleted_at          DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT UNSIGNED NULL,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by          BIGINT UNSIGNED NULL,
    CONSTRAINT fk_sm_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    CONSTRAINT fk_sm_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id),
    INDEX idx_sm_supplier (supplier_id),
    INDEX idx_sm_material (raw_material_id),
    INDEX idx_sm_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- MACHINES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machines (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                   VARCHAR(30)  NOT NULL UNIQUE,
    name                   VARCHAR(150) NOT NULL,
    capacity_hours_per_day DECIMAL(6, 2) NOT NULL DEFAULT 8,
    status                 ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    deleted_at             DATETIME NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by             BIGINT UNSIGNED NULL,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by             BIGINT UNSIGNED NULL,
    INDEX idx_machines_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id                         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                       VARCHAR(30)  NOT NULL UNIQUE,
    name                       VARCHAR(150) NOT NULL,
    unit                       VARCHAR(20)  NOT NULL,
    product_type               ENUM('finished_good', 'sub_assembly') NOT NULL DEFAULT 'finished_good',
    selling_price              DECIMAL(14, 2) NOT NULL DEFAULT 0,
    machine_id                 BIGINT UNSIGNED NULL,
    production_hours_per_unit  DECIMAL(10, 4) NULL,
    workers_required           SMALLINT UNSIGNED NULL,
    status                     ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    deleted_at                 DATETIME NULL,
    created_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by                 BIGINT UNSIGNED NULL,
    updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by                 BIGINT UNSIGNED NULL,
    CONSTRAINT fk_products_machine FOREIGN KEY (machine_id) REFERENCES machines(id),
    INDEX idx_products_deleted_at (deleted_at),
    INDEX idx_products_type (product_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
