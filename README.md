# 🏠 Rent360 - פלטפורמת ניהול נדל"ן מתקדמת

> **פלטפורמה מודרנית לניהול נכסים ולידים עם מנוע התאמות חכם**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-DB-green?style=flat-square&logo=supabase)](https://supabase.com/)

## ✨ תכונות עיקריות

### 🏢 **ניהול נכסים מתקדם**
- 📋 רישום ועריכת נכסים עם שדות מורחבים
- 🖼️ גלריות תמונות אינטראקטיביות
- 🔍 חיפוש וסינון מתקדמים
- 📊 תצוגות רשת ורשימה
- 📱 עיצוב Mobile-first עם תמיכה ב-RTL

### 👥 **ניהול לידים חכם**
- 📝 רישום לידים עם דרישות מפורטות
- 📞 ניהול פרטי קשר
- 🎯 הגדרת העדפות מיקום ותקציב
- ✅ דרישות חובה וחובת-מחסור

### 🎯 **מנוע התאמות מתקדם**
- 📈 חישוב אחוזי התאמה מדויקים (0-100%)
- ⚠️ דרישות חובה מפילות את ההתאמה
- 📊 פירוט מלא של כל קריטריון
- 🔍 הצגת סיבות אי-התאמה
- ⚖️ משקלים דינמיים לכל קריטריון

### 📊 **דשבורד אנליטי**
- 📈 KPI cards עם סטטיסטיקות בזמן אמת
- 📉 גרפים קומפקטיים ומעוצבים
- 🎨 עיצוב עקבי עם צבעי המותג
- 📱 רספונסיבי מלא

## 🛠️ סטק טכנולוגי

### **Frontend**
- **Next.js 14** - App Router + Server Components
- **TypeScript** - Type safety מלא
- **Tailwind CSS** - עיצוב מודרני ורספונסיבי
- **Chart.js** - גרפים ואנליטיקה
- **Lucide React** - אייקונים מודרניים

### **Backend & Database**
- **Supabase** - PostgreSQL + Auth + Storage
- **Next.js API Routes** - RESTful API
- **Row Level Security** - אבטחה ברמת השורה
- **Real-time subscriptions** - עדכונים בזמן אמת

### **פיתוח וניהול**
- **ESLint + Prettier** - איכות קוד
- **Git** - ניהול גרסאות
- **Memory Bank** - תיעוד פרויקט מתמשך

## 🚀 התקנה והרצה

### דרישות מקדימות
```bash
Node.js 18+ 
npm או yarn
חשבון Supabase
```

### התקנה
```bash
# שכפל את הפרויקט
git clone https://github.com/YOUR_USERNAME/rent360.git
cd rent360

# התקן dependencies
npm install

# העתק קובץ environment
cp .env.example .env.local
```

### הגדרת Supabase
```bash
# ב-.env.local הוסף:
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### הרצת הפרויקט
```bash
# הרצה בסביבת פיתוח
npm run dev

# בניה לייצור
npm run build
npm start
```

## 📋 מבנה הפרויקט

```
rent360/
├── app/                    # Next.js App Router
│   ├── api/v1/            # API endpoints
│   ├── dashboard/         # דשבורד ראשי
│   ├── properties/        # ניהול נכסים
│   ├── leads/            # ניהול לידים
│   └── matches/          # מנוע התאמות
├── components/            # קומפוננטים לשימוש חוזר
│   ├── dashboard/        # קומפוננטי דשבורד
│   ├── properties/       # קומפוננטי נכסים
│   ├── leads/           # קומפוננטי לידים
│   └── matches/         # קומפוננטי התאמות
├── lib/                  # Utilities ולוגיקה עסקית
│   ├── matching.ts      # מנוע ההתאמות
│   ├── supabase.ts      # Supabase clients
│   └── schemas.ts       # Zod validations
├── supabase/            # Database migrations
├── types/               # TypeScript definitions
└── memory-bank/         # תיעוד פרויקט
```

## 🎯 מנוע ההתאמות

### אלגוריתם חישוב הציון
```typescript
ציון סופי = (
  מחיר × 30% +
  מיקום × 25% + 
  חדרים × 20% +
  דרישות × 15% +
  תאריך כניסה × 10%
) × 100
```

### דרישות חובה
- ❌ **חסרה דרישת חובה אחת** → ציון 0%
- ✅ **כל הדרישות מולאו** → חישוב ציון רגיל

### דוגמאות התאמה
```
ליד: 3 חדרים בתל אביב, ₪5,000-7,000, חניה (חובה)
נכס: 3 חדרים בתל אביב, ₪6,000, יש חניה

✅ מחיר: 100% (בתקציב)
✅ מיקום: 100% (עיר מועדפת)  
✅ חדרים: 100% (מתאים)
✅ דרישות: 100% (יש חניה)
⚠️ תאריך: 50% (לא מוגדר)

🎯 ציון סופי: 92% - התאמה מעולה!
```

## 🎨 עיצוב ו-UX

### צבעי המותג
```css
--brand-primary: #FF6B35;    /* כתום ראשי */
--brand-accent: #2D3748;     /* אפור כהה */
--brand-bg: #FFF5F5;         /* רקע בהיר */
--brand-success: #48BB78;    /* ירוק */
--brand-warning: #ED8936;    /* כתום */
```

### עקרונות עיצוב
- 📱 **Mobile-first** - מותאם למובייל קודם
- 🔄 **RTL Support** - תמיכה מלאה בעברית
- 🎨 **Brand Consistency** - עקביות ויזואלית
- ⚡ **Performance** - טעינה מהירה
- ♿ **Accessibility** - נגישות לכולם

## 📊 API Documentation

### Endpoints עיקריים
```
GET  /api/v1/properties     # רשימת נכסים
POST /api/v1/properties     # יצירת נכס
GET  /api/v1/leads          # רשימת לידים  
POST /api/v1/leads          # יצירת ליד
GET  /api/v1/matches        # התאמות + debug info
POST /api/v1/messages/send  # שליחת הודעות
```

### Authentication
כל ה-API endpoints מוגנים ב-Supabase Auth עם RLS policies.

## 🔧 הגדרות מפתח

### Matching Engine Weights
```typescript
const DEFAULT_WEIGHTS = {
  price: 0.3,        // 30% - הכי חשוב
  location: 0.25,    // 25% - מיקום
  rooms: 0.2,        // 20% - מספר חדרים  
  amenities: 0.15,   // 15% - דרישות
  moveIn: 0.1        // 10% - תאריך כניסה
}
```

## 🤝 תרומה לפרויקט

1. **Fork** את הפרויקט
2. **צור branch** לפיצ'ר שלך (`git checkout -b feature/amazing-feature`)
3. **Commit** את השינויים (`git commit -m 'Add amazing feature'`)
4. **Push** ל-branch (`git push origin feature/amazing-feature`)
5. **פתח Pull Request**

## 📝 רשיון

פרויקט זה מוגן תחת רשיון MIT. ראה קובץ `LICENSE` לפרטים.

## 📞 צור קשר

**פרויקט Rent360**
- 📧 Email: contact@rent360.co.il
- 🌐 Website: [rent360.co.il](https://rent360.co.il)
- 💼 LinkedIn: [Rent360](https://linkedin.com/company/rent360)

---

**🚀 Built with ❤️ for the Israeli Real Estate Market**