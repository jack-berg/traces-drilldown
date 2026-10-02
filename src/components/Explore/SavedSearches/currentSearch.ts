import { useMemo } from 'react';
import { SceneObject } from '@grafana/scenes';
import { getFiltersVariable, getPrimarySignalVariable, getTraceExplorationScene } from '../../../utils/utils';
import { renderTraceQLLabelFilters } from '../../../utils/filters-renderer';
import { DrilldownSearchState } from '../../../pages/Explore/span-filter-state';

export function useCurrentSearch(sceneRef: SceneObject) {
  const exploration = getTraceExplorationScene(sceneRef);
  const { filters } = getFiltersVariable(exploration).useState();
  const { scope, primarySignal, semconv, value, shapes, catalogLoading, catalogError, selectionError } =
    getPrimarySignalVariable(exploration).useState();
  const drilldownState = useMemo<DrilldownSearchState>(
    () => ({
      version: 1,
      spanFilters: { scope, primarySignal, semconv: [...semconv] },
      attributeFilters: filters.map((filter) => ({ ...filter })),
    }),
    [scope, primarySignal, semconv, filters]
  );
  const query = useMemo(() => {
    const attributes = renderTraceQLLabelFilters(filters);
    return value === 'true' ? `{${attributes}}` : `{(${value}) && (${attributes})}`;
  }, [filters, value]);
  return {
    query,
    drilldownState,
    hasFilters: filters.length > 0 || primarySignal !== 'true' || semconv.length > 0,
    ready: semconv.length === 0 || (Boolean(shapes) && !catalogLoading && !catalogError && !selectionError),
  };
}
