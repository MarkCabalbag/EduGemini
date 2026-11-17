import { z } from 'zod';

/**
 * Save the key (API Spec KEY-02). A pasted key often carries a space at either end, so it is trimmed first. The limits
 * are `KeySaveRequest` in openapi.yaml. `disclosureAcknowledged` must be true on the first save (PRD FR-KEY-04); the API checks that,
 * because only it knows whether a key is already saved.
 */
export const SaveKeySchema = z.object({
  apiKey: z
    .string({ error: 'Enter your Gemini key.' })
    .trim()
    .min(1, 'Enter your Gemini key.')
    .min(20, 'This key looks too short. Check that you copied all of it.')
    .max(200, 'This key looks too long. Check that you copied only the key.'),
  disclosureAcknowledged: z.boolean().optional(),
});
export type SaveKey = z.infer<typeof SaveKeySchema>;

/** The values of `KeyStatus` in Backend Schema §4.6. */
export const KeyStatusValueSchema = z.enum(['CONNECTED', 'NEEDS_ATTENTION', 'QUOTA_REACHED']);

/**
 * The instructor's key as the API shows it (API Spec KEY-01, `KeyStatus` in openapi.yaml): never the key, only its last four
 * characters. `connected` says a key is saved. `status` stays null until the key is checked with Gemini (EG-KEY-03).
 */
export const KeyStatusSchema = z.object({
  connected: z.boolean(),
  status: KeyStatusValueSchema.nullable(),
  last4: z.string().length(4).nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  disclosureAckAt: z.iso.datetime().nullable(),
});
export type KeyStatus = z.infer<typeof KeyStatusSchema>;
