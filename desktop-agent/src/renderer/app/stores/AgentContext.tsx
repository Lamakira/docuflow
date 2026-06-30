import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { AgentState, AppPage, RecentTask, TimerState } from '../types';

// ─── State ───────────────────────────────────────────────────────────────────

interface State {
  loading: boolean;
  agentState: AgentState | null;
  page: AppPage;
  settingsDeepSection: string | null;
  loginProgress: string | null;
  recentTasks: RecentTask[];
  wasRevoked: boolean;
}

const defaultTimerState: TimerState = {
  status: 'stopped',
  elapsed: 0,
  elapsedToday: 0,
  workedToday: 0,
  thisSession: 0,
  dayKey: new Date().toDateString(),
  entryId: null,
  taskId: null,
  projectName: null,
  taskName: null,
  description: null,
};

const initialState: State = {
  loading: true,
  agentState: null,
  page: 'timer',
  settingsDeepSection: null,
  loginProgress: null,
  recentTasks: [],
  wasRevoked: false,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'INIT'; payload: AgentState }
  | { type: 'STATE_UPDATE'; payload: any }
  | { type: 'LOGOUT'; newState: AgentState }
  | { type: 'TICK' }
  | { type: 'SET_PAGE'; page: AppPage }
  | { type: 'NAVIGATE_SETTINGS'; section: string }
  | { type: 'CLEAR_SETTINGS_DEEP' }
  | { type: 'SET_LOGIN_PROGRESS'; message: string | null }
  | { type: 'ADD_RECENT'; task: RecentTask };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        loading: false,
        agentState: action.payload,
      };

    case 'STATE_UPDATE': {
      const prev = state.agentState;
      const wasPaired = prev?.isPaired ?? false;
      const nowPaired = !!action.payload.isPaired;
      const wasRevoked = wasPaired && !nowPaired;

      const newAgentState: AgentState = {
        isPaired: nowPaired,
        deviceName: action.payload.deviceName ?? null,
        userEmail: action.payload.userEmail ?? null,
        apiHost: action.payload.apiHost ?? null,
        apiBase: action.payload.apiBase ?? null,
        apiBaseSource: action.payload.apiBaseSource ?? null,
        timer: action.payload.timer ?? defaultTimerState,
      };

      return {
        ...state,
        agentState: newAgentState,
        wasRevoked: wasRevoked || state.wasRevoked,
        loading: false,
      };
    }

    case 'LOGOUT':
      return {
        ...state,
        agentState: action.newState,
        wasRevoked: false,
        loading: false,
      };

    case 'TICK': {
      if (!state.agentState) return state;
      if (state.agentState.timer.status !== 'running') return state;
      return {
        ...state,
        agentState: {
          ...state.agentState,
          timer: {
            ...state.agentState.timer,
            elapsed: state.agentState.timer.elapsed + 1,
            elapsedToday: state.agentState.timer.elapsedToday + 1,
            thisSession: state.agentState.timer.thisSession + 1,
          },
        },
      };
    }

    case 'SET_PAGE':
      return { ...state, page: action.page, settingsDeepSection: null };

    case 'NAVIGATE_SETTINGS':
      return { ...state, page: 'settings', settingsDeepSection: action.section };

    case 'CLEAR_SETTINGS_DEEP':
      return { ...state, settingsDeepSection: null };

    case 'SET_LOGIN_PROGRESS':
      return { ...state, loginProgress: action.message };

    case 'ADD_RECENT': {
      const filtered = state.recentTasks.filter(
        (r) =>
          !(r.crmProjectId === action.task.crmProjectId && r.taskId === action.task.taskId)
      );
      return { ...state, recentTasks: [action.task, ...filtered].slice(0, 5) };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AgentContextValue {
  state: State;
  dispatch: React.Dispatch<Action>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  startTimer: (args: {
    crmProjectId: string;
    taskId?: string;
    taskName?: string;
    projectName: string;
    description?: string;
    taskDurationToday?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  pauseTimer: () => Promise<{ ok: boolean; error?: string }>;
  resumeTimer: () => Promise<{ ok: boolean; error?: string }>;
  stopTimer: () => Promise<{ ok: boolean; error?: string }>;
  navigateToSettings: (section: string) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const bridge = window.agentBridge;
  const registeredRef = useRef(false);

  // Init + onStateUpdate subscription
  useEffect(() => {
    bridge.getState().then((s) => dispatch({ type: 'INIT', payload: s }));

    if (!registeredRef.current) {
      registeredRef.current = true;
      bridge.onStateUpdate((s) => dispatch({ type: 'STATE_UPDATE', payload: s }));
    }
  }, []);

  // Track day key from main (calendar or test rollover) for boundary detection.
  const timerDayKeyRef = useRef<string>(new Date().toDateString());
  const lastTickDayRef = useRef<string>(new Date().toDateString());

  useEffect(() => {
    const key = state.agentState?.timer.dayKey;
    if (key) {
      timerDayKeyRef.current = key;
      lastTickDayRef.current = key;
    }
  }, [state.agentState?.timer.dayKey, state.agentState?.timer.elapsedToday]);

  // Local tick when timer is running.
  useEffect(() => {
    if (state.agentState?.timer.status !== 'running') return;
    const id = setInterval(() => {
      const mainDayKey = timerDayKeyRef.current;
      const calendarDay = new Date().toDateString();
      const isTestDay = mainDayKey.startsWith('test-day-');
      const boundaryKey = isTestDay ? mainDayKey : calendarDay;

      if (boundaryKey !== lastTickDayRef.current) {
        lastTickDayRef.current = boundaryKey;
        bridge.timerState().then((fresh) => {
          dispatch({ type: 'STATE_UPDATE', payload: { timer: fresh } });
        }).catch(() => {});
        return;
      }
      dispatch({ type: 'TICK' });
    }, 1000);
    return () => clearInterval(id);
  }, [state.agentState?.timer.status, state.agentState?.timer.entryId]);

  const login = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'SET_LOGIN_PROGRESS', message: 'Connecting…' });
    const stopProgress = bridge.onLoginProgress((d) =>
      dispatch({ type: 'SET_LOGIN_PROGRESS', message: d.message })
    );
    const result = await bridge.login({ email, password });
    stopProgress();
    dispatch({ type: 'SET_LOGIN_PROGRESS', message: null });
    if (result.ok) {
      const s = await bridge.getState();
      dispatch({ type: 'STATE_UPDATE', payload: s });
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    await bridge.unpair();
    const s = await bridge.getState();
    dispatch({ type: 'LOGOUT', newState: s });
  }, []);

  const startTimer = useCallback(async (args: {
    crmProjectId: string;
    taskId?: string;
    taskName?: string;
    projectName: string;
    description?: string;
    taskDurationToday?: number;
  }) => {
    const result = await bridge.timerStart(args);
    if (result.ok) {
      const s = await bridge.getState();
      dispatch({ type: 'STATE_UPDATE', payload: s });
      dispatch({
        type: 'ADD_RECENT',
        task: {
          crmProjectId: args.crmProjectId,
          taskId: args.taskId ?? null,
          taskName: args.taskName ?? null,
          projectName: args.projectName,
          description: args.description ?? null,
        },
      });
    }
    return result;
  }, []);

  const pauseTimer = useCallback(async () => {
    const result = await bridge.timerPause();
    if (result.ok) {
      const s = await bridge.getState();
      dispatch({ type: 'STATE_UPDATE', payload: s });
    }
    return result;
  }, []);

  const resumeTimer = useCallback(async () => {
    const result = await bridge.timerResume();
    if (result.ok) {
      const s = await bridge.getState();
      dispatch({ type: 'STATE_UPDATE', payload: s });
    }
    return result;
  }, []);

  const stopTimer = useCallback(async () => {
    const result = await bridge.timerStop();
    if (result.ok) {
      const s = await bridge.getState();
      dispatch({ type: 'STATE_UPDATE', payload: s });
    }
    return result;
  }, []);

  const navigateToSettings = useCallback((section: string) => {
    dispatch({ type: 'NAVIGATE_SETTINGS', section });
  }, []);

  return (
    <AgentContext.Provider
      value={{ state, dispatch, login, logout, startTimer, pauseTimer, resumeTimer, stopTimer, navigateToSettings }}
    >
      {children}
    </AgentContext.Provider>
  );
}
