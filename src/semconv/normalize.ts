import { RESOURCE_ATTR, SPAN_ATTR } from '../utils/shared';

/**
 * Traces-drilldown surfaces attribute keys with a `span.` or `resource.` scope
 * prefix (matches Tempo's tag namespaces). Semconv canonical names have no
 * such prefix. Strip before looking up.
 *
 * Returns undefined if input is falsy so callers can skip the lookup.
 */
export function toSemconvKey(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (name.startsWith(RESOURCE_ATTR)) {
    return name.slice(RESOURCE_ATTR.length);
  }
  if (name.startsWith(SPAN_ATTR)) {
    return name.slice(SPAN_ATTR.length);
  }
  return name;
}
