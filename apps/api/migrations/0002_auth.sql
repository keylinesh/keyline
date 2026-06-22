-- 0002_auth — device login challenges + scoped access tokens.

-- One-time proof-of-possession challenges. The server seals a random 32-byte
-- value to a device's public key (envelope sealed-box); the device returns the
-- unsealed value to prove it holds the matching private key. Short-lived and
-- single-use (consumed_at).
create table device_challenges (
  id          uuid        primary key default gen_random_uuid(),
  device_id   uuid        not null references devices(id) on delete cascade,
  challenge   text        not null,            -- base64; compared on completion
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index device_challenges_device_idx on device_challenges (device_id);

create type token_role as enum ('owner', 'admin', 'member');

-- Scoped, short-lived access tokens. Only the SHA-256 hash is stored, so a DB
-- leak yields no usable tokens. environment_ids null = all environments the role
-- allows; non-null restricts the token (per-environment RBAC enforced in #23).
create table access_tokens (
  id              uuid        primary key default gen_random_uuid(),
  token_hash      text        not null unique,  -- sha256(token), hex
  device_id       uuid        not null references devices(id)     on delete cascade,
  member_id       uuid        not null references members(id)     on delete cascade,
  workspace_id    uuid        not null references workspaces(id)  on delete cascade,
  role            token_role  not null,
  environment_ids uuid[],                        -- null = not restricted
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);
create index access_tokens_device_idx on access_tokens (device_id);
create index access_tokens_member_idx on access_tokens (member_id);
