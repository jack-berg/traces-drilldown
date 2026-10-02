import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  compileSpanShapeSelection,
  fetchSpanShapes,
  SemconvSpanShape,
  spanTypeDrilldownPath,
} from '@grafana/otel-semconv-client';
import { config } from '@grafana/runtime';
import { parser } from '@grafana/lezer-traceql';
import { SceneFlexLayout, SceneVariableSet, sceneGraph } from '@grafana/scenes';
import { PrimarySignalVariable } from './PrimarySignalVariable';
import { generateMetricsQuery } from '../../components/Explore/queries/generateMetricsQuery';
import { buildHistogramQuery } from '../../components/Explore/queries/histogram';
import { VAR_FILTERS_EXPR } from '../../utils/shared';

jest.mock('utils/analytics', () => ({
  reportAppInteraction: jest.fn(),
  USER_EVENTS_PAGES: { analyse_traces: '' },
  USER_EVENTS_ACTIONS: { analyse_traces: { primary_signal_changed: '' } },
}));
jest.mock('@grafana/otel-semconv-client', () => ({
  ...jest.requireActual('@grafana/otel-semconv-client'),
  fetchSpanShapes: jest.fn(),
}));

const shapes: SemconvSpanShape[] = [
  {
    name: 'http.server',
    namespace: 'http',
    kind: 'server',
    requiredAttributes: ['http.request.method', 'url.path', 'url.scheme'],
  },
  { name: 'db.client', namespace: 'db', kind: 'client', requiredAttributes: ['db.system.name'] },
  { name: 'graphql.server', namespace: 'graphql', kind: 'server', requiredAttributes: [] },
  { name: 'custom.unknown', namespace: 'custom', kind: 'unknown', requiredAttributes: ['custom.key'] },
  { name: 'custom.template', namespace: 'custom', kind: 'internal', requiredAttributes: ['custom.<key>'] },
];
const fetch = jest.mocked(fetchSpanShapes);

beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockResolvedValue(shapes);
});

it('defaults to root-only without registry or Tempo discovery requests', () => {
  const model = new PrimarySignalVariable({});
  expect(model.state.scope).toBe('root');
  expect(model.getValue()).toBe('nestedSetParent<0');
  expect(fetch).not.toHaveBeenCalled();
});

it('separates scope from primary signal, switching to all only on a new active filter selection', () => {
  const model = new PrimarySignalVariable({});
  model.selectSignal('kind=server');
  expect(model.state.scope).toBe('all');
  expect(model.getValue()).toBe('kind=server');
  model.selectScope('root');
  expect(model.getValue()).toBe('(nestedSetParent<0) && (kind=server)');
  model.selectSignal('true');
  expect(model.getValue()).toBe('nestedSetParent<0');
  expect(fetch).not.toHaveBeenCalled();
});

