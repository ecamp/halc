import { parseTemplate } from 'url-template'
import type { TemplateParams } from './types.js'

/** Expands an RFC 6570 URI template. */
export function expandTemplate(template: string, params: TemplateParams = {}): string {
  return parseTemplate(template).expand(
    params as Parameters<ReturnType<typeof parseTemplate>['expand']>[0]
  )
}
