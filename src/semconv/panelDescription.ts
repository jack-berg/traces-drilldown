import { SemconvAttribute } from './types';

/** VizPanel `description` renders as markdown behind the panel's ⓘ icon. */
export function buildSemconvPanelDescription(attr: SemconvAttribute): string {
  const lines: string[] = [];

  if (attr.brief) {
    lines.push(attr.brief);
  }

  const meta: string[] = [`**Stability:** ${attr.stability}`, `**Type:** ${attr.type}`];
  if (attr.examples?.length) {
    meta.push(`**Examples:** ${attr.examples.slice(0, 3).join(', ')}`);
  }
  lines.push('', meta.join(' · '));

  lines.push('', `_semconv: ${attr.name}_`);

  return lines.join('\n');
}
