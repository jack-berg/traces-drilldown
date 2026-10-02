import { AdHocVariableFilter } from '@grafana/data';
import { primarySignalOptions } from './primary-signals';

export interface SpanFilterSelection {
  scope: 'root' | 'all';
  primarySignal: string;
  semconv: string[];
}

export interface DrilldownSearchState {
  version: 1;
  spanFilters: SpanFilterSelection;
  attributeFilters: AdHocVariableFilter[];
}

export function narrowDrilldownSearchState(value: unknown): DrilldownSearchState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const state = value as Partial<DrilldownSearchState>;
  const selection = state.spanFilters;
  if (
    state.version !== 1 ||
    !selection ||
    !['root', 'all'].includes(selection.scope) ||
    !primarySignalOptions.slice(1).some((option) => option.value === selection.primarySignal) ||
    !Array.isArray(selection.semconv) ||
    !selection.semconv.every((item) => typeof item === 'string') ||
    !Array.isArray(state.attributeFilters) ||
    !state.attributeFilters.every(
      (filter) =>
        filter &&
        typeof filter.key === 'string' &&
        typeof filter.operator === 'string' &&
        typeof filter.value === 'string'
    )
  ) {
    return undefined;
  }
  return {
    version: 1,
    spanFilters: { ...selection, semconv: [...selection.semconv] },
    attributeFilters: state.attributeFilters.map((filter) => ({ ...filter })),
  };
}
