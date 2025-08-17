export function renderTemplate(template: string, params: Record<string,string|number>) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => String(params[key.trim()] ?? ''))
}
