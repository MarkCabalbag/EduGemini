import { getEnv } from '../lib/env';
import { initBoss } from './init-boss';

// `pnpm db:boss:init`. Uses DIRECT_URL, the owner role on the session pooler (TRD §4.3).
await initBoss(getEnv().DIRECT_URL);
console.log('pg-boss is installed and up to date.');
