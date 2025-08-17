const windowDays = 3
export function antiDuplicateKey(kind: 'lead'|'property'|'pair', parts: (string|number|undefined|null)[]) {
  return [kind, ...parts.map(p => String(p ?? ''))].join(':')
}
export function isWithinWindow(ts: number, days = windowDays){
  const now = Date.now()
  return now - ts < days*24*60*60*1000
}
