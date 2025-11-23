import { createClient } from '@/lib/supabase/server';

export interface WhatsAppLead {
  id: string;
  org_id: string;
  first_name: string | null;
  last_name: string | null;
  krayot_area: string | null;
  budget: number | null;
  rooms: number | null;
  move_in_date: string | null;
  pets: boolean | null;
  furnished: boolean | null;
  mamad: boolean | null;
  balcony: boolean | null;
  has_checks: boolean | null;
  has_guarantors: boolean | null;
  features: string[] | null;
  extra_requests: string[] | null;
}

export interface Property {
  id: string;
  title: string;
  city: string;
  neighborhood: string | null;
  price: number | null;
  rooms: number | null;
  amenities: any;
  available_from: string | null;
  pets_allowed: boolean | null;
  region: string | null;
}

export interface MatchResult {
  property_id: string;
  score: number;
  reasons: MatchReason[];
}

export interface MatchReason {
  factor: string;
  score: number;
  weight: number;
  details: string;
}

// Default matching weights - can be overridden from settings
const DEFAULT_WEIGHTS = {
  location: 0.25,      // 25% - Location match (city/region)
  budget: 0.30,        // 30% - Budget compatibility
  rooms: 0.20,         // 20% - Room count match
  amenities: 0.15,     // 15% - Amenities/features match
  availability: 0.10   // 10% - Availability date match
};

export class WhatsAppMatcher {
  private supabase: any;
  private weights: typeof DEFAULT_WEIGHTS;

  constructor(supabase: any, customWeights?: Partial<typeof DEFAULT_WEIGHTS>) {
    this.supabase = supabase;
    this.weights = { ...DEFAULT_WEIGHTS, ...customWeights };
  }

  /**
   * Find matching properties for a WhatsApp lead
   */
  async findMatches(leadId: string, orgId: string, limit: number = 10): Promise<MatchResult[]> {
    // Get the WhatsApp lead data
    const { data: lead, error: leadError } = await this.supabase
      .from('whatsapp_leads')
      .select('*')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .single();

    if (leadError || !lead) {
      throw new Error('WhatsApp lead not found');
    }

    // Get active properties for the organization
    const { data: properties, error: propertiesError } = await this.supabase
      .from('properties')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true);

    if (propertiesError) {
      throw new Error('Failed to fetch properties');
    }

    if (!properties || properties.length === 0) {
      return [];
    }

    // Calculate matches
    const matches: MatchResult[] = [];

    for (const property of properties) {
      const matchResult = this.calculateMatch(lead, property);
      if (matchResult.score > 0) {
        matches.push(matchResult);
      }
    }

    // Sort by score (highest first) and limit results
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Calculate match score between a lead and property
   */
  private calculateMatch(lead: WhatsAppLead, property: Property): MatchResult {
    const reasons: MatchReason[] = [];
    let totalScore = 0;

    // 1. Location matching
    const locationMatch = this.calculateLocationMatch(lead, property);
    reasons.push(locationMatch);
    totalScore += locationMatch.score * this.weights.location;

    // 2. Budget matching
    const budgetMatch = this.calculateBudgetMatch(lead, property);
    reasons.push(budgetMatch);
    totalScore += budgetMatch.score * this.weights.budget;

    // 3. Rooms matching
    const roomsMatch = this.calculateRoomsMatch(lead, property);
    reasons.push(roomsMatch);
    totalScore += roomsMatch.score * this.weights.rooms;

    // 4. Amenities matching
    const amenitiesMatch = this.calculateAmenitiesMatch(lead, property);
    reasons.push(amenitiesMatch);
    totalScore += amenitiesMatch.score * this.weights.amenities;

    // 5. Availability matching
    const availabilityMatch = this.calculateAvailabilityMatch(lead, property);
    reasons.push(availabilityMatch);
    totalScore += availabilityMatch.score * this.weights.availability;

    return {
      property_id: property.id,
      score: Math.round(totalScore * 100), // Convert to 0-100 scale
      reasons
    };
  }

