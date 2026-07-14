import { OnboardingForm } from '@/components/onboarding/OnboardingForm'

export const metadata = { title: 'רנט 360 — יש לי דירה' }

export default function JoinLandlordPage() {
  return (
    <OnboardingForm
      audience="landlord"
      title="יש לכם דירה להשכרה?"
      subtitle="השאירו פרטים ונחזור אליכם. נמצא לכם שוכרים איכותיים ונטפל בכל התהליך."
      fields={[
        { name: 'name', label: 'שם', required: true, placeholder: 'איך קוראים לכם?' },
        { name: 'phone', label: 'טלפון (וואטסאפ)', type: 'tel', inputMode: 'tel', required: true, placeholder: '05X-XXXXXXX' },
        { name: 'city', label: 'עיר', placeholder: 'למשל: קריית מוצקין' },
        { name: 'address', label: 'כתובת הדירה', placeholder: 'רחוב ומספר' },
        { name: 'price', label: 'מחיר מבוקש לחודש (₪)', type: 'number', inputMode: 'numeric', placeholder: 'למשל: 4800' },
      ]}
      submitLabel="שלחו ונחזור אליכם"
      successTitle="תודה, קיבלנו!"
      successBody="ניצור אתכם קשר בהקדם כדי לקדם את השכרת הדירה."
    />
  )
}
