export const demoProperties = [
  {
    id: 'prop-1',
    title: 'דירת 3 חדרים משופצת',
    city: 'תל אביב',
    neighborhood: 'אבן גבירול',
    price: 6500,
    rooms: 3,
    sqm: 75,
    amenities: { elevator: true, parking: false, balcony: true },
    is_active: true,
  },
  {
    id: 'prop-2',
    title: 'סטודיו מעוצב ליד הים',
    city: 'בת ים',
    neighborhood: 'טיילת',
    price: 4200,
    rooms: 1,
    sqm: 35,
    amenities: { elevator: true, parking: false, balcony: false },
    is_active: true,
  },
  {
    id: 'prop-3',
    title: 'דירת גן 4 חדרים',
    city: 'גבעתיים',
    neighborhood: 'שינקין',
    price: 8900,
    rooms: 4,
    sqm: 110,
    amenities: { elevator: false, parking: true, balcony: true },
    is_active: false,
  },
]

export const demoLeads = [
  {
    id: 'lead-1',
    full_name: 'ישראל ישראלי',
    phone: '+972501234567',
    budget_min: 4500,
    budget_max: 6500,
    preferred_cities: ['תל אביב', 'גבעתיים'],
    preferred_rooms: 3,
    status: 'new',
  },
  {
    id: 'lead-2',
    full_name: 'דנה לוי',
    phone: '+972541112233',
    budget_min: 3500,
    budget_max: 5000,
    preferred_cities: ['בת ים', 'חולון'],
    preferred_rooms: 2,
    status: 'qualified',
  },
]

