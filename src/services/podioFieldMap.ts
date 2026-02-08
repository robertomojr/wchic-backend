import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cached: any = null;

export async function getPodioFieldMap() {
  if (cached) {
    return cached;
  }
  const mapPath = path.resolve(__dirname, '../config/podioFieldMap.json');
  const data = await fs.readFile(mapPath, 'utf8');
  cached = JSON.parse(data);
  return cached;
}
