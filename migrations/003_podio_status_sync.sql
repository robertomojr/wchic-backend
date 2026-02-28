-- ============================================================
-- Migration 003 — Tarefa #11: Sync bidirecional de status
-- Executar no Supabase SQL Editor
-- ============================================================

-- 1) Adiciona colunas para guardar os item_id do Podio
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS podio_item_id_franqueadora BIGINT,
  ADD COLUMN IF NOT EXISTS podio_item_id_franchise    BIGINT;

-- 2) Índices para busca rápida via webhook do Podio
CREATE INDEX IF NOT EXISTS idx_leads_podio_franqueadora ON leads(podio_item_id_franqueadora);
CREATE INDEX IF NOT EXISTS idx_leads_podio_franchise    ON leads(podio_item_id_franchise);

-- 3) Verifica resultado
SELECT id, external_id, status, podio_item_id_franqueadora, podio_item_id_franchise
FROM leads
ORDER BY created_at DESC
LIMIT 10;
