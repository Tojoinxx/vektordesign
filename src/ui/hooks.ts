import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { AppState } from '../store/state';
import type { AppController, UiState } from './controller';

export const AppCtx = createContext<AppController | null>(null);

export function useApp(): AppController {
  const a = useContext(AppCtx);
  if (!a) throw new Error('AppController fehlt');
  return a;
}

export function useAppState<T>(sel: (s: AppState) => T): T {
  return useStore(useApp().store, sel);
}

export function useUi<T>(sel: (s: UiState) => T): T {
  return useStore(useApp().ui, sel);
}
