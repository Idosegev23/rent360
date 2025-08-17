import { z } from 'zod'

export const PropertyInputSchema = z.object({
  external_id: z.string().optional(),
  source_id: z.string(),
  type: z.string().optional(),
  title: z.string(),
  city: z.string(),
  region: z.string().optional(),
  neighborhood: z.string().optional(),
  address: z.string().optional(),
  street: z.string().optional(),
  floor: z.number().int().optional(),
  price: z.number().int(),
  rooms: z.number().int().optional(),
  sqm: z.number().int().optional(),
  amenities: z.record(z.string(), z.any()).optional(),
  available_from: z.string().optional(),
  link: z.string().url().optional(),
  images: z.array(z.any()).optional(),
  is_active: z.boolean().optional()
})
export type PropertyInputType = z.infer<typeof PropertyInputSchema>

export const LeadInputSchema = z.object({
  external_id: z.string().optional(),
  source_id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string(),
  email: z.string().email().optional(),
  budget_min: z.number().int().optional(),
  budget_max: z.number().int().optional(),
  preferred_regions: z.array(z.string()).optional(),
  preferred_cities: z.array(z.string()).optional(),
  preferred_rooms: z.number().int().optional(),
  pets: z.boolean().optional(),
  long_term: z.boolean().optional(),
  smokers: z.boolean().optional(),
  must_haves: z.record(z.string(), z.any()).optional(),
  nice_to_haves: z.record(z.string(), z.any()).optional(),
  move_in_from: z.string().optional(),
  notes: z.string().optional(),
  required_fields: z.record(z.string(), z.boolean()).optional(),
})
export type LeadInputType = z.infer<typeof LeadInputSchema>