it('loads registry metadata once, compiles active types, and intersects signal and scope', async () => {
  const model = new PrimarySignalVariable({});
  await model.loadCatalog();
  model.selectSignal('span.db.system.name!=""');
  model.selectSemconv(['type:db.client']);
  expect(model.state.scope).toBe('all');
  expect(model.getValue()).toContain('span.db.system.name!=""');
  expect(model.getValue()).toContain('span.db.system.name != nil');
  expect(model.getValue()).not.toContain('http.request.method');
  model.selectScope('root');
  expect(model.getValue()).toContain('nestedSetParent<0');
  model.selectSemconv([]);
  expect(model.state.scope).toBe('root');
  expect(model.getValue()).not.toContain(' != nil');
  await model.loadCatalog();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('restores new URLs without forcing a deliberately selected root scope to all', async () => {
  const model = new PrimarySignalVariable({});
  model.updateFromUrl({
    'var-primarySignal': 'kind=server',
    spanScope: 'root',
    spanTypes: ['namespace:http', 'type:db.client'],
  });
  expect(model.getValue()).toContain('false');
  await model.loadCatalog();
  expect(model.state.scope).toBe('root');
  expect(model.getUrlState()).toEqual({
    'var-primarySignal': 'kind=server',
    spanScope: 'root',
    spanTypes: ['namespace:http', 'type:db.client'],
  });
  expect(model.getValue()).toContain(' || ');
  model.updateFromUrl({ 'var-primarySignal': 'true', spanScope: 'all' });
  expect(model.state.semconv).toEqual([]);
  expect(model.getValue()).toBe('true');
});

it('keeps legacy primary-signal links meaningful', () => {
  const model = new PrimarySignalVariable({});
  model.updateFromUrl({ 'var-primarySignal': 'nestedSetParent<0' });
  expect(model.getValue()).toBe('nestedSetParent<0');
  model.updateFromUrl({ 'var-primarySignal': 'true' });
  expect(model.state.scope).toBe('all');
  expect(model.getValue()).toBe('true');
  model.updateFromUrl({ 'var-primarySignal': 'kind=consumer' });
  expect(model.state.scope).toBe('all');
  expect(model.getValue()).toBe('kind=consumer');
});

it('defaults embedded scope to all but honors explicitly restored legacy root scope', () => {
  const model = new PrimarySignalVariable({ isReadOnly: true });
  expect(model.getValue()).toBe('true');
  model.updateFromUrl({ 'var-primarySignal': 'nestedSetParent<0' });
  expect(model.getValue()).toBe('nestedSetParent<0');
  model.updateFromUrl({});
  expect(model.getValue()).toBe('true');
  expect(fetch).not.toHaveBeenCalled();
});

it('fails closed on unavailable selections and registry errors, retaining state for retry or clearing', async () => {
  fetch.mockRejectedValueOnce(new Error('Registry offline'));
  const model = new PrimarySignalVariable({});
  model.selectSemconv(['type:http.server']);
  expect(model.getValue()).toBe('false');
  await model.loadCatalog();
  expect(model.state.catalogError).toBe('Registry offline');
  expect(model.state.semconv).toEqual(['type:http.server']);
  expect(model.getValue()).toBe('false');
  await model.loadCatalog();
  expect(model.getValue()).toContain('http.request.method');
  model.selectSemconv(['type:graphql.server']);
  expect(model.getValue()).toBe('false');
  expect(model.state.selectionError).toContain('unavailable');
  model.selectSemconv([]);
  expect(model.getValue()).toBe('true');
});

it('preserves valid expression through scene-variable validation and interpolation', async () => {
  const model = new PrimarySignalVariable({});
  const root = new SceneFlexLayout({ children: [], $variables: new SceneVariableSet({ variables: [model] }) });
  await model.loadCatalog();
  model.selectSemconv(['type:http.server']);
  model.validateAndUpdate().subscribe();
  expect(sceneGraph.interpolate(root, '${primarySignal}')).toContain('span.http.request.method != nil');
  expect(model.state.semconv).toEqual(['type:http.server']);
});

it('propagates parenthesized unions and unmatched complements through existing common query expressions', async () => {
  const model = new PrimarySignalVariable({});
  const root = new SceneFlexLayout({ children: [], $variables: new SceneVariableSet({ variables: [model] }) });
  await model.loadCatalog();
  model.selectSemconv(['namespace:http', 'type:db.client']);
  model.selectScope('root');
  for (const template of [
    generateMetricsQuery({ metric: 'rate' }),
    generateMetricsQuery({ metric: 'errors' }),
    generateMetricsQuery({ metric: 'duration' }),
    generateMetricsQuery({ metric: 'rate', groupByKey: 'resource.service.name' }),
    buildHistogramQuery().query,
    `{${VAR_FILTERS_EXPR}}`,
  ]) {
    const query = sceneGraph.interpolate(root, template);
    expect(query).toContain(model.getValue());
    expect(query).toContain('nestedSetParent<0');
    expect(query).toContain(' || ');
  }
  model.selectSemconv(['unmatched']);
  expect(sceneGraph.interpolate(root, generateMetricsQuery({ metric: 'rate' }))).toContain('!(');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('generates valid TraceQL syntax for unions, complements, signal intersections, and quoted keys', async () => {
  const model = new PrimarySignalVariable({});
  await model.loadCatalog();
  const predicates: string[] = [];
  model.selectSignal('kind=server');
  for (const selection of [['type:http.server'], ['namespace:http', 'type:db.client'], ['unmatched']]) {
    model.selectSemconv(selection);
    predicates.push(String(model.getValue()));
  }
  predicates.push(
    compileSpanShapeSelection(
      [{ name: 'custom.client', namespace: 'custom', kind: 'client', requiredAttributes: ['a" || true || "b'] }],
      ['type:custom.client']
    )
  );
  for (const predicate of predicates) {
    const errors: number[] = [];
    parser.parse(`{${predicate}}`).iterate({
      enter(node) {
        if (node.type.isError) {
          errors.push(node.from);
        }
      },
    });
    expect({ predicate, errors }).toEqual({ predicate, errors: [] });
  }
});

it('offers only matchable span types, with no namespace, unmatched, insufficient entries, or counts', async () => {
  const model = new PrimarySignalVariable({});
  render(<model.Component model={model} />);
  expect(screen.getByText('Span scope')).toBeInTheDocument();
  expect(screen.getByLabelText('Primary signal')).toBeInTheDocument();
  const input = screen.getByLabelText('Semantic convention');
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
  await screen.findByText('http.server');
  expect(
    screen
      .getAllByRole('option')
      .map((option) => option.textContent)
      .sort()
  ).toEqual(['db.client', 'http.server']);
  expect(screen.queryByText('Namespaces')).not.toBeInTheDocument();
  expect(screen.queryByText('No matching supported shape')).not.toBeInTheDocument();
  expect(screen.queryByText('Insufficient matching information')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('http.server'));
  expect(model.state.semconv).toEqual(['type:http.server']);
  expect(screen.getByLabelText('All spans')).toBeChecked();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps restored insufficient selections visible and fails closed without offering them in the menu', async () => {
  const model = new PrimarySignalVariable({});
  await model.loadCatalog();
  model.restoreSelection({ scope: 'all', primarySignal: 'true', semconv: ['type:graphql.server'] });
  render(<model.Component model={model} />);
  expect(screen.getByText('graphql.server')).toBeInTheDocument();
  expect(screen.getByText(/The selected filter is retained/)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Semantic convention'), { key: 'ArrowDown', code: 'ArrowDown' });
  expect(
    screen
      .getAllByRole('option')
      .map((option) => option.textContent)
      .sort()
  ).toEqual(['db.client', 'http.server']);
  expect(model.state.semconv).toEqual(['type:graphql.server']);
  expect(model.getValue()).toBe('false');
  await act(async () => model.selectSemconv([]));
  expect(model.getValue()).toBe('true');
});

it('links to the complete registry span-types page in a new tab with the Grafana subpath', () => {
  const original = config.appSubUrl;
  try {
    config.appSubUrl = '/grafana';
    const model = new PrimarySignalVariable({});
    render(<model.Component model={model} />);
    const link = screen.getByRole('link', { name: 'Browse span types in registry' });
    expect(link).toHaveAttribute('href', '/grafana/a/grafana-otel-schema-registry-app/spans');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    config.appSubUrl = original;
  }
});

it('restores registry-generated deep links as the selected span type across all spans', async () => {
  const url = new URL(spanTypeDrilldownPath('http.server'), 'http://localhost');
  const model = new PrimarySignalVariable({});
  model.updateFromUrl(Object.fromEntries(url.searchParams));
  expect(model.getValue()).toBe('false');
  await model.loadCatalog();
  expect(model.getSelection()).toEqual({ scope: 'all', primarySignal: 'true', semconv: ['type:http.server'] });
  expect(model.getValue()).toContain('span.http.request.method != nil');
  expect(model.getValue()).not.toContain('nestedSetParent');
});
