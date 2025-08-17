export async function sendWhatsApp(toE164: string, text: string) {
  const instance = process.env.GREENAPI_INSTANCE_ID!
  const token = process.env.GREENAPI_API_TOKEN_INSTANCE!
  const url = `https://api.green-api.com/waInstance${instance}/sendMessage/${token}`
  const body = { chatId: toE164.replace('+', '') + '@c.us', message: text }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('GreenAPI send failed')
  return res.json()
}
