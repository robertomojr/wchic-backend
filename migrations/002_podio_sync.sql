-- ============================================================
-- Migration 002 — Tarefa #10: Podio sync
-- Executar no Supabase SQL Editor
-- ============================================================

-- 1) Garante que a coluna podio_workspace_key existe
ALTER TABLE franchises
  ADD COLUMN IF NOT EXISTS podio_workspace_key TEXT;

-- 2) Atualiza as franquias existentes com o workspace_key e app_id
--    (ajuste o WHERE pela franchise_name real no seu banco)

-- Franqueadora / Central
UPDATE franchises
SET
  podio_app_id       = '10094649',
  podio_workspace_key = 'franqueadora'
WHERE franchise_name ILIKE '%franqueadora%'
   OR franchise_name ILIKE '%central%';

-- Campinas
UPDATE franchises
SET
  podio_app_id       = '10777978',
  podio_workspace_key = 'campinas'
WHERE franchise_name ILIKE '%campinas%';

-- Litoral Norte
UPDATE franchises
SET
  podio_app_id       = '13683578',
  podio_workspace_key = 'litoral_norte'
WHERE franchise_name ILIKE '%litoral%';

-- Rio de Janeiro / BH
UPDATE franchises
SET
  podio_app_id       = '12876626',
  podio_workspace_key = 'rio_bh'
WHERE franchise_name ILIKE '%rio%'
   OR franchise_name ILIKE '%belo horizonte%'
   OR franchise_name ILIKE '%bh%';

-- 3) Verifica resultado
SELECT id, franchise_name, podio_app_id, podio_workspace_key
FROM franchises
ORDER BY id;
