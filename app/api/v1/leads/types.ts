import { z } from 'zod'

export const LeadInput = z.object({
  external_id: z.string().optional(),
  source_id: z.string(),
  full_name: z.string().optional(),
  phone: z.string(),
  email: z.string().email().optional(),
  budget_min: z.number().int().optional(),
  budget_max: z.number().int().optional(),
  preferred_cities: z.array(z.string()).optional(),
  preferred_rooms: z.number().int().optional(),
  must_haves: z.record(z.string(), z.any()).optional(),
  nice_to_haves: z.record(z.string(), z.any()).optional(),
  move_in_from: z.string().optional(),
  notes: z.string().optional(),
})

export type LeadInputType = z.infer<typeof LeadInput>
