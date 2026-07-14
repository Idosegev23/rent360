import Link from 'next/link'
import { Home, KeyRound, ChevronLeft } from 'lucide-react'

export const metadata = { title: 'רנט 360 — בואו נתחיל' }

/** Public Facebook onboarding chooser: renter vs landlord. */
export default function JoinChooserPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-gradient-to-b from-brand-primary/5 to-white px-5 py-12 flex flex-col items-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-3xl font-extrabold text-brand-primary">רנט 360</div>
          <p className="mt-2 text-gray-500">תיווך דירות בקריות, בחיפה והסביבה</p>
        </div>

        <h1 className="text-xl font-bold text-gray-800 mb-4 text-center">איך אפשר לעזור?</h1>

        <div className="space-y-3">
          <Link href="/join/renter" className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-primary hover:shadow-md transition">
            <div className="rounded-xl bg-brand-primary/10 p-3 text-brand-primary"><Home className="h-7 w-7" /></div>
            <div className="flex-1">
              <div className="font-bold text-gray-800">מחפשים דירה</div>
              <div className="text-sm text-gray-500">נכיר אתכם ונתאים דירות שמתאימות בדיוק לכם</div>
            </div>
            <ChevronLeft className="h-5 w-5 text-gray-300" />
          </Link>

          <Link href="/join/landlord" className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:border-brand-primary hover:shadow-md transition">
            <div className="rounded-xl bg-brand-primary/10 p-3 text-brand-primary"><KeyRound className="h-7 w-7" /></div>
            <div className="flex-1">
              <div className="font-bold text-gray-800">יש לי דירה להשכרה</div>
              <div className="text-sm text-gray-500">נמצא לכם שוכרים איכותיים, בלי כאב ראש</div>
            </div>
            <ChevronLeft className="h-5 w-5 text-gray-300" />
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">בלחיצה על שליחה אתם מאשרים שניצור אתכם קשר בוואטסאפ.</p>
      </div>
    </main>
  )
}
