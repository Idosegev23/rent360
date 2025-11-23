import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// Schema for WhatsApp bot JSON output
const WhatsAppBotDataSchema = z.object({
  summary_he: z.string(),
  needs: z.object({
    krayot_area: z.string().nullable(),
    budget: z.number().nullable(),
    rooms: z.number().nullable(),
    move_in_date: z.string().nullable(),
    features: z.array(z.string()).default([]),
    pets: z.boolean().nullable(),
    furnished: z.boolean().nullable(),
    mamad: z.boolean().nullable(),
    balcony: z.boolean().nullable(),
    contract_needs: z.object({
      has_checks: z.boolean().nullable(),
      has_guarantors: z.boolean().nullable(),
    }),
    extra_requests: z.array(z.string()).default([]),
  }),
  personal: z.object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  }),
  end_conversation: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    
    // Get the current user and org_id
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's org_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData?.org_id) {
      return NextResponse.json({ error: 'User organization not found' }, { status: 400 });
    }

    const body = await request.json();
    
    // Validate the incoming data
    const validatedData = WhatsAppBotDataSchema.parse(body);
    
    // Insert into whatsapp_leads table
    const { data: whatsappLead, error: insertError } = await supabase
      .from('whatsapp_leads')
      .insert({
        org_id: userData.org_id,
        raw_json: body,
        conversation_summary: validatedData.summary_he,
        first_name: validatedData.personal.first_name,
        last_name: validatedData.personal.last_name,
        krayot_area: validatedData.needs.krayot_area,
        budget: validatedData.needs.budget,
        rooms: validatedData.needs.rooms,
        move_in_date: validatedData.needs.move_in_date,
        pets: validatedData.needs.pets,
        furnished: validatedData.needs.furnished,
        mamad: validatedData.needs.mamad,
        balcony: validatedData.needs.balcony,
        has_checks: validatedData.needs.contract_needs.has_checks,
        has_guarantors: validatedData.needs.contract_needs.has_guarantors,
        features: validatedData.needs.features,
        extra_requests: validatedData.needs.extra_requests,
        processing_status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting WhatsApp lead:', insertError);
      return NextResponse.json({ error: 'Failed to save lead data' }, { status: 500 });
    }

    // Optionally, trigger processing immediately
    // This could be done in a background job or queue
    await processWhatsAppLead(supabase, whatsappLead.id, userData.org_id);

    return NextResponse.json({
      success: true,
      lead_id: whatsappLead.id,
      message: 'WhatsApp lead data received and processed'
    });

  } catch (error) {
    console.error('Error processing WhatsApp lead:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Invalid data format',
        details: error.issues
      }, { status: 400 });
    }

    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// Function to process WhatsApp lead and create a regular lead
async function processWhatsAppLead(supabase: any, whatsappLeadId: string, orgId: string) {
  try {
    // Get the WhatsApp lead data
    const { data: whatsappLead, error: fetchError } = await supabase
      .from('whatsapp_leads')
      .select('*')
      .eq('id', whatsappLeadId)
      .single();

    if (fetchError || !whatsappLead) {
      throw new Error('WhatsApp lead not found');
    }

    // Parse move_in_date to proper date format
    let moveInDate = null;
    if (whatsappLead.move_in_date) {
      // Try to parse various Hebrew date formats
      moveInDate = parseMoveInDate(whatsappLead.move_in_date);
    }

    // Create a regular lead from WhatsApp data
    const leadData = {
      org_id: orgId,
      external_id: `whatsapp_${whatsappLeadId}`,
      source_id: 'whatsapp_bot',
      first_name: whatsappLead.first_name,
      last_name: whatsappLead.last_name,
      full_name: [whatsappLead.first_name, whatsappLead.last_name].filter(Boolean).join(' '),
      budget_min: whatsappLead.budget ? Math.floor(whatsappLead.budget * 0.9) : null, // 10% below stated budget
      budget_max: whatsappLead.budget,
      preferred_cities: whatsappLead.krayot_area ? [whatsappLead.krayot_area] : [],
      preferred_rooms: whatsappLead.rooms,
      move_in_from: moveInDate,
      pets: whatsappLead.pets,
      must_haves: buildMustHaves(whatsappLead),
      nice_to_haves: whatsappLead.features || [],
      required_fields: {
        has_checks: whatsappLead.has_checks,
        has_guarantors: whatsappLead.has_guarantors
      },
      notes: whatsappLead.conversation_summary,
      status: 'new'
    };

    // Insert the lead
    const { data: newLead, error: leadError } = await supabase
      .from('leads')
      .insert(leadData)
      .select()
      .single();

    if (leadError) {
      throw leadError;
    }

    // Update WhatsApp lead with processing status
    await supabase
      .from('whatsapp_leads')
      .update({
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
        lead_id: newLead.id
      })
      .eq('id', whatsappLeadId);

    return newLead;

  } catch (error) {
    console.error('Error processing WhatsApp lead:', error);
    
    // Update WhatsApp lead with error status
    await supabase
      .from('whatsapp_leads')
      .update({
        processing_status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', whatsappLeadId);

    throw error;
  }
}

// Helper function to parse Hebrew date formats
function parseMoveInDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Hebrew month names
  const hebrewMonths: { [key: string]: number } = {
    'ינואר': 0, 'פברואר': 1, 'מרץ': 2, 'אפריל': 3, 'מאי': 4, 'יוני': 5,
    'יולי': 6, 'אוגוסט': 7, 'ספטמבר': 8, 'אוקטובר': 9, 'נובמבר': 10, 'דצמבר': 11
  };

  // Try to parse different formats
  try {
    // "אוגוסט" -> August of current year
    const monthIndex = hebrewMonths[dateStr];
    if (monthIndex !== undefined) {
      const year = monthIndex < currentMonth ? currentYear + 1 : currentYear;
      return new Date(year, monthIndex, 1).toISOString().split('T')[0] || null;
    }

    // "בעוד חודש" -> next month
    if (dateStr.includes('בעוד חודש')) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return nextMonth.toISOString().split('T')[0] || null;
    }

    // "בעוד שבועיים" -> in 2 weeks
    if (dateStr.includes('בעוד שבועיים')) {
      const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      return inTwoWeeks.toISOString().split('T')[0] || null;
    }

    // "מיד" or "כמה שיותר מהר" -> today
    if (dateStr.includes('מיד') || dateStr.includes('מהר')) {
      return now.toISOString().split('T')[0] || null;
    }

    // Try to parse as ISO date if it looks like one
    const isoMatch = dateStr.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      return isoMatch[0] || null;
    }

    return null;
  } catch (error) {
    console.error('Error parsing move-in date:', error);
    return null;
  }
}

// Helper function to build must-haves array
function buildMustHaves(whatsappLead: any): string[] {
  const mustHaves: string[] = [];

  if (whatsappLead.pets === true) mustHaves.push('pets_allowed');
  if (whatsappLead.furnished === true) mustHaves.push('furnished');
  if (whatsappLead.mamad === true) mustHaves.push('mamad');
  if (whatsappLead.balcony === true) mustHaves.push('balcony');

  // Add features that are marked as important
  if (whatsappLead.features) {
    whatsappLead.features.forEach((feature: string) => {
      if (!mustHaves.includes(feature)) {
        mustHaves.push(feature);
      }
    });
  }

  return mustHaves;
}
