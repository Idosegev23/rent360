import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'

const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/nx6q9w12rdc1f0vq3lvqoganmtj7g2d8';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fullName, phone, email, message, propertyId, shareToken } = body;

    // Validate required fields
    if (!fullName || !phone || !shareToken) {
      return NextResponse.json(
        { error: 'חסרים שדות חובה' },
        { status: 400 }
      );
    }

    const sb = supabaseService();

    // Get share and property details
    const { data: share } = await sb
      .from('property_shares')
      .select('property_id')
      .eq('token', shareToken)
      .maybeSingle();

    if (!share) {
      return NextResponse.json(
        { error: 'שיתוף לא נמצא' },
        { status: 404 }
      );
    }

    // Get full property details
    const { data: property } = await sb
      .from('properties')
      .select('*')
      .eq('id', share.property_id)
      .maybeSingle();

    if (!property) {
      return NextResponse.json(
        { error: 'נכס לא נמצא' },
        { status: 404 }
      );
    }

    // Split full name into first and last name
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Prepare webhook payload
    const webhookPayload = {
      // Lead details
      lead: {
        firstName,
        lastName,
        fullName, // Keep full name for reference
        phone,
        email: email || null,
        message: message || null,
        submittedAt: new Date().toISOString(),
      },
      // Property details
      property: {
        id: property.id,
        title: property.title,
        city: property.city,
        neighborhood: property.neighborhood,
        address: property.address,
        price: property.price,
        rooms: property.rooms,
        sqm: property.sqm,
        type: property.type,
        availableFrom: property.available_from,
        description: property.description,
        amenities: property.amenities,
        images: property.images,
        link: property.link,
        contactName: property.contact_name,
        contactPhone: property.contact_phone,
        // Internal app link
        appUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/properties/${property.id}`,
      },
      // Share context
      share: {
        token: shareToken,
        sharedUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${shareToken}`,
      },
    };

    // Send to Make.com webhook
    const webhookResponse = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      console.error('Webhook failed:', await webhookResponse.text());
      throw new Error('שגיאה בשליחת הנתונים');
    }

    return NextResponse.json({
      success: true,
      message: 'הפרטים נשלחו בהצלחה',
    });
  } catch (error) {
    console.error('Error in shared-property-lead:', error);
    return NextResponse.json(
      { error: 'שגיאה בשליחת הפרטים' },
      { status: 500 }
    );
  }
}

