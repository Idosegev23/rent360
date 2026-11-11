import { redirect } from 'next/navigation'

// "מה לעשות עכשיו" and "משימות" are one screen now: the conversation signals live under the "מהשיחות" tab.
export default function ActionPage() {
  redirect('/tasks?tab=signals')
}
