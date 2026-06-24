-- 0001_init — core data model for Keyline.
--
-- Zero-knowledge invariant: every column below holds either ciphertext, a
-- wrapped key, a public key, a non-secret KDF salt, or plaintext metadata.
-- The server never stores a workspace secret, a workspace key, a device private
-- key, or any plaintext secret value. See docs/encryption-design.md.
--
-- Column ↔ M1 crypto type mapping:
--   workspaces.kdf_salt            -> kdf.ts DerivedKey.salt (base64 scrypt salt)
--   devices.public_key             -> keypair.ts DeviceKeyPair.publicKey (base64 SPKI)
--   wrapped_keys.{eph,nonce,ct,tag}-> envelope.ts WrappedKey
--   secret_bundles.{nonce,ciphertext,tag} -> bundle.ts SealedBundle

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Top-level tenant. One scrypt-derived workspace key encrypts all of its bundles.
create table workspaces (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  kdf_salt    text        not null,            -- base64, not secret
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create type member_role as enum ('owner', 'admin', 'member');

-- A person in a workspace. Identity only; no secret material.
create table members (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  email        text        not null,
  display_name text,
  role         member_role not null default 'member',
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);
create index members_workspace_idx on members (workspace_id);

-- Per-device X25519 keypair. Only the PUBLIC key is ever stored here.
create table devices (
  id           uuid        primary key default gen_random_uuid(),
  member_id    uuid        not null references members(id) on delete cascade,
  name         text,
  public_key   text        not null,           -- base64 SPKI DER
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz                      -- null = active
);
create index devices_member_idx on devices (member_id);
-- One device id == one public key; reject re-registering a different key under it.
create unique index devices_public_key_idx on devices (public_key);

create table projects (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  name         text        not null,
  slug         text        not null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table environments (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references projects(id) on delete cascade,
  name        text        not null,            -- e.g. dev / staging / prod
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

-- The workspace key, wrapped (sealed-box) to each member device's public key.
-- One row per (workspace, device). Revoking a member deletes their row.
create table wrapped_keys (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references workspaces(id) on delete cascade,
  device_id      uuid        not null references devices(id) on delete cascade,
  format_version int         not null check (format_version > 0),  -- WrappedKey.v
  eph            text        not null,         -- base64 ephemeral SPKI
  nonce          text        not null,
  ct             text        not null,
  tag            text        not null,
  created_at     timestamptz not null default now(),
  unique (workspace_id, device_id)
);

-- Encrypted secret bundles per environment, append-only and versioned. The
-- server stores only the SealedBundle; it cannot read the contents.
create table secret_bundles (
  id                   uuid        primary key default gen_random_uuid(),
  environment_id       uuid        not null references environments(id) on delete cascade,
  version              int         not null check (version > 0),
  format_version       int         not null check (format_version > 0),  -- SealedBundle.v
  nonce                text        not null,
  ciphertext           text        not null,
  tag                  text        not null,
  created_by_device_id uuid        references devices(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (environment_id, version)
);
create index secret_bundles_latest_idx on secret_bundles (environment_id, version desc);
