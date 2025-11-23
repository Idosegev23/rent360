import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WhatsAppMatcher } from '@/lib/matching/whatsapp-matcher';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const leadId = params.id;
    
    // Verify the WhatsApp lead exists and belongs to the user's org
    const { data: whatsappLead, error: leadError } = await supabase
      .from('whatsapp_leads')
      .select('*')
      .eq('id', leadId)
      .eq('org_id', userData.org_id)
      .single();

    if (leadError || !whatsappLead) {
      return NextResponse.json({ error: 'WhatsApp lead not found' }, { status: 404 });
    }

    // Get matching settings for the organization
    const { data: settings } = await supabase
      .from('settings')
      .select('matching_weights')
      .eq('org_id', userData.org_id)
      .single();

    // Initialize matcher with custom weights if available
    const matcher = new WhatsAppMatcher(
      supabase, 
      settings?.matching_weights || undefined
    );

    // Find matches
    const matches = await matcher.findMatches(leadId, userData.org_id, 20);

    // Save matches to database if there's an associated lead
    if (whatsappLead.lead_id) {
      await matcher.saveMatches(leadId, userData.org_id, matches);
    }

    return NextResponse.json({
      success: true,
      lead_id: leadId,
      matches_count: matches.length,
      matches: matches.map(match => ({
        property_id: match.property_id,
        score: match.score,
        reasons: match.reasons.map(reason => ({
          factor: reason.factor,
          score: Math.round(reason.score * 100),
          weight: Math.round(reason.weight * 100),
          details: reason.details
        }))
      }))
    });

  } catch (error) {
    console.error('Error finding matches for WhatsApp lead:', error);
    return NextResponse.json({
      error: 'Failed to find matches',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const leadId = params.id;
    
    // Get the WhatsApp lead and its associated regular lead
    const { data: whatsappLead, error: leadError } = await supabase
      .from('whatsapp_leads')
      .select(`
        *,
        lead:leads(
          id,
          matches(
            id,
            property_id,
            score,
            reasons,
            status,
            properties(
              id,
              title,
              city,
              neighborhood,
              price,
              rooms,
              images
            )
          )
        )
      `)
      .eq('id', leadId)
      .eq('org_id', userData.org_id)
      .single();

    if (leadError || !whatsappLead) {
      return NextResponse.json({ error: 'WhatsApp lead not found' }, { status: 404 });
    }

    // Format the response
    const matches = whatsappLead.lead?.matches || [];
    
    return NextResponse.json({
      success: true,
      lead: {
        id: whatsappLead.id,
        name: [whatsappLead.first_name, whatsappLead.last_name].filter(Boolean).join(' '),
        summary: whatsappLead.conversation_summary,
        requirements: {
          area: whatsappLead.krayot_area,
          budget: whatsappLead.budget,
          rooms: whatsappLead.rooms,
          move_in_date: whatsappLead.move_in_date,
          features: whatsappLead.features || [],
          pets: whatsappLead.pets,
          furnished: whatsappLead.furnished,
          mamad: whatsappLead.mamad,
          balcony: whatsappLead.balcony
        },
        processing_status: whatsappLead.processing_status
      },
      matches: matches.map((match: any) => ({
        id: match.id,
        score: match.score,
        status: match.status,
        reasons: match.reasons,
        property: {
          id: match.properties.id,
          title: match.properties.title,
          city: match.properties.city,
          neighborhood: match.properties.neighborhood,
          price: match.properties.price,
          rooms: match.properties.rooms,
          images: match.properties.images
        }
      }))
    });

  } catch (error) {
    console.error('Error getting matches for WhatsApp lead:', error);
    return NextResponse.json({
      error: 'Failed to get matches',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
