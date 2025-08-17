// Extended property types based on scraped data structure

export interface TimelineEvent {
  type: string;
  content: string;
}

export interface ContactInfo {
  name: string | null;
  phone: string | null;
}

export interface ScrapedMetadata {
  pageNumber?: number;
  positionInPage?: number;
  scrapedAt?: string;
}

export interface PropertyAmenities {
  parking?: boolean;
  airConditioner?: boolean;
  storage?: boolean;
  balcony?: boolean;
  elevator?: boolean;
  mamad?: boolean;
  // Legacy support for existing amenities structure
  [key: string]: boolean | undefined;
}

export interface ExtendedProperty {
  id: string;
  org_id: string;
  external_id?: string | null;
  title: string;
  city: string;
  neighborhood?: string | null;
  address?: string | null;
  price: number;
  rooms?: number | null;
  sqm?: number | null;
  amenities?: PropertyAmenities | null;
  available_from?: string | null;
  link?: string | null;
  images?: string[] | null;
  source?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  
  // Extended fields from scraped data
  status?: string | null;
  evacuation_date?: string | null;
  description?: string | null;
  timeline?: TimelineEvent[] | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  full_text?: string | null;
  scraped_metadata?: ScrapedMetadata | null;
  last_updated_external?: string | null;
}

// Type for the scraped JSON structure (for import processing)
export interface ScrapedPropertyData {
  basicInfo: {
    price: string;
    size: string;
    address: string;
    status: string | null;
    evacuation: string;
    id: string;
  };
  details: {
    parking: boolean;
    airConditioner: boolean;
    storage: boolean;
    balcony: boolean;
    elevator: boolean;
    mamad: boolean;
    description: string | null;
    timeline: TimelineEvent[];
  };
  contact: ContactInfo;
  images: string[];
  additionalInfo: {
    source: string;
    updated: string;
  };
  fullText: string;
  pageNumber: number;
  positionInPage: number;
  scrapedAt: string;
}

// Utility function to convert scraped data to database format
export function convertScrapedToProperty(scraped: ScrapedPropertyData, orgId: string): Partial<ExtendedProperty> {
  // Parse price - remove commas and currency symbols
  const priceMatch = scraped.basicInfo.price.match(/[\d,]+/);
  const price = priceMatch ? parseInt(priceMatch[0].replace(/,/g, '')) : 0;
  
  // Parse size
  const size = scraped.basicInfo.size ? parseInt(scraped.basicInfo.size) : null;
  
  // Parse evacuation date
  let evacuationDate: string | null = null;
  if (scraped.basicInfo.evacuation && scraped.basicInfo.evacuation !== 'מיידי') {
    // Try to parse date in format DD/MM/YYYY
    const dateMatch = scraped.basicInfo.evacuation.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      evacuationDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  // Extract city and neighborhood from address
  const addressParts = scraped.basicInfo.address.split(',');
  const city = addressParts[addressParts.length - 1]?.trim().replace(' - מגורים', '') || '';
  const neighborhood = addressParts.length > 1 ? addressParts[0].trim() : null;
  
  return {
    external_id: scraped.basicInfo.id,
    title: scraped.fullText.substring(0, 100) + (scraped.fullText.length > 100 ? '...' : ''),
    city,
    neighborhood,
    address: scraped.basicInfo.address,
    price,
    sqm: size,
    amenities: {
      parking: scraped.details.parking,
      airConditioner: scraped.details.airConditioner,
      storage: scraped.details.storage,
      balcony: scraped.details.balcony,
      elevator: scraped.details.elevator,
      mamad: scraped.details.mamad,
    },
    images: scraped.images,
    source: scraped.additionalInfo.source,
    status: scraped.basicInfo.status,
    evacuation_date: evacuationDate,
    description: scraped.details.description,
    timeline: scraped.details.timeline,
    contact_name: scraped.contact.name,
    contact_phone: scraped.contact.phone,
    full_text: scraped.fullText,
    scraped_metadata: {
      pageNumber: scraped.pageNumber,
      positionInPage: scraped.positionInPage,
      scrapedAt: scraped.scrapedAt,
    },
    last_updated_external: scraped.additionalInfo.updated,
    org_id: orgId,
    is_active: true,
  };
}