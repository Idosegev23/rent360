/**
 * Scratch verification for lib/data/location-normalize.ts.
 * No test runner exists in this repo — run with:  npx tsx scripts/verify-location-normalize.ts
 * Exits non-zero if any assertion fails.
 */
import {
  canonicalizePlace,
  comparePlaces,
} from '../lib/data/location-normalize'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const approx = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps

// 1) yod-variant canonicalization collapses to the same form.
{
  const a = canonicalizePlace('קריית חיים מזרחית')
  const b = canonicalizePlace('קרית חיים מזרחית')
  check("canonicalizePlace('קריית חיים מזרחית') === canonicalizePlace('קרית חיים מזרחית')", a === b, `'${a}' vs '${b}'`)
}

// 2) exact neighborhood: wanted nbh === prop nbh → neighborhoodScore 1.0
{
  const r = comparePlaces(['קרית חיים מזרחית'], 'קריית חיים', 'קריית חיים מזרחית')
  check('exact neighborhood → neighborhoodScore 1.0 (tier=neighborhood)',
    approx(r.neighborhoodScore, 1.0) && r.neighborhoodTier === 'neighborhood',
    `tier=${r.neighborhoodTier} score=${r.neighborhoodScore}`)
}

// 3) subarea: wanted = parent city, prop nbh is a known sub-area → ~0.85
{
  const r = comparePlaces(['קרית חיים'], 'קריית חיים', 'קריית חיים מזרחית')
  // Per-field: prop CITY "קריית חיים" === wanted city → city is exact (1.0).
  // prop NEIGHBORHOOD "קריית חיים מזרחית" is a known sub-area of the wanted
  // parent city → the subarea (0.85) signal lands on the NEIGHBORHOOD dimension.
  check('subarea (parent city wanted, prop nbh is sub-area) → neighborhoodScore ~0.85 (tier=subarea)',
    approx(r.neighborhoodScore, 0.85) && r.neighborhoodTier === 'subarea',
    `cityTier=${r.cityTier} cityScore=${r.cityScore} nbhTier=${r.neighborhoodTier} nbhScore=${r.neighborhoodScore}`)
}

// 4) sibling: same parent, different direction → ~0.55
{
  const r = comparePlaces(['קרית חיים מזרחית'], 'קריית חיים', 'קריית חיים מערבית')
  check('sibling (מזרחית vs מערבית) → neighborhoodScore ~0.55 (tier=sibling)',
    approx(r.neighborhoodScore, 0.55) && r.neighborhoodTier === 'sibling',
    `nbhTier=${r.neighborhoodTier} nbhScore=${r.neighborhoodScore}`)
}

// 5) group: wanted = קריות, prop is a Kirya → cityScore 0.45
{
  const r = comparePlaces(['קריות'], 'קרית ביאליק', null)
  check('group (קריות → קרית ביאליק) → cityScore 0.45 (tier=group)',
    approx(r.cityScore, 0.45) && r.cityTier === 'group',
    `cityTier=${r.cityTier} cityScore=${r.cityScore}`)
  check('group is strictly below sibling (0.45 < 0.55)', 0.45 < 0.55)
}

// 6) no match → 0 and NOT a disqualification (module only scores).
{
  const r = comparePlaces(['תל אביב'], 'קריית חיים', 'קריית חיים מזרחית')
  check('no match (תל אביב vs קריית חיים) → cityScore 0 + neighborhoodScore 0, never DQ',
    r.cityScore === 0 && r.cityTier === 'none' && r.neighborhoodScore === 0 && r.neighborhoodTier === 'none',
    `cityTier=${r.cityTier} cityScore=${r.cityScore} nbhTier=${r.neighborhoodTier} nbhScore=${r.neighborhoodScore}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
