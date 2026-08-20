CREATE TABLE account_merchant_entitlements (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  merchant_id text NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, merchant_id)
);

CREATE INDEX account_merchant_entitlements_merchant_id_idx
  ON account_merchant_entitlements (merchant_id);
