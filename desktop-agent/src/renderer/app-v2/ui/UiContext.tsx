/**
 * View state for the rail layout.
 *
 * Everything here is presentation-only: which project the panel is drilled
 * into, what is typed in the search box, which page of a list is showing, and
 * the single toast slot. Timer, pairing and server data stay in AgentContext —
 * this layer never owns them.
 *
 * The one piece that looks like domain state is `completedKey`. The API has no
 * "mark complete" call: ✓ stops the entry like Stop does, and the difference is
 * purely what the UI shows afterwards. Recording which entry was completed is
 * how the Timer knows to fall back to its empty state instead of keeping the
 * finished task on screen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const TOAST_MS = 2200;

interface UiValue {
  search: string;
  setSearch: (v: string) => void;
  openProjectId: string | null;
  setOpenProjectId: (v: string | null) => void;
  settingsSection: string;
  setSettingsSection: (v: string) => void;

  /** entryId (or task id) of the entry closed with ✓ — see the note above. */
  completedKey: string | null;
  markCompleted: (key: string) => void;
  clearCompleted: () => void;

  toast: string | null;
  showToast: (text: string) => void;
}

const UiContext = createContext<UiValue | null>(null);

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [search, setSearch] = useState('');
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState('activity-bar');
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Single slot: a new toast replaces the current one and restarts the clock. */
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const value = useMemo<UiValue>(() => ({
    search, setSearch,
    openProjectId, setOpenProjectId,
    settingsSection, setSettingsSection,
    completedKey,
    markCompleted: setCompletedKey,
    clearCompleted: () => setCompletedKey(null),
    toast, showToast,
  }), [search, openProjectId, settingsSection, completedKey, toast, showToast]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}
