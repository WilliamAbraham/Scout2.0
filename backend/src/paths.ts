import path from 'node:path';
import {fileURLToPath} from 'node:url';

// This file lives at <repo>/backend/src/paths.ts, so the repo root is two
// levels up. Deriving it from the module URL keeps these paths correct no
// matter which directory the script is launched from.
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

// Generated output lives outside both workspaces so either can read it.
export const DATA_DIR = path.join(REPO_ROOT, 'data');
