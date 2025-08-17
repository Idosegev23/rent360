import { z } from 'zod'

export const PropertyInput = z.object({
  external_id: z.string().optional(),
  source_id: z.string(),
  title: z.string(),
  city: z.string(),
  neighborhood: z.string().optional(),
  address: z.string().optional(),
  price: z.number().int(),
  rooms: z.number().int().optional(),
  sqm: z.number().int().optional(),
  amenities: z.record(z.string(), z.any()).optional(),
  available_from: z.string().optional(),
  link: z.string().url().optional(),
  images: z.array(z.any()).optional(),
  is_active: z.boolean().optional()
})

export type PropertyInputType = z.infer<typeof PropertyInput>
