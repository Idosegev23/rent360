import { OnboardingForm } from '@/components/onboarding/OnboardingForm'

export const metadata = { title: 'רנט 360 — מחפשים דירה' }

export default function JoinRenterPage() {
  return (
    <OnboardingForm
      audience="renter"
      title="מחפשים דירה?"
      subtitle="כמה פרטים קצרים ונתחיל להתאים לכם דירות. נשלח לכם הודעת וואטסאפ עם עוד כמה שאלות."
      fields={[
        { name: 'name', label: 'שם', required: true, placeholder: 'איך קוראים לכם?' },
        { name: 'phone', label: 'טלפון (וואטסאפ)', type: 'tel', inputMode: 'tel', required: true, placeholder: '05X-XXXXXXX' },
        { name: 'city', label: 'איזו עיר מעניינת אתכם?', placeholder: 'למשל: קריית ביאליק' },
        { name: 'budget', label: 'תקציב חודשי (₪)', type: 'number', inputMode: 'numeric', placeholder: 'למשל: 5000' },
      ]}
      submitLabel="שלחו ונתחיל"
      successTitle="נהדר, קיבלנו!"
      successBody="נשלח לכם עכשיו הודעת וואטסאפ עם כמה שאלות קצרות כדי להתאים לכם דירות מדויקות."
    />
  )
}
