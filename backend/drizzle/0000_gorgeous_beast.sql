CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_id" text NOT NULL,
	"address" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"bedrooms" numeric(4, 1),
	"bathrooms" numeric(4, 1),
	"listing_url" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_rental_id_unique" UNIQUE("rental_id"),
	CONSTRAINT "listings_rental_id_valid" CHECK ("listings"."rental_id" ~ '^[0-9]+$'),
	CONSTRAINT "listings_address_not_empty" CHECK (length(trim("listings"."address")) > 0),
	CONSTRAINT "listings_price_positive" CHECK ("listings"."price" > 0),
	CONSTRAINT "listings_bedrooms_nonnegative" CHECK ("listings"."bedrooms" >= 0),
	CONSTRAINT "listings_bathrooms_nonnegative" CHECK ("listings"."bathrooms" >= 0),
	CONSTRAINT "listings_seen_at_order" CHECK ("listings"."last_seen_at" >= "listings"."first_seen_at")
);
