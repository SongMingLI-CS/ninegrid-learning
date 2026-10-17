CREATE TABLE IF NOT EXISTS profile_avatars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/webp'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 524288),
  width integer NOT NULL CHECK (width = 512),
  height integer NOT NULL CHECK (height = 512),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
