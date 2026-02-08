// scripts/generatePodioMappings.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, "podio-apps");
const OUTPUT_DIR = path.join(ROOT, "src", "config");

const WORKSPACES = [
  { key: "franqueadora", name: "Franqueadora" },
  { key: "campinas", name: "Campinas" },
  { key: "litoral_norte", name: "Litoral Norte" },
  { key: "rio_bh", name: "Rio de Janeiro e BH" },
];

// ---------- Helpers ----------
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

function findLatestAppFile(workspaceKey) {
  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.startsWith(`${workspaceKey}.app.`) && f.endsWith(".json"));
  if (!files.length) throw new Error(`No app json found for workspace: ${workspaceKey} in ${INPUT_DIR}`);
  // se tiver mais de um, pega o último em ordem alfabética (bom o suficiente aqui)
  files.sort();
  return path.join(INPUT_DIR, files[files.length - 1]);
}

// Podio: /app/{app_id} geralmente retorna { app_id, config, fields: [...] }
function getFields(appJson) {
  if (Array.isArray(appJson.fields)) return appJson.fields;
  // fallback defensivo
  if (appJson.config?.fields && Array.isArray(appJson.config.fields)) return appJson.config.fields;
  throw new Error("Could not find fields[] in app JSON");
}

// Tenta extrair opções de category de forma robusta
function extractCategoryOptions(field) {
  const out = {};
  const settings = field?.config?.settings;

  // formato mais comum: settings.options = [{id, text}, ...]
  const optA = settings?.options;
  if (Array.isArray(optA)) {
    for (const o of optA) {
      const label = o?.text ?? o?.label ?? o?.name;
      const id = o?.id;
      if (label && typeof id === "number") out[label] = id;
    }
  }

  // alguns retornos usam settings.allowed_values / values
  const optB = settings?.allowed_values ?? settings?.values;
  if (Array.isArray(optB)) {
    for (const o of optB) {
      const label = o?.text ?? o?.label ?? o?.name;
      const id = o?.id;
      if (label && typeof id === "number") out[label] = id;
    }
  }

  return out;
}

// ---------- Generate Camada B ----------
function buildWorkspaceMapping(workspaceKey, workspaceName, appJson) {
  const fields = getFields(appJson);

  const mapping = {
    workspace_key: workspaceKey,
    workspace_name: workspaceName,
    app_id: appJson.app_id ?? appJson.appId ?? null,
    generated_at: new Date().toISOString(),
    fields: {},        // podio_external_id -> { field_id, type, label, required }
    categories: {},    // podio_external_id -> { options: { "Texto": option_id } }
  };

  for (const f of fields) {
    const externalId = f.external_id; // chave estável
    if (!externalId) continue;

    const fieldId = f.field_id;
    const type = f.type;
    const label = f.config?.label ?? null;
    const required = Boolean(f.config?.required);

    mapping.fields[externalId] = { field_id: fieldId, type, label, required };

    if (type === "category") {
      const options = extractCategoryOptions(f);
      mapping.categories[externalId] = { options };
    }
  }

  return mapping;
}

// ---------- Generate Camada A (canônica mínima) ----------
function buildCanonicalSchema(workspaceMappings) {
  // união por external_id: pega type/label/required de onde existir.
  const byExternalId = new Map();

  for (const wm of workspaceMappings) {
    for (const [externalId, meta] of Object.entries(wm.fields)) {
      if (!byExternalId.has(externalId)) {
        byExternalId.set(externalId, {
          field_key: externalId.replace(/-/g, "_"), // chave interna sugerida (ajustamos depois)
          podio_external_id: externalId,
          type: meta.type,
          description: meta.label ?? "",
          format: meta.type === "date" ? "YYYY-MM-DD" : "",
          required_policy: meta.required ? "required_in_podio" : "optional_in_podio",
        });
      }
    }
  }

  return {
    version: "v1",
    generated_at: new Date().toISOString(),
    fields: Array.from(byExternalId.values()).sort((a, b) =>
      a.podio_external_id.localeCompare(b.podio_external_id)
    ),
  };
}

// ---------- Main ----------
function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`Missing folder: ${INPUT_DIR} (run /podio/apps/export first)`);
  }

  ensureDir(OUTPUT_DIR);

  const workspaceMappings = [];

  for (const w of WORKSPACES) {
    const file = findLatestAppFile(w.key);
    const appJson = readJson(file);

    const mapping = buildWorkspaceMapping(w.key, w.name, appJson);
    workspaceMappings.push(mapping);

    const outFile = path.join(OUTPUT_DIR, `podio.workspace.${w.key}.json`);
    writeJson(outFile, mapping);
    console.log(`✅ wrote ${outFile}`);
  }

  const canonical = buildCanonicalSchema(workspaceMappings);
  const canonicalFile = path.join(OUTPUT_DIR, `podio.canonical.schema.json`);
  writeJson(canonicalFile, canonical);
  console.log(`✅ wrote ${canonicalFile}`);

  console.log("\nDone.");
}

main();
