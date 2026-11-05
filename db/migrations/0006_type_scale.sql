ALTER TABLE "companies" ADD COLUMN "scale" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "type" text DEFAULT '' NOT NULL;;--> statement-breakpoint
-- Old company industries that name a line of work (e.g. "Investment Banking") become each contact's type there;
-- anything else is kept as the company's scale. Saved import mappings and graph views follow the move.
UPDATE "contacts" SET "type" = c."industry" FROM "companies" c
  WHERE c."id" = "contacts"."company_id" AND c."industry" IN ('Investment Banking', 'Sales & Trading', 'Equity Research', 'Private Equity', 'Private Credit', 'Hedge Funds', 'Asset Management', 'Pension Funds', 'Venture Capital', 'Quant & Prop Trading', 'Wealth Management', 'Corporate Development', 'Transaction Advisory', 'Commercial Banking', 'Fintech', 'Insurance', 'Recruiting', 'Other');--> statement-breakpoint
UPDATE "companies" SET "scale" = "industry" WHERE "industry" <> '' AND "industry" NOT IN ('Investment Banking', 'Sales & Trading', 'Equity Research', 'Private Equity', 'Private Credit', 'Hedge Funds', 'Asset Management', 'Pension Funds', 'Venture Capital', 'Quant & Prop Trading', 'Wealth Management', 'Corporate Development', 'Transaction Advisory', 'Commercial Banking', 'Fintech', 'Insurance', 'Recruiting', 'Other');--> statement-breakpoint
UPDATE "column_mappings" SET "mapping" = (
  SELECT jsonb_object_agg(k, CASE WHEN v = '"industry"'::jsonb THEN '"type"'::jsonb ELSE v END) FROM jsonb_each("mapping") AS e(k, v)
) WHERE "mapping"::text LIKE '%"industry"%';--> statement-breakpoint
UPDATE "graph_views" SET "levels" = (
  SELECT jsonb_agg(CASE WHEN x = '"industry"'::jsonb THEN '"type"'::jsonb ELSE x END) FROM jsonb_array_elements("levels") AS x
) WHERE "levels" ? 'industry';
