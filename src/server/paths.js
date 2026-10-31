import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runtime data and .env always belong to the project root, independently of source layout.
export const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
