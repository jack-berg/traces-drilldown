import { narrowDrilldownSearchState } from './span-filter-state';

const state = {
  version: 1,
  spanFilters: { scope: 'root', primarySignal: 'kind=server', semconv: ['type:http.server', 'namespace:db'] },
  attributeFilters: [{ key: 'resource.service.name', operator: '=', value: 'api' }],
};

it('round-trips independent controls and original attributes without sharing mutable arrays', () => {
  expect(narrowDrilldownSearchState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const restored = narrowDrilldownSearchState(state)!;
  restored.spanFilters.semconv.push('unmatched');
  restored.attributeFilters[0].value = 'other';
  expect(state.spanFilters.semconv).toHaveLength(2);
  expect(state.attributeFilters[0].value).toBe('api');
});

it('rejects unknown versions, invalid scopes, raw signal expressions, and malformed attributes', () => {
  for (const invalid of [
    null,
    { ...state, version: 2 },
    { ...state, spanFilters: { ...state.spanFilters, scope: 'unknown' } },
    { ...state, spanFilters: { ...state.spanFilters, primarySignal: 'true || injected' } },
    { ...state, spanFilters: { ...state.spanFilters, semconv: [null] } },
    { ...state, attributeFilters: [null] },
  ]) {
    expect(narrowDrilldownSearchState(invalid)).toBeUndefined();
  }
});