  private calculateLocationMatch(lead: WhatsAppLead, property: Property): MatchReason {
    let score = 0;
    let details = '';

    if (!lead.krayot_area) {
      return {
        factor: 'location',
        score: 0.5, // Neutral score if no preference specified
        weight: this.weights.location,
        details: 'לא צוין העדפת מיקום'
      };
    }

    const leadArea = lead.krayot_area.toLowerCase();
    const propertyCity = property.city?.toLowerCase() || '';
    const propertyRegion = property.region?.toLowerCase() || '';

    // Exact city match
    if (propertyCity.includes(leadArea) || leadArea.includes(propertyCity)) {
      score = 1.0;
      details = `התאמה מדויקת: ${property.city}`;
    }
    // Region match
    else if (propertyRegion.includes(leadArea) || leadArea.includes(propertyRegion)) {
      score = 0.8;
      details = `התאמה אזורית: ${property.region || property.city}`;
    }
    // Krayot general match
    else if (leadArea.includes('קרי') && (propertyCity.includes('קרי') || propertyRegion?.includes('קרי'))) {
      score = 0.6;
      details = `באזור הקריות: ${property.city}`;
    }
    else {
      score = 0.2;
      details = `לא באזור המועדף: ${property.city}`;
    }

    return {
      factor: 'location',
      score,
      weight: this.weights.location,
      details
    };
  }

  private calculateBudgetMatch(lead: WhatsAppLead, property: Property): MatchReason {
    if (!lead.budget || !property.price) {
      return {
        factor: 'budget',
        score: 0.5,
        weight: this.weights.budget,
        details: 'מידע תקציב חסר'
      };
    }

    const leadBudget = lead.budget;
    const propertyPrice = property.price;
    const ratio = propertyPrice / leadBudget;

    let score = 0;
    let details = '';

    if (ratio <= 1.0) {
      // Property is within or below budget
      score = 1.0;
      details = `בתקציב: ₪${propertyPrice.toLocaleString()} (תקציב: ₪${leadBudget.toLocaleString()})`;
    } else if (ratio <= 1.1) {
      // Up to 10% over budget
      score = 0.8;
      details = `מעט מעל התקציב: ₪${propertyPrice.toLocaleString()} (+${Math.round((ratio - 1) * 100)}%)`;
    } else if (ratio <= 1.2) {
      // Up to 20% over budget
      score = 0.5;
      details = `מעל התקציב: ₪${propertyPrice.toLocaleString()} (+${Math.round((ratio - 1) * 100)}%)`;
    } else {
      // More than 20% over budget
      score = 0.2;
      details = `הרבה מעל התקציב: ₪${propertyPrice.toLocaleString()} (+${Math.round((ratio - 1) * 100)}%)`;
    }

    return {
      factor: 'budget',
      score,
      weight: this.weights.budget,
      details
    };
  }

  private calculateRoomsMatch(lead: WhatsAppLead, property: Property): MatchReason {
    if (!lead.rooms || !property.rooms) {
      return {
        factor: 'rooms',
        score: 0.5,
        weight: this.weights.rooms,
        details: 'מידע חדרים חסר'
      };
    }

    const leadRooms = lead.rooms;
    const propertyRooms = property.rooms;
    const difference = Math.abs(propertyRooms - leadRooms);

    let score = 0;
    let details = '';

    if (difference === 0) {
      score = 1.0;
      details = `התאמה מושלמת: ${propertyRooms} חדרים`;
    } else if (difference <= 0.5) {
      score = 0.8;
      details = `קרוב מאוד: ${propertyRooms} חדרים (מבוקש: ${leadRooms})`;
    } else if (difference <= 1) {
      score = 0.6;
      details = `הפרש קטן: ${propertyRooms} חדרים (מבוקש: ${leadRooms})`;
    } else {
      score = 0.3;
      details = `הפרש גדול: ${propertyRooms} חדרים (מבוקש: ${leadRooms})`;
    }

    return {
      factor: 'rooms',
      score,
      weight: this.weights.rooms,
      details
    };
  }

