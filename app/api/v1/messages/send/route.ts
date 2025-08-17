import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { renderTemplate } from '../../../../../lib/templates'
import { sendWhatsApp } from '../../../../../lib/messaging'

export async function POST(req: NextRequest){
  let lead_id: string | undefined
  let property_id: string | undefined
  let template: string | undefined
  try {
    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await req.json()
      lead_id = body?.lead_id
      property_id = body?.property_id
      template = body?.template
    } else {
      const form = await req.formData()
      lead_id = String(form.get('lead_id') || '')
      property_id = String(form.get('property_id') || '')
      template = String(form.get('template') || '')
    }
  } catch {}
  if(!lead_id || !property_id || !template){
    return NextResponse.json({ error:{ code:'INVALID' } }, { status: 422 })
  }
  const sb = supabaseService()
  const { data: lead } = await sb.from('leads').select('*').eq('id', lead_id).maybeSingle()
  const { data: property } = await sb.from('properties').select('*').eq('id', property_id).maybeSingle()
  if(!lead || !property) return NextResponse.json({ error:{ code:'NOT_FOUND' } }, { status: 404 })

  const text = renderTemplate(template, {
    full_name: lead.full_name || '',
    city: property.city || '',
    neighborhood: property.neighborhood || '',
    price: String(property.price || ''),
    rooms: String(property.rooms || ''),
    sqm: String(property.sqm || ''),
    link: property.link || '',
    title: property.title || '',
  })

  try {
    const phone = lead.phone as string
    if (!phone) throw new Error('Lead has no phone')
    const res = await sendWhatsApp(phone, text)
    await sb.from('messages').insert({
      org_id: lead.org_id,
      thread_id: null,
      lead_id: lead_id,
      property_id: property_id,
      channel: 'whatsapp',
      direction: 'out',
      body: text,
      attachments: null,
      status: 'sent',
      metadata: { greenapi: res },
    } as any)
    return NextResponse.json({ ok:true })
  } catch (e:any) {
    await sb.from('messages').insert({
      org_id: lead.org_id,
      thread_id: null,
      lead_id: lead_id,
      property_id: property_id,
      channel: 'whatsapp',
      direction: 'out',
      body: text,
      attachments: null,
      status: 'failed',
      metadata: { error: e?.message },
    } as any)
    return NextResponse.json({ error:{ code:'SEND_FAILED', message: e?.message } }, { status: 500 })
  }
}

