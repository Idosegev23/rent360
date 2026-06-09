/**
 * Safety net for the conversation bots: the model (gpt-5.4) keeps emitting bullet/numbered
 * lists even though the system prompt forbids them — lists are the #1 "this is a robot" tell.
 * This collapses any run of list items into a flowing Hebrew sentence before the reply is sent.
 *
 * Heuristic, not a grammar engine — but the bots aren't supposed to list at all, so this only
 * fires on prompt violations and makes them read like prose instead of a form.
 */

const ITEM_RE = /^\s*([-–—•*·]|\d+[.)])\s+/

function ensureDot(s: string): string {
  return /[.!?:]$/.test(s) ? s : s + '.'
}

function joinItems(items: string[]): string {
  const clean = items.map(s => s.replace(/[.;,]+$/, '').trim()).filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return ensureDot(clean[0]!)
  const last = clean[clean.length - 1]!
  const head = clean.slice(0, -1).join(', ')
  // "או X" as the last item → alternatives ("A, B, או C"); otherwise glue a vav ("A, B וC").
  // (JS \b doesn't fire on Hebrew letters, so match whitespace/end explicitly.)
  if (/^או(\s|$)/.test(last)) return ensureDot(`${head}, ${last}`)
  const lastNoVav = last.replace(/^ו(?=\S)/, '')
  return ensureDot(`${head} ו${lastNoVav}`)
}

export function humanizeReply(raw: string): string {
  if (!raw || !raw.includes('\n')) {
    // Single line could still be "- only one item"; strip a stray leading marker.
    return raw ? raw.replace(ITEM_RE, '') : raw
  }
  const lines = raw.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (ITEM_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length && ITEM_RE.test(lines[i]!)) {
        const s = lines[i]!.replace(ITEM_RE, '').trim()
        if (s) items.push(s)
        i++
      }
      const joined = joinItems(items)
      const lead = out.length ? out[out.length - 1]! : ''
      if (lead && /[:：]\s*$/.test(lead)) {
        out[out.length - 1] = lead.replace(/\s*[:：]\s*$/, '') + ' ' + joined
      } else if (joined) {
        out.push(joined)
      }
    } else {
      out.push(line)
      i++
    }
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
