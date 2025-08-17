export type Weights = { price:number; location:number; rooms:number; amenities:number; moveIn:number }

export type MatchReason = { 
  factor: string; 
  impact: number; 
  note: string; 
  isMandatory?: boolean;
  matches?: boolean;
}

export type MatchResult = {
  score: number;
  percentage: number;
  reasons: MatchReason[];
  isDisqualified: boolean;
  disqualifyingReasons: string[];
  breakdown: {
    price: { score: number; weight: number; note: string };
    location: { score: number; weight: number; note: string };
    rooms: { score: number; weight: number; note: string };
    amenities: { score: number; weight: number; note: string };
    moveIn: { score: number; weight: number; note: string };
  };
}

export function computeMatchScore(lead:any, property:any, w:Weights): MatchResult {
  const reasons: MatchReason[] = []
  const disqualifyingReasons: string[] = []
  let isDisqualified = false

  // Check mandatory requirements first (these can disqualify)
  const required: Record<string, boolean> = lead?.required_fields || {}
  const missingMandatory: string[] = []
  
  for(const [key, isRequired] of Object.entries(required)){
    if(isRequired){
      const hasAmen = !!property?.amenities?.[key] || !!(property as any)?.[key]
      if(!hasAmen) {
        missingMandatory.push(key)
        disqualifyingReasons.push(`חסר דרישת חובה: ${key}`)
        reasons.push({ 
          factor: 'amenities', 
          impact: 0, 
          note: `חסר חובה: ${key}`, 
          isMandatory: true,
          matches: false
        })
      } else {
        reasons.push({ 
          factor: 'amenities', 
          impact: 0, 
          note: `יש דרישת חובה: ${key}`, 
          isMandatory: true,
          matches: true
        })
      }
    }
  }

  // If any mandatory requirement is missing, disqualify
  if(missingMandatory.length > 0) {
    isDisqualified = true
  }

  // price score
  const budgetMin = lead?.budget_min ?? 0
  const budgetMax = lead?.budget_max ?? Number.MAX_SAFE_INTEGER
  const price = property?.price ?? Number.MAX_SAFE_INTEGER
  let priceScore = 0
  let priceNote = ''
  
  if(price >= budgetMin && price <= budgetMax){ 
    priceScore = 1; 
    priceNote = 'בתוך התקציב'
  } else if(price > 0){
    const dist = price < budgetMin ? (budgetMin - price) / Math.max(1, budgetMin) : (price - budgetMax) / Math.max(1, budgetMax)
    priceScore = Math.max(0, 1 - dist)
    priceNote = price < budgetMin ? 'מתחת לתקציב' : 'מעל התקציב'
  }
  reasons.push({ factor:'price', impact: +(w.price*priceScore), note: priceNote })

  // location score
  const preferred = (lead?.preferred_cities || lead?.preferred_regions || []) as string[]
  let locScore = 0
  let locNote = ''
  
  if(Array.isArray(preferred) && preferred.length>0){
    const inCity = preferred.includes(property?.city)
    locScore = inCity ? 1 : 0
    locNote = inCity? 'עיר מועדפת' : 'עיר לא מועדפת'
  } else {
    locScore = 0.5 // neutral if no preference
    locNote = 'אין העדפת מיקום'
  }
  reasons.push({ factor:'location', impact: +(w.location*locScore), note: locNote })

  // rooms score
  let roomsScore = 0
  let roomsNote = ''
  
  if(lead?.preferred_rooms){
    const diff = Math.abs((property?.rooms ?? 0) - lead.preferred_rooms)
    roomsScore = diff===0 ? 1 : diff===1 ? 0.7 : diff===2 ? 0.4 : 0.1
    roomsNote = diff === 0 ? 'מספר חדרים מושלם' : `הפרש ${diff} חדרים`
  } else {
    roomsScore = 0.5 // neutral if no preference
    roomsNote = 'אין העדפת חדרים'
  }
  reasons.push({ factor:'rooms', impact: +(w.rooms*roomsScore), note: roomsNote })

  // amenities score (non-mandatory amenities)
  let amenScore = 1 // start with perfect score for non-mandatory
  const amenNote = missingMandatory.length > 0 ? `חסרות ${missingMandatory.length} דרישות חובה` : 'כל הדרישות מולאו'

  // move-in score
  let moveInScore = 0
  let moveInNote = ''
  
  if(lead?.move_in_from && property?.available_from){
    const l = new Date(lead.move_in_from).getTime()
    const p = new Date(property.available_from).getTime()
    const diffDays = Math.abs(p - l) / (1000*60*60*24)
    moveInScore = diffDays <= 7 ? 1 : diffDays <= 30 ? 0.8 : diffDays <= 60 ? 0.5 : 0.2
    moveInNote = diffDays <= 7 ? 'כניסה מיידית' : 
                 diffDays <= 30 ? 'כניסה בחודש' : 
                 diffDays <= 60 ? 'כניסה בחודשיים' : 'כניסה רחוקה'
  } else {
    moveInScore = 0.5 // neutral if no dates
    moveInNote = 'תאריכי כניסה לא מוגדרים'
  }
  reasons.push({ factor:'moveIn', impact: +(w.moveIn*moveInScore), note: moveInNote })

  // Calculate weighted score
  const weightedScore = (
    w.price * priceScore +
    w.location * locScore +
    w.rooms * roomsScore +
    w.amenities * amenScore +
    w.moveIn * moveInScore
  )

  // Calculate total possible weight
  const totalWeight = w.price + w.location + w.rooms + w.amenities + w.moveIn

  // Convert to percentage (0-100)
  const percentage = Math.round((weightedScore / totalWeight) * 100)
  
  // If disqualified, score is 0 regardless of percentage
  const finalScore = isDisqualified ? 0 : percentage

  const breakdown = {
    price: { score: Math.round(priceScore * 100), weight: w.price, note: priceNote },
    location: { score: Math.round(locScore * 100), weight: w.location, note: locNote },
    rooms: { score: Math.round(roomsScore * 100), weight: w.rooms, note: roomsNote },
    amenities: { score: Math.round(amenScore * 100), weight: w.amenities, note: amenNote },
    moveIn: { score: Math.round(moveInScore * 100), weight: w.moveIn, note: moveInNote }
  }

  return { 
    score: finalScore, 
    percentage,
    reasons,
    isDisqualified,
    disqualifyingReasons,
    breakdown
  }
}
