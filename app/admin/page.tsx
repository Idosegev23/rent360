import Link from 'next/link'
import { MessageSquareText, ChevronLeft } from 'lucide-react'
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import Can from '@/components/auth/Can'

export default function Page() {
  return (
    <main className="pb-20" dir="rtl">
      <h1 className="mb-4 text-2xl font-bold">הגדרות</h1>
      <div className="max-w-xl space-y-4">
        <GoogleConnectionCard />

        <Can cap="settings.admin">
        <Link
          href="/admin/interview"
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
        >
          <div className="rounded-md bg-brand-primary/10 p-2 text-brand-primary"><MessageSquareText className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="font-medium">עורך שאלון השוכר</div>
            <div className="text-sm text-gray-500">עריכת הנושאים שבוט הוואטסאפ אוסף מהשוכר בתשאול</div>
          </div>
          <ChevronLeft className="h-5 w-5 text-gray-300" />
        </Link>
        </Can>
      </div>
    </main>
  )
}
