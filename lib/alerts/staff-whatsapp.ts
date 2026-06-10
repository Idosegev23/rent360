import { sendTemplate, type TemplateComponent } from '../whatsapp/meta-provider'
import { supabaseService } from '../supabase'

/**
 * Outbound WhatsApp nudges to a SINGLE staff member (task/meeting reminders), targeting
 * `users.phone`. Gated on Meta template approval — no-ops cleanly (returns skipped) until the
 * staff templates are approved, so the cron can call it safely today. The in-app /tasks +
 * Action Center cover the reminder UX meanwhile.
 */
const TASK_TEMPLATE = process.env.STAFF_TASK_TEMPLATE || 'staff_task_reminder_v1'
const MEETING_TEMPLATE = process.env.STAFF_MEETING_TEMPLATE || 'staff_meeting_reminder_v1'

type StaffResult = { sent: number; skipped?: string }

async function staffTarget(orgId: string, userId: string): Promise<{ phone: string; name: string } | null> {
  const sb = supabaseService()
  const { data } = await sb
    .from('users')
    .select('phone, name, is_active, receives_alerts')
    .eq('id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data || !data.phone || data.is_active === false || data.receives_alerts === false) return null
  return { phone: data.phone, name: data.name || 'צוות' }
}

async function templateApproved(name: string): Promise<boolean> {
  const { data } = await supabaseService().from('whatsapp_templates').select('status').eq('name', name).maybeSingle()
  return data?.status === 'approved'
}

async function audit(orgId: string, templateName: string, params: Record<string, unknown>): Promise<void> {
  try {
    await supabaseService().from('messages').insert({
      org_id: orgId,
      direction: 'out',
      channel: 'whatsapp',
      status: 'sent',
      meta_message_type: 'template',
      template_name: templateName,
      template_params: params,
      metadata: { staff_reminder: true },
    })
  } catch {/* best-effort */}
}

export async function notifyStaffTask(p: { orgId: string; userId: string; taskId: string; title: string; dueLabel: string }): Promise<StaffResult> {
  const u = await staffTarget(p.orgId, p.userId)
  if (!u) return { sent: 0, skipped: 'no_phone_or_opted_out' }
  if (!(await templateApproved(TASK_TEMPLATE))) return { sent: 0, skipped: 'template_not_approved' }
  const components: TemplateComponent[] = [
    { type: 'body', parameters: [
      { type: 'text', text: u.name },
      { type: 'text', text: p.title.slice(0, 60) },
      { type: 'text', text: p.dueLabel },
    ] },
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'tasks' }] },
  ]
  try {
    await sendTemplate({ to: u.phone, name: TASK_TEMPLATE, language: 'he', components })
    await audit(p.orgId, TASK_TEMPLATE, { kind: 'task_reminder', task_id: p.taskId, to: u.phone })
    return { sent: 1 }
  } catch {
    return { sent: 0, skipped: 'send_failed' }
  }
}

export async function notifyStaffMeeting(p: { orgId: string; userId: string; meetingId: string; title: string; timeLabel: string }): Promise<StaffResult> {
  const u = await staffTarget(p.orgId, p.userId)
  if (!u) return { sent: 0, skipped: 'no_phone_or_opted_out' }
  if (!(await templateApproved(MEETING_TEMPLATE))) return { sent: 0, skipped: 'template_not_approved' }
  const components: TemplateComponent[] = [
    { type: 'body', parameters: [
      { type: 'text', text: u.name },
      { type: 'text', text: p.title.slice(0, 60) },
      { type: 'text', text: p.timeLabel },
    ] },
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'meetings' }] },
  ]
  try {
    await sendTemplate({ to: u.phone, name: MEETING_TEMPLATE, language: 'he', components })
    await audit(p.orgId, MEETING_TEMPLATE, { kind: 'meeting_reminder', meeting_id: p.meetingId, to: u.phone })
    return { sent: 1 }
  } catch {
    return { sent: 0, skipped: 'send_failed' }
  }
}
