import { scoreMatch } from '../lib/matching/renter-property'
// Osher Ben David: wanted 2.5 rooms in "קרית חיים מזרחית" (one yod). Property is canonicalized
// to two-yod "קריית חיים מזרחית". Before the fix the neighborhood scored 0; now it must be 1.0.
const renter: any = {
  preferred_cities: ['קרית חיים'], preferred_neighborhoods: ['קרית חיים מזרחית'],
  preferred_rooms: 2.5, budget_min: 2500, budget_max: 4000,
  has_pets: false, smokers: false, preferences: {}, move_in_date: null,
}
const property: any = {
  city: 'קריית חיים', neighborhood: 'קריית חיים מזרחית', rooms: 2.5, price: 3200,
  amenities: {}, pets_allowed: null, smokers_allowed: null, available_from: null, evacuation_date: null,
}
const r = scoreMatch(renter, property)
let fail = 0
const ck = (l: string, ok: boolean, d?: string) => { console.log(`${ok ? 'OK  ' : 'FAIL'} | ${l}${d ? '  (' + d + ')' : ''}`); if (!ok) fail++ }
ck('NOT disqualified', r.isDisqualified === false, `dq=${JSON.stringify(r.disqualifyingReasons)}`)
ck('neighborhood raw === 1.0 (yod-variant now matches)', r.breakdown.neighborhood?.raw === 1, `raw=${r.breakdown.neighborhood?.raw} note=${r.breakdown.neighborhood?.note}`)
ck('city raw === 1.0', r.breakdown.city?.raw === 1, `raw=${r.breakdown.city?.raw} note=${r.breakdown.city?.note}`)
ck('rooms raw === 1.0 (2.5↔2.5)', r.breakdown.rooms?.raw === 1, `raw=${r.breakdown.rooms?.raw}`)
ck('overall score high (>=80)', r.score >= 80, `score=${r.score}`)
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS — the קרית חיים מזרחית match is now found'); process.exit(fail ? 1 : 0)
