CREATE TABLE IF NOT EXISTS franchises (
  id BIGSERIAL PRIMARY KEY,
  cidade TEXT NOT NULL,
  estado TEXT NOT NULL,
  franchise_name TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  podio_app_id TEXT NOT NULL,
  podio_view_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'active',
  status TEXT NOT NULL DEFAULT 'open',
  franchise_id BIGINT REFERENCES franchises(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  media_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tipo_evento TEXT,
  cidade TEXT,
  estado TEXT,
  data_inicio DATE,
  data_fim DATE,
  duracao TEXT,
  pessoas INTEGER,
  nome_contato TEXT,
  email TEXT,
  podio_item_id_franquia TEXT,
  podio_item_id_franqueadora TEXT,
  sla_24h_ok BOOLEAN NOT NULL DEFAULT FALSE,
  sla_7d_ok BOOLEAN NOT NULL DEFAULT FALSE,
  post_evento_ok BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(customer_phone);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run_at ON jobs(run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
