BEGIN;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_card_settlement_payment_method_required
  CHECK (transaction_kind <> 'card_settlement' OR payment_method_id IS NOT NULL);

COMMIT;
