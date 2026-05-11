import {
  addBreadcrumb,
  captureException,
  captureMessage,
  getClient,
  setContext,
  setTag,
  setUser,
} from '@arguslog/sdk-browser';
import { useMemo } from 'react';

export function useArguslog() {
  return useMemo(
    () => ({
      captureException,
      captureMessage,
      addBreadcrumb,
      setUser,
      setTag,
      setContext,
      isInitialized: () => Boolean(getClient()),
    }),
    [],
  );
}
