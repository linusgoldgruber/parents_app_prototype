import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  MATRIX_HOMESERVER_URL: z.string().url(),
  MATRIX_ACCESS_TOKEN: z.string().min(1),
  MATRIX_USER_ID: z.string().regex(/^@[^:]+:.+$/, "MATRIX_USER_ID must look like @user:domain"),
  MATRIX_DEVICE_ID: z.string().optional(),
  MATRIX_RECOVERY_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5.3")
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
