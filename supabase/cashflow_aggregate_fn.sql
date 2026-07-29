-- Aggregate cashflow transactions by category + direction, no row-limit issue
CREATE OR REPLACE FUNCTION cashflow_aggregate(p_date_from text DEFAULT NULL, p_date_to text DEFAULT NULL)
RETURNS TABLE(category text, direction text, total_cents bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    category,
    direction,
    SUM(amount_cents)::bigint AS total_cents
  FROM cashflow_transactions
  WHERE
    (p_date_from IS NULL OR date >= p_date_from::date)
    AND (p_date_to IS NULL OR date <= p_date_to::date)
  GROUP BY category, direction;
$$;