  private calculateAmenitiesMatch(lead: WhatsAppLead, property: Property): MatchReason {
    let score = 0.5; // Base score
    let matchedFeatures: string[] = [];
    let missingFeatures: string[] = [];

    // Check specific boolean amenities
    const amenityChecks = [
      { leadPref: lead.pets, propertyHas: property.pets_allowed, name: 'בעלי חיים' },
      { leadPref: lead.mamad, propertyHas: property.amenities?.mamad, name: 'ממ״ד' },
      { leadPref: lead.balcony, propertyHas: property.amenities?.balcony, name: 'מרפסת' },
      { leadPref: lead.furnished, propertyHas: property.amenities?.furnished, name: 'מרוהט' }
    ];

    let totalChecks = 0;
    let positiveMatches = 0;

    for (const check of amenityChecks) {
      if (check.leadPref === true) {
        totalChecks++;
        if (check.propertyHas === true) {
          positiveMatches++;
          matchedFeatures.push(check.name);
        } else {
          missingFeatures.push(check.name);
        }
      }
    }

    // Check features array
    if (lead.features && lead.features.length > 0) {
      const propertyAmenities = property.amenities || {};
      
      for (const feature of lead.features) {
        totalChecks++;
        const featureLower = feature.toLowerCase();
        
        // Check if property has this feature
        let hasFeature = false;
        
        if (featureLower.includes('חניה') && propertyAmenities.parking) {
          hasFeature = true;
        } else if (featureLower.includes('מעלית') && propertyAmenities.elevator) {
          hasFeature = true;
        } else if (featureLower.includes('מזגן') && propertyAmenities.air_conditioning) {
          hasFeature = true;
        }
        // Add more feature mappings as needed
        
        if (hasFeature) {
          positiveMatches++;
          matchedFeatures.push(feature);
        } else {
          missingFeatures.push(feature);
        }
      }
    }

    // Calculate score based on matches
    if (totalChecks > 0) {
      score = positiveMatches / totalChecks;
    }

    let details = '';
    if (matchedFeatures.length > 0) {
      details += `יש: ${matchedFeatures.join(', ')}`;
    }
    if (missingFeatures.length > 0) {
      if (details) details += ' | ';
      details += `חסר: ${missingFeatures.join(', ')}`;
    }
    if (!details) {
      details = 'לא צוינו דרישות מיוחדות';
    }

    return {
      factor: 'amenities',
      score,
      weight: this.weights.amenities,
      details
    };
  }

  private calculateAvailabilityMatch(lead: WhatsAppLead, property: Property): MatchReason {
    if (!lead.move_in_date) {
      return {
        factor: 'availability',
        score: 0.7, // Neutral-positive if no specific date required
        weight: this.weights.availability,
        details: 'לא צוין תאריך כניסה'
      };
    }

    if (!property.available_from) {
      return {
        factor: 'availability',
        score: 0.5,
        weight: this.weights.availability,
        details: 'תאריך זמינות לא ידוע'
      };
    }

    try {
      const leadDate = new Date(lead.move_in_date);
      const propertyDate = new Date(property.available_from);
      const daysDiff = Math.ceil((propertyDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24));

      let score = 0;
      let details = '';

      if (daysDiff <= 0) {
        // Property available before or on desired date
        score = 1.0;
        details = `זמין מיד (${property.available_from})`;
      } else if (daysDiff <= 30) {
        // Available within a month
        score = 0.8;
        details = `זמין בעוד ${daysDiff} ימים (${property.available_from})`;
      } else if (daysDiff <= 60) {
        // Available within two months
        score = 0.6;
        details = `זמין בעוד ${Math.round(daysDiff / 30)} חודשים (${property.available_from})`;
      } else {
        // Available much later
        score = 0.3;
        details = `זמין רק ב-${property.available_from}`;
      }

      return {
        factor: 'availability',
        score,
        weight: this.weights.availability,
        details
      };
    } catch (error) {
      return {
        factor: 'availability',
        score: 0.5,
        weight: this.weights.availability,
        details: 'שגיאה בפרסור תאריכים'
      };
    }
  }

  /**
   * Save matches to database
   */
  async saveMatches(leadId: string, orgId: string, matches: MatchResult[]): Promise<void> {
    // Get the associated lead_id from whatsapp_leads
    const { data: whatsappLead } = await this.supabase
      .from('whatsapp_leads')
      .select('lead_id')
      .eq('id', leadId)
      .single();

    if (!whatsappLead?.lead_id) {
      throw new Error('Associated lead not found');
    }

    // Prepare match records
    const matchRecords = matches.map(match => ({
      org_id: orgId,
      lead_id: whatsappLead.lead_id,
      property_id: match.property_id,
      score: match.score,
      reasons: match.reasons,
      status: 'pending'
    }));

    // Insert matches
    const { error } = await this.supabase
      .from('matches')
      .insert(matchRecords);

    if (error) {
      throw new Error(`Failed to save matches: ${error.message}`);
    }
  }
}
