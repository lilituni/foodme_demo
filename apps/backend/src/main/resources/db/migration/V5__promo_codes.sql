-- KAN-11 Promo codes: simple percentage codes applied at checkout. Codes are
-- stored upper-case and matched case-insensitively. A NULL expires_at never
-- expires. Orders keep the applied code and the discount they got.

CREATE SEQUENCE foodme.promo_code_id_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE foodme.promo_code (
    id               BIGINT           NOT NULL PRIMARY KEY,
    code             VARCHAR(64)      NOT NULL UNIQUE,
    percent_off      INTEGER          NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
    min_order_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    expires_at       TIMESTAMP
);

-- Launch codes (marketing can't manage codes in the back office yet).
INSERT INTO foodme.promo_code (id, code, percent_off, min_order_amount, expires_at) VALUES
    (nextval('foodme.promo_code_id_seq'), 'SAVE10',  10, 3000, NULL),
    (nextval('foodme.promo_code_id_seq'), 'TREAT15', 15, 8000, NULL),
    (nextval('foodme.promo_code_id_seq'), 'OLD15',   15, 0,    TIMESTAMP '2025-12-31 23:59:59');

ALTER TABLE foodme."order" ADD COLUMN promo_code VARCHAR(64);
ALTER TABLE foodme."order" ADD COLUMN discount DOUBLE PRECISION;
