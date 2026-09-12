import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {DATA_DIR} from '../paths.ts';

const PROCESSED_PATH = path.join(DATA_DIR, 'processed-alerts.json');

export async function loadProcessedAlertIds(): Promise<Set<string>> {
  try {
    const ids = JSON.parse(await readFile(PROCESSED_PATH, 'utf8')) as string[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export async function saveProcessedAlertIds(ids: Set<string>): Promise<void> {
  await mkdir(DATA_DIR, {recursive: true});
  await writeFile(PROCESSED_PATH, JSON.stringify([...ids].sort(), null, 2) + '\n', 'utf8');
}
