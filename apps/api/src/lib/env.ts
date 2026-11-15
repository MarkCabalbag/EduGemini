import { z } from 'zod';

// The only module that reads process.env (code-standards §10). Variables are listed in TRD Appendix A.
// The API crashes at startup on a missing or invalid value.

const url = z.url();
const postgresUrl = z.string().refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: url,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    // Database (TRD §4.3)
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
    PGBOSS_URL: postgresUrl,

    // Storage
    STORAGE_DRIVER: z.enum(['supabase', 'local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.storage'),
    STORAGE_BUCKET: z.string().min(1).default('edugemini'),
    SUPABASE_URL: url.optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    // Secrets
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded'),
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

    // Email (TRD §13.5)
    MAIL_DRIVER: z.enum(['smtp', 'fake']).default('fake'),
    MAIL_FROM: z.string().min(3).default('EduGemini <no-reply@edugemini.local>'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),

    // Gemini (TRD §11). The model is a candidate until spike S3.
    GEMINI_MODE: z.enum(['live', 'fake']).default('fake'),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),

    REGRADE_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(120),
  })
  .superRefine((e, ctx) => {
    const need = (names: (keyof typeof e)[], why: string) => {
      for (const name of names) {
        if (e[name] === undefined) {
          ctx.addIssue({ code: 'custom', path: [name], message: `required when ${why}` });
        }
      }
    };
    if (e.STORAGE_DRIVER === 'supabase') need(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], 'STORAGE_DRIVER=supabase');
    if (e.MAIL_DRIVER === 'smtp') need(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'], 'MAIL_DRIVER=smtp');
    if (e.NODE_ENV === 'production') {
      const forbid = (bad: boolean, name: keyof typeof e, message: string) => {
        if (bad) ctx.addIssue({ code: 'custom', path: [name], message });
      };
      forbid(e.MAIL_DRIVER === 'fake', 'MAIL_DRIVER', 'the fake mailer is not allowed in production');
      forbid(e.GEMINI_MODE === 'fake', 'GEMINI_MODE', 'the fake Gemini adapter is not allowed in production');
      forbid(e.STORAGE_DRIVER === 'local', 'STORAGE_DRIVER', 'local storage is not allowed in production');
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Validate a set of variables. Throws one error that lists every problem. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** The validated environment, read once from process.env. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
