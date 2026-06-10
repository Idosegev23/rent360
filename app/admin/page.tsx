import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'

export default function Page() {
  return (
    <main className="pb-20" dir="rtl">
      <h1 className="mb-4 text-2xl font-bold">הגדרות</h1>
      <div className="max-w-xl space-y-4">
        <GoogleConnectionCard />
      </div>
    </main>
  )
}
