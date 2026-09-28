import { getBackendSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { SemconvAttribute } from './types';

const ATTRIBUTE_URL = '/api/plugins/grafana-otel-schema-registry-app/resources/attributes/';

const cache = new Map<string, Promise<SemconvAttribute | null>>();

export function fetchSemconvAttribute(name: string): Promise<SemconvAttribute | null> {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }

  const promise = lastValueFrom(
    getBackendSrv().fetch<SemconvAttribute>({
      url: ATTRIBUTE_URL + encodeURIComponent(name),
      method: 'GET',
      showErrorAlert: false,
    })
  )
    .then((res) => res?.data ?? null)
    .catch((err: unknown) => {
      if (isFetchError(err) && err.status === 404) {
        return null;
      }
      // Don't break the UI when the schema-registry plugin isn't installed.
      console.warn('[semconv] failed to fetch attribute', name, err);
      return null;
    });

  cache.set(name, promise);
  return promise;
}
