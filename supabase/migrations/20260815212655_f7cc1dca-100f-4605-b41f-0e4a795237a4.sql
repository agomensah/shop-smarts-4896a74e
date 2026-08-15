-- Shop Smarts — sales & stock hardening
-- Moves every write that touches money or stock behind SECURITY DEFINER RPCs,
-- adds cost tracking, a stock movement log, and soft voids in place of deletes.

------------------------------------------------------------------------------
-- 1. Schema additions
------------------------------------------------------------------------------

-- Cost price so the shop can report margin, not just revenue.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (cost_price >= 0);

-- Snapshot the cost at the moment of sale; product cost changes later must not
-- rewrite the margin on sales already recorded.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Soft void instead of DELETE, so the audit trail survives a mistake.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Constrain payment methods that were previously free text.
ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash', 'momo', 'card'));

------------------------------------------------------------------------------
-- 2. Stock movement log
------------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.stock_movement_type AS ENUM
    ('sale', 'restock', 'correction', 'damage', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type public.stock_movement_type NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view stock movements" ON public.stock_movements;
CREATE POLICY "Staff can view stock movements" ON public.stock_movements
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_product
  ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sales_active
  ON public.sales (created_at DESC) WHERE voided_at IS NULL;

------------------------------------------------------------------------------
-- 3. Retire the insert-time trigger — record_sale now owns stock changes
------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_decrement_stock ON public.sale_items;
DROP FUNCTION IF EXISTS public.decrement_stock();

------------------------------------------------------------------------------
-- 4. record_sale — the only way a sale enters the system
--    Prices and costs are read from products, never accepted from the client.
--    Rows are locked, so two tills cannot sell the same last unit.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_sale(
  _payment_method TEXT,
  _items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cashier UUID := auth.uid();
  _sale_id UUID;
  _item JSONB;
  _product products%ROWTYPE;
  _qty INTEGER;
  _total NUMERIC(10,2) := 0;
  _new_balance INTEGER;
BEGIN
  IF _cashier IS NULL THEN
    RAISE EXCEPTION 'You are signed out. Sign in again to record this sale.';
  END IF;

  IF _payment_method NOT IN ('cash', 'momo', 'card') THEN
    RAISE EXCEPTION 'Choose cash, mobile money or card.';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one item before completing the sale.';
  END IF;

  INSERT INTO public.sales (cashier_id, total, payment_method)
  VALUES (_cashier, 0, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'quantity')::INTEGER, 0);

    IF _qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1.';
    END IF;

    SELECT * INTO _product
    FROM public.products
    WHERE id = (_item->>'product_id')::UUID
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That item is no longer in the shop list.';
    END IF;

    IF NOT _product.is_active THEN
      RAISE EXCEPTION '% is no longer on sale.', _product.name;
    END IF;

    IF _product.stock_quantity < _qty THEN
      RAISE EXCEPTION 'Only % left of %.', _product.stock_quantity, _product.name;
    END IF;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total
    )
    VALUES (
      _sale_id, _product.id, _product.name, _qty,
      _product.price, _product.cost_price, _product.price * _qty
    );

    UPDATE public.products
    SET stock_quantity = stock_quantity - _qty,
        updated_at = now()
    WHERE id = _product.id
    RETURNING stock_quantity INTO _new_balance;

    INSERT INTO public.stock_movements (
      product_id, movement_type, delta, balance_after, sale_id, created_by
    )
    VALUES (_product.id, 'sale', -_qty, _new_balance, _sale_id, _cashier);

    _total := _total + (_product.price * _qty);
  END LOOP;

  UPDATE public.sales SET total = _total WHERE id = _sale_id;

  RETURN _sale_id;
END;
$$;