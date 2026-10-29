-- P3.3 (Rules 3, Dylan 2026-10-29): a credential rule may also need one of a group of types (a
-- security officer's shift takes an SIA security guard or door supervisor licence). Two or more
-- codes, in the same format as required_types and none of them also there; empty: no group. Rules
-- already held keep their empty group: the security pack's new default reaches firms set up after.
ALTER TABLE "credential_rules" ADD COLUMN "any_of_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_rules" ADD CONSTRAINT "credential_rules_any_of_types_format" CHECK (coalesce(array_ndims("credential_rules"."any_of_types"), 1) = 1
    and array_position("credential_rules"."any_of_types", null) is null
    and (cardinality("credential_rules"."any_of_types") = 0
      or (array_to_string("credential_rules"."any_of_types", ',') ~ '^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$'
        and cardinality(string_to_array(array_to_string("credential_rules"."any_of_types", ','), ','))
          = cardinality("credential_rules"."any_of_types"))) and cardinality("credential_rules"."any_of_types") <> 1
        and not ("credential_rules"."any_of_types" && "credential_rules"."required_types"));