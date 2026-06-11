import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const VAULT_DIR = path.resolve(ROOT, '../robilouis-pro/Learning/Tech Lead AI & Data Path');
export const EVALS_SRC_DIR = path.join(ROOT, 'content', 'evals');
export const DATA_DIR = path.join(ROOT, 'src', 'data');
