import type { Env } from './env';
import { createLocalStorage } from './local-storage';
import type { StorageAdapter } from './storage';
import { createSupabaseStorage } from './supabase-storage';

type StorageEnv = Pick<
  Env,
  'STORAGE_DRIVER' | 'STORAGE_LOCAL_DIR' | 'APP_URL' | 'SESSION_SECRET' | 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'
>;

/** The storage chosen by STORAGE_DRIVER (code-standards §5). */
export function createStorage(env: StorageEnv): StorageAdapter {
  if (env.STORAGE_DRIVER === 'local') {
    return createLocalStorage({ dir: env.STORAGE_LOCAL_DIR, appUrl: env.APP_URL, secret: env.SESSION_SECRET });
  }
  // env.ts already refuses the supabase driver without these two; this narrows the types.
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseStorage({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
}
