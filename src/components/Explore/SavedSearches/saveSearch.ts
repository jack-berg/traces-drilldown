import { ReactNode, useCallback, useEffect, useState } from 'react';

import semver from 'semver/preload';

import { config } from '@grafana/runtime';
import { SceneObject } from '@grafana/scenes';
import { DataQuery } from '@grafana/schema';

import { useFlagQueryLibrary } from '../../../featureFlags/featureFlags';
import pluginJson from '../../../plugin.json';
import { TraceqlFilter, traceqlFiltersToAdHoc } from '../../../utils/links';
import { parseTraceQLQuery } from '../../../utils/lezer-traceql-parser';
import {
  getDatasourceVariable,
  getFiltersVariable,
  getPrimarySignalVariable,
  getTraceExplorationScene,
} from '../../../utils/utils';
import { DrilldownSearchState, narrowDrilldownSearchState } from '../../../pages/Explore/span-filter-state';

const MIN_VERSION = '12.4.0-21256324731';
export const SAVED_SEARCHES_KEY = `${pluginJson.id}.savedSearches`;

const SAVED_SEARCHES_CHANGED_EVENT = `${pluginJson.id}.savedSearchesChanged`;

function notifySavedSearchesChanged() {
  window.dispatchEvent(new CustomEvent(SAVED_SEARCHES_CHANGED_EVENT));
}

export function useQueryLibrarySupported(): boolean {
  const queryLibrary = useFlagQueryLibrary();
  return !semver.ltr(config.buildInfo.version, MIN_VERSION) && queryLibrary;
}

export function useCheckForExistingSearch(dsUid: string, query: string) {
  const { searches } = useSavedSearches(dsUid);
  return searches.find((search) => search.query === query);
}

export function useHasSavedSearches(dsUid: string) {
  const { searches } = useSavedSearches(dsUid);
  return searches.length > 0;
}

function parseSavedQueryToFilters(query: string): TraceqlFilter[] {
  const expression = query.trim();
  const wrapped = expression.startsWith('{') ? expression : `{${expression}}`;
  const parsed = parseTraceQLQuery(wrapped);
  if (
    parsed?.errors.some((error) => error.type !== 'unsupported_pipeline') ||
    (!parsed && !/^\{\s*(?:true)?\s*\}$/.test(wrapped))
  ) {
    throw new Error(
      'This query cannot be restored as Drilldown filters without its saved filter state. Open it in Explore instead.'
    );
  }
  return parsed?.filters ?? [];
}

export function applySavedSearchToScene(
  sceneRef: SceneObject,
  query: string,
  dsUid: string,
  savedState?: unknown
): void {
  const restored = narrowDrilldownSearchState(savedState);
  if (savedState !== undefined && !restored) {
    throw new Error('This saved search has invalid Drilldown filter state.');
  }
  const filters = restored ? [] : parseSavedQueryToFilters(query);
  const adHocFilters = restored?.attributeFilters ?? traceqlFiltersToAdHoc(filters);

  const traceExploration = getTraceExplorationScene(sceneRef);
  const filtersVariable = getFiltersVariable(traceExploration);
  filtersVariable.setState({ filters: adHocFilters });
  getPrimarySignalVariable(traceExploration).restoreSelection(
    restored?.spanFilters ?? { scope: 'all', primarySignal: 'true', semconv: [] }
  );

  const dsVariable = getDatasourceVariable(sceneRef);
  if (dsUid && dsVariable.getValue()?.toString() !== dsUid) {
    dsVariable.changeValueTo(dsUid);
  }
}

export function useSavedSearches(dsUid: string) {
  const [searches, setSearches] = useState<SavedSearch[]>(() => getLocallySavedSearches(dsUid));

  useEffect(() => {
    const refresh = () => setSearches(getLocallySavedSearches(dsUid));
    window.addEventListener(SAVED_SEARCHES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SAVED_SEARCHES_CHANGED_EVENT, refresh);
  }, [dsUid]);

  const deleteSearch = useCallback(
    async (uid: string) => {
      removeFromLocalStorage(uid);
      setSearches(getLocallySavedSearches(dsUid));
      notifySavedSearchesChanged();
    },
    [dsUid]
  );

  const saveSearch = useCallback(
    async (search: Omit<SavedSearch, 'timestamp' | 'uid'>) => {
      saveInLocalStorage(search);
      setSearches(getLocallySavedSearches(dsUid));
      notifySavedSearchesChanged();
    },
    [dsUid]
  );

  return {
    isLoading: false,
    saveSearch,
    searches,
    deleteSearch,
  };
}

const isString = (s: unknown) => (typeof s === 'string' && s) || '';

function narrowSavedSearch(search: unknown): SavedSearch | null {
  if (typeof search !== 'object' || search === null) {
    return null;
  }
  const savedState = 'drilldownState' in search ? search.drilldownState : undefined;
  const drilldownState = narrowDrilldownSearchState(savedState);
  if (savedState !== undefined && !drilldownState) {
    return null;
  }
  return 'title' in search &&
    'description' in search &&
    'query' in search &&
    'timestamp' in search &&
    'dsUid' in search &&
    'uid' in search
    ? {
        description: isString(search.description),
        dsUid: isString(search.dsUid),
        query: isString(search.query),
        timestamp: Number(search.timestamp),
        title: isString(search.title),
        uid: isString(search.uid),
        ...(drilldownState ? { drilldownState } : {}),
      }
    : null;
}

export function narrowSavedSearches(searches: unknown): SavedSearch[] {
  if (!Array.isArray(searches)) {
    return [];
  }
  return searches.map((search) => narrowSavedSearch(search)).filter((search) => search !== null);
}

function getLocallySavedSearches(dsUid?: string) {
  let stored: SavedSearch[] = [];
  try {
    stored = narrowSavedSearches(JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) ?? '[]'));
  } catch (e) {
    console.error(e);
  }
  stored.sort((a, b) => b.timestamp - a.timestamp);
  return stored.filter((search) => (dsUid ? search.dsUid === dsUid : true));
}

export interface SavedSearch {
  description: string;
  dsUid: string;
  query: string;
  timestamp: number;
  title: string;
  uid: string;
  drilldownState?: DrilldownSearchState;
}

function saveInLocalStorage({
  query,
  title,
  description,
  dsUid,
  drilldownState,
}: Omit<SavedSearch, 'timestamp' | 'uid'>) {
  const stored = getLocallySavedSearches();

  stored.push({
    dsUid,
    description,
    query,
    timestamp: new Date().getTime(),
    title,
    uid: crypto.randomUUID(),
    ...(drilldownState ? { drilldownState } : {}),
  });

  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(stored));
}

function removeFromLocalStorage(uid: string) {
  const stored = getLocallySavedSearches();
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(stored.filter((search) => search.uid !== uid)));
}

export interface OpenQueryLibraryComponentProps {
  className?: string;
  context?: string;
  datasourceFilters?: string[];
  fallbackComponent?: ReactNode;
  icon?: string;
  onSelectQuery?(query: DataQuery): void;
  query?: DataQuery;
  tooltip?: string;
}
