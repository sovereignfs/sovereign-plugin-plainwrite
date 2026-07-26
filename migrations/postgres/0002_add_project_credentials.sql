CREATE TABLE "plainwrite_project_credentials" (
  "tenant_id" text NOT NULL,
  "project_id" text PRIMARY KEY NOT NULL,
  "created_by" text NOT NULL,
  "provider" text NOT NULL,
  "auth_type" text NOT NULL,
  "secret_ref" text NOT NULL,
  "provider_login" text,
  "status" text NOT NULL,
  "last_error" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
