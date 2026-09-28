import { useEffect, useState } from 'react';

import { fetchSemconvAttribute } from './client';
import { SemconvAttribute } from './types';

export function useSemconvAttribute(name: string | undefined): SemconvAttribute | null | undefined {
  const [result, setResult] = useState<SemconvAttribute | null | undefined>(undefined);

  useEffect(() => {
    if (!name) {
      setResult(undefined);
      return;
    }

    let cancelled = false;
    setResult(undefined);

    fetchSemconvAttribute(name).then((value) => {
      if (!cancelled) {
        setResult(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [name]);

  return result;
}
