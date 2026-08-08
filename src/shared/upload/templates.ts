import templatesJson from './templates.json'

export interface DescriptionTemplate {
  id: string
  name: string
  content: string
  builtin: boolean
}

export const DEFAULT_DESCRIPTION_TEMPLATE_ID = 'peachfuzz'

const templates: DescriptionTemplate[] = templatesJson.templates.map((t) => ({
  id: t.id,
  name: t.name,
  content: t.content,
  builtin: t.builtin
}))

const byId = new Map(templates.map((t) => [t.id, t]))

export function listDescriptionTemplates(): DescriptionTemplate[] {
  return templates.map((t) => ({ ...t }))
}

export function listDescriptionTemplateIds(): string[] {
  return templates.map((t) => t.id)
}

export function getDescriptionTemplate(id: string | undefined): DescriptionTemplate {
  const found = id ? byId.get(id) : undefined
  if (found) return { ...found }
  const fallback = byId.get(DEFAULT_DESCRIPTION_TEMPLATE_ID)
  if (!fallback) {
    throw new Error('default description template missing')
  }
  return { ...fallback }
}

export function descriptionTemplateName(id: string): string {
  return byId.get(id)?.name ?? id
}
