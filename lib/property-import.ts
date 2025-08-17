// Property import utilities for handling scraped data

import { supabaseService } from './supabase';
import { type ScrapedPropertyData, convertScrapedToProperty, type ExtendedProperty } from '../types/property';

export interface ImportResult {
  success: boolean;
  processed: number;
  inserted: number;
  updated: number;
  errors: string[];
}

/**
 * Import properties from scraped JSON data
 */
export async function importScrapedProperties(
  scrapedData: { properties: ScrapedPropertyData[] },
  orgId: string
): Promise<ImportResult> {
  const supabase = supabaseService();
  const result: ImportResult = {
    success: true,
    processed: 0,
    inserted: 0,
    updated: 0,
    errors: []
  };

  try {
    for (const scrapedProperty of scrapedData.properties) {
      result.processed++;
      
      try {
        // Convert scraped data to database format
        const propertyData = convertScrapedToProperty(scrapedProperty, orgId);
        
        // Check if property already exists by external_id
        const { data: existingProperty } = await supabase
          .from('properties')
          .select('id')
          .eq('org_id', orgId)
          .eq('external_id', propertyData.external_id)
          .maybeSingle();

        if (existingProperty) {
          // Update existing property
          const { error: updateError } = await supabase
            .from('properties')
            .update(propertyData)
            .eq('id', existingProperty.id);

          if (updateError) {
            result.errors.push(`Failed to update property ${propertyData.external_id}: ${updateError.message}`);
            continue;
          }
          
          result.updated++;
        } else {
          // Insert new property
          const { error: insertError } = await supabase
            .from('properties')
            .insert(propertyData);

          if (insertError) {
            result.errors.push(`Failed to insert property ${propertyData.external_id}: ${insertError.message}`);
            continue;
          }
          
          result.inserted++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Failed to process property ${scrapedProperty.basicInfo.id}: ${errorMessage}`);
      }
    }

    if (result.errors.length > 0) {
      result.success = false;
    }

    return result;
  } catch (error) {
    return {
      success: false,
      processed: result.processed,
      inserted: result.inserted,
      updated: result.updated,
      errors: [...result.errors, `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

/**
 * Parse price from string format (e.g., "6,300 ₪")
 */
export function parsePrice(priceStr: string): number {
  const match = priceStr.match(/[\d,]+/);
  return match ? parseInt(match[0].replace(/,/g, '')) : 0;
}

/**
 * Parse evacuation date to ISO format
 */
export function parseEvacuationDate(evacuation: string): string | null {
  if (!evacuation || evacuation === 'מיידי') {
    return null;
  }

  // Try to parse DD/MM/YYYY format
  const dateMatch = evacuation.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch && dateMatch[1] && dateMatch[2] && dateMatch[3]) {
    const [, day, month, year] = dateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract rooms count from size or title
 */
export function extractRoomsCount(text: string): number | null {
  // Look for patterns like "3 חדרים" or "3.5 חדרים"
  const roomsMatch = text.match(/(\d+(?:\.\d+)?)\s*חדרים?/);
  if (roomsMatch && roomsMatch[1]) {
    return parseFloat(roomsMatch[1]);
  }

  // Look for patterns like "דירת 3 חדרים"
  const apartmentMatch = text.match(/דירת?\s+(\d+(?:\.\d+)?)\s*חדרים?/);
  if (apartmentMatch && apartmentMatch[1]) {
    return parseFloat(apartmentMatch[1]);
  }

  return null;
}

/**
 * Extract city and neighborhood from address
 */
export function parseAddress(address: string): { city: string; neighborhood: string | null } {
  const parts = address.split(',');
  const city = parts[parts.length - 1]?.trim().replace(/ - מגורים$/, '') || '';
  const neighborhood = parts.length > 1 ? parts[0]?.trim() || null : null;
  
  return { city, neighborhood };
}

/**
 * Validate imported property data
 */
export function validatePropertyData(property: Partial<ExtendedProperty>): string[] {
  const errors: string[] = [];

  if (!property.title || property.title.trim() === '') {
    errors.push('Title is required');
  }

  if (!property.city || property.city.trim() === '') {
    errors.push('City is required');
  }

  if (!property.price || property.price <= 0) {
    errors.push('Valid price is required');
  }

  if (!property.org_id) {
    errors.push('Organization ID is required');
  }

  return errors;
}