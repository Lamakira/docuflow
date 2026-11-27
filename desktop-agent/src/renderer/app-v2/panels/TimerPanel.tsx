/**
 * Timer panel — pick what to track.
 *
 * Two levels, one column: all projects, then one project's tasks. Clicking a
 * task starts it immediately; there is no confirm step, and the shipping build
 * behaves the same way.
 *
 * Task counts and task-name search need each project's task list, which is a
 * server call per project. They are fetched for the projects actually on screen
 * and cached, so the panel costs one call per project you look at rather than
 * one per project that exists. A project whose tasks have not been fetched yet
 * still matches on its own name — search never silently narrows.
 *
 * Simultaneous Timers (#400, ADR-0031): with the Tracking Policy option on and
 * a Timer active, picking a task asks whether to add a Timer or switch to it
 * (lib/simultaneousTimers.ts decides). Two or more active Timers each get
 * their own pause and stop here, plus Stop all.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import type { ActiveTimerState, Project, Task } from '../../app/types';
import { Panel, PanelHead, PanelBody, PanelRow, Pager } from '../components/Panel';
import { useUi } from '../ui/UiContext';
import { createFromTimerPanel, mergeTaskRead } from '../../../lib/createFromTimerPanel';
import { startChoice, type StartMode } from '../../../lib/simultaneousTimers';
import { useActiveTask } from '../ui/useActiveTask';
import { useFitCount } from '../ui/useFitCount';
import { formatDuration, formatElapsed, formatHM } from '../format';
import { ArrowLeftIcon, FolderIcon, PlayIcon } from '../icons';

const ROW_H = 55;
const NAME_LIMIT = 120;

/** A start waiting for the Member to pick Add or Switch. */
interface PendingStart {
  label: string;
  canAdd: boolean;
  note: string | null;
  run: (mode: StartMode) => Promise<void>;
}

export function TimerPanel() {
  const { state, startTimer, pauseTimer, resumeTimer, stopTimer, stopAllTimers } = useAgent();
  const { search, setSearch, openProjectId, setOpenProjectId, showToast, clearCompleted } = useUi();
  const active = useActiveTask();
  const bridge = window.agentBridge;
  const timer = state.agentState?.timer;
  /** The Workspace's Plan has no Tasks: a Project is tracked directly (#299). */
  const projectOnly = state.agentState?.timerRequiresTask === false;
  /** Every active Timer, oldest first (#400). */
  const timers = timer?.timers ?? [];
  const simultaneousEnabled = state.agentState?.simultaneousTimersEnabled === true;

  const [pending, setPending] = useState<PendingStart | null>(null);
  const choiceRef = useRef<HTMLDivElement>(null);
  /** The row that opened the choice, focused again when it closes. */
  const choiceTrigger = useRef<HTMLElement | null>(null);
  const [acting, setActing] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [taskCache, setTaskCache] = useState<Record<string, Task[]>>({});
  /** Projects whose tasks could not be read, by the message the server gave. */
  const [taskError, setTaskError] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One row at least, not two: with three Timer cards above it, a short window
  // holds a single row, and a forced second one would be cut instead of paged.
  const [listRef, perPage] = useFitCount<HTMLDivElement>(ROW_H, { min: 1, max: 14, item: '.v2-row' });

  useEffect(() => {
    bridge.getProjects().then((r) => {
      setLoading(false);
      if (!r.ok) { setFailed(true); return; }
      setProjects(r.data);
    });
  }, []);

  /**
   * Fetch a project's tasks once; used for counts, search and the drill-down.
   *
   * A failure is not retried on its own, but it does not stick either: the
   * project drops out of `requested`, so opening it again — what the empty state
   * tells you to do — asks afresh. The failure used to be a 403 on every project
   * this user could see but held no membership on, where any retry repeated a
   * call that could not succeed; #31 removed that gate, so what is left is a
   * server or network fault, which the next open may well find cleared.
   */
  const requested = useRef<Set<string>>(new Set());

  /** When each Task created here was added, so a read issued before it cannot drop it. */
  const createdAt = useRef<Record<string, number>>({});

  /**
   * The one place a task response is applied. Every `getTasks` call — the
   * fetch below and the post-timer refresh — goes through `readTasks` and lands
   * here, so a refresh cannot leave behind an error its own success just
   * disproved, and cannot fail silently either.
   */
  function receiveTasks(projectId: string, r: Awaited<ReturnType<typeof bridge.getTasks>>, issuedAt: number) {
    if (!r.ok) {
      requested.current.delete(projectId);
      setTaskError((e) => ({ ...e, [projectId]: r.error ?? 'Could not load tasks' }));
      return;
    }
    setTaskCache((c) => ({
      ...c,
      [projectId]: mergeTaskRead(c[projectId] ?? [], r.data, createdAt.current, issuedAt),
    }));
    setTaskError((e) => {
      if (!(projectId in e)) return e;
      const next = { ...e };
      delete next[projectId];
      return next;
    });
  }

  function readTasks(projectId: string) {
    const issuedAt = Date.now();
    void bridge.getTasks({ crmProjectId: projectId }).then((r) => receiveTasks(projectId, r, issuedAt));
  }

  function ensureTasks(projectId: string) {
    if (projectOnly || requested.current.has(projectId)) return;
    requested.current.add(projectId);
    readTasks(projectId);
  }

  useEffect(() => {
    if (openProjectId) ensureTasks(openProjectId);
  }, [openProjectId]);

  // Durations move while a timer runs; re-read the open project shortly after
  // the entry changes so the row totals are not stale.
  const timersKey = timers.map((t) => t.entryId).join(',');
  useEffect(() => {
    if (!openProjectId) return;
    const t = setTimeout(() => readTasks(openProjectId), 1500);
    return () => clearTimeout(t);
  }, [timer?.entryId, timersKey, openProjectId]);

  // Add, or Cancel when Add is not offered: Switch stops the other Timers, so it is never the default.
  useEffect(() => {
    if (!pending) return;
    const buttons = choiceRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    (pending.canAdd ? buttons[0] : buttons[buttons.length - 1]).focus();
  }, [pending]);

  useEffect(() => { setPage(0); }, [search, openProjectId, creating]);
  useEffect(() => { if (creating) setTimeout(() => inputRef.current?.focus(), 40); }, [creating]);

  const openProject = projects.find((p) => p.id === openProjectId) ?? null;
  const query = search.trim().toLowerCase();

  const rows = useMemo(() => {
    if (openProject) {
      const tasks = taskCache[openProject.id] ?? [];
      return query ? tasks.filter((t) => t.name.toLowerCase().includes(query)) : tasks;
    }
    if (!query) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (taskCache[p.id] ?? []).some((t) => t.name.toLowerCase().includes(query)),
    );
  }, [openProject, projects, taskCache, query]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * perPage, current * perPage + perPage);

  // Only the projects on screen pay for a task fetch. Keyed on the ids rather
  // than the array so paging triggers it and re-rendering does not.
  const visibleIds = openProject ? '' : (visible as Project[]).map((p) => p.id).join(',');
  useEffect(() => {
    if (!visibleIds) return;
    visibleIds.split(',').forEach(ensureTasks);
  }, [visibleIds]);

  /**
   * Start now, or ask Add or Switch first when the option is on and a Timer is
   * active (#400). A task (or, without one, a Project) already tracked offers Switch only.
   */
  function requestStart(label: string, crmProjectId: string, taskId: string | null, run: (mode?: StartMode) => Promise<void>) {
    const choice = startChoice({
      simultaneousTimersEnabled: simultaneousEnabled,
      activeCount: timers.length,
      taskHasTimer: timers.some((t) => (taskId ? t.taskId === taskId : t.crmProjectId === crmProjectId)),
    });
    if (!choice.ask) { void run(); return; }
    choiceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({ label, canAdd: choice.canAdd, note: choice.note, run });
  }

  function closeChoice() {
    setPending(null);
    choiceTrigger.current?.focus();
  }

  function pick(mode: StartMode) {
    const chosen = pending;
    closeChoice();
    if (chosen) void chosen.run(mode);
  }

  async function start(task: Task, projectName: string, mode?: StartMode) {
    clearCompleted();
    const result = await startTimer({
      crmProjectId: task.crmProjectId,
      projectName,
      taskId: task.id,
      taskName: task.name,
      taskDurationToday: task.durationToday ?? 0,
      mode,
    });
    showToast(
      result.ok ? `Tracking “${task.name}”` : result.error ?? 'Could not start the timer',
      result.ok ? 'now' : 'error',
    );
  }

  async function startProject(project: Project, mode?: StartMode) {
    clearCompleted();
    const result = await startTimer({ crmProjectId: project.id, projectName: project.name, mode });
    showToast(
      result.ok ? `Tracking “${project.name}”` : result.error ?? 'Could not start the timer',
      result.ok ? 'now' : 'error',
    );
  }

  function timerName(t: ActiveTimerState): string {
    return t.taskName ?? t.projectName ?? (projectOnly ? 'Project time' : 'Untitled task');
  }

  async function toggleTimer(t: ActiveTimerState) {
    if (acting) return;
    setActing(true);
    try {
      const running = t.status === 'running';
      const result = running ? await pauseTimer(t.entryId) : await resumeTimer(t.entryId);
      showToast(
        result.ok
          ? `${running ? 'Paused' : 'Resumed'} “${timerName(t)}”`
          : result.error ?? (running ? 'Could not pause' : 'Could not resume'),
        result.ok ? 'now' : 'error',
      );
    } finally {
      setActing(false);
    }
  }

  async function stopOne(t: ActiveTimerState) {
    if (acting) return;
    setActing(true);
    try {
      const result = await stopTimer(t.entryId);
      showToast(
        result.ok ? `Entry logged · ${formatHM(t.elapsedToday)} on “${timerName(t)}”` : result.error ?? 'Could not stop the timer',
        result.ok ? 'ok' : 'error',
      );
    } finally {
      setActing(false);
    }
  }

  async function stopAll() {
    if (acting) return;
    setActing(true);
    try {
      const count = timers.length;
      const result = await stopAllTimers();
      showToast(result.ok ? `${count} entries logged` : result.error ?? 'Could not stop the timers', result.ok ? 'ok' : 'error');
    } finally {
      setActing(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setCreateError(null);
    const outcome = await createFromTimerPanel(name, openProject, bridge);
    setBusy(false);
    if (!outcome.ok) { setCreateError(outcome.error); return; }
    setCreating(false);
    setNewName('');
    setSearch('');
    if (outcome.kind === 'task') {
      // First, not last: closing the form puts the list back on its first page,
      // where the new Task is then in view. The next read of the project's tasks
      // returns the server's order (oldest first) and moves it to the end.
      const task = outcome.task;
      createdAt.current[task.id] = Date.now();
      setTaskCache((c) => ({ ...c, [task.crmProjectId]: [task, ...(c[task.crmProjectId] ?? [])] }));
    } else {
      const created = outcome.project;
      setProjects((prev) => [created, ...prev]);
      if (!projectOnly) {
        // With Tasks, a new project opens on its (empty) Task list. Without them
        // no row carries a task count, so the new one is given none either.
        setTaskCache((c) => ({ ...c, [created.id]: [] }));
        setOpenProjectId(created.id);
      }
    }
    showToast(outcome.toast);
  }

  // A stopped entry reads as paused at zero, which is what it is from here: the
  // task is still on screen and the play button still starts it.
  const statusLabel = active
    ? `${active.status === 'running' ? 'Recording' : 'Paused'} · ${formatElapsed(active.seconds)} this session`
    : '';

  // Add or Switch takes the place of the Timer cards while it is open: it is
  // about them, and the list below keeps its rows.
  const choiceBox = pending && (
    <div
      className="v2-create v2-choice"
      role="group"
      aria-labelledby="v2-choice-title"
      ref={choiceRef}
      onKeyDown={(e) => { if (e.key === 'Escape') closeChoice(); }}
    >
      <p className="v2-choice__title" id="v2-choice-title">Start “{pending.label}”</p>
      <p className="v2-choice__body">
        {pending.canAdd
          ? 'Add runs it beside your other timers. Switch stops them and starts this one.'
          : `${pending.note} Switch stops your other timers and starts this one.`}
      </p>
      <div className="v2-create__actions">
        {pending.canAdd && (
          <button className="v2-btn v2-btn--primary" type="button" onClick={() => pick('add')}>
            Add timer
          </button>
        )}
        <button className="v2-btn v2-btn--secondary" type="button" onClick={() => pick('switch')}>
          Switch timer
        </button>
        <button className="v2-btn v2-btn--secondary" type="button" onClick={closeChoice}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <Panel>
      <PanelHead title={projectOnly ? 'Select project' : 'Select task'}>
        <div className="v2-search">
          <span className="v2-search__glyph" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={projectOnly ? 'Search projects…' : 'Search projects or tasks…'}
            aria-label={projectOnly ? 'Search projects' : 'Search projects or tasks'}
          />
        </div>
      </PanelHead>

      <PanelBody>
        {choiceBox ? choiceBox : timers.length > 1 ? (
          <>
            <p className="v2-seclabel">
              <span className="v2-seclabel__text">Active timers</span>
              <span className="v2-seclabel__spacer" />
              <button className="v2-btn v2-btn--secondary v2-btn--small" type="button" onClick={() => void stopAll()} disabled={acting}>
                Stop all
              </button>
            </p>
            <div className="v2-actives">
              {timers.map((t) => (
                <div className="v2-active v2-active--compact" key={t.entryId}>
                  <div className="v2-active__text">
                    <p className="v2-active__task" title={timerName(t)}>
                      <span className={`v2-active__dot${t.status === 'running' ? '' : ' v2-active__dot--paused'}`} />
                      <span className="v2-active__name">{t.taskName ?? (projectOnly ? 'Project time' : 'Untitled task')}</span>
                    </p>
                    <p className="v2-active__status" title={t.projectName ?? undefined}>
                      {/* The clock first: a long project name is what gets cut. */}
                      {formatElapsed(t.elapsedToday)} · {t.status === 'running' ? 'Recording' : 'Paused'} · {t.projectName ?? 'Unknown project'}
                    </p>
                  </div>
                  <button
                      className="v2-btn v2-btn--secondary v2-btn--small"
                      type="button"
                      onClick={() => void toggleTimer(t)}
                      disabled={acting}
                      aria-label={`${t.status === 'running' ? 'Pause' : 'Resume'} “${timerName(t)}”`}
                    >
                      {t.status === 'running' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      className="v2-btn v2-btn--danger v2-btn--small"
                      type="button"
                      onClick={() => void stopOne(t)}
                      disabled={acting}
                      aria-label={`Stop “${timerName(t)}” and log the entry`}
                    >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : active && (
          <>
            <p className="v2-seclabel"><span className="v2-seclabel__text">Active task</span></p>
            <div className="v2-active">
              <span className="v2-active__project">
                <span className="v2-active__dot" />
                {active.projectName}
              </span>
              <p className="v2-active__task">{active.taskName ?? (projectOnly ? 'Project time' : 'Untitled task')}</p>
              <p className="v2-active__status">{statusLabel}</p>
            </div>
          </>
        )}

        <p className="v2-seclabel">
          {openProject && (
            <button
              className="v2-back"
              onClick={() => { setOpenProjectId(null); setCreating(false); }}
              title="Back to all projects"
            >
              <ArrowLeftIcon size={12} />
              All
            </button>
          )}
          <span className="v2-seclabel__text">{openProject ? openProject.name : 'All projects'}</span>
          <span className="v2-seclabel__spacer" />
          <button
            className="v2-add"
            aria-label={openProject ? 'New task' : 'New project'}
            title={openProject ? 'New task' : 'New project'}
            onClick={() => { setCreating(true); setNewName(''); setCreateError(null); }}
          >
            +
          </button>
        </p>

        {creating && (
          <form className="v2-create" onSubmit={submitCreate}>
            <input
              ref={inputRef}
              className="v2-create__input"
              value={newName}
              maxLength={NAME_LIMIT}
              placeholder={openProject ? 'Task name…' : 'Project name…'}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            />
            <div className="v2-create__actions">
              <button className="v2-btn v2-btn--primary" type="submit" disabled={!newName.trim() || busy}>
                {busy ? 'Creating…' : 'Create'}
              </button>
              <button className="v2-btn v2-btn--secondary" type="button" onClick={() => { setCreating(false); setNewName(''); }}>
                Cancel
              </button>
              <span className="v2-create__hint">
                {openProject ? `${NAME_LIMIT}-character limit` : 'Also appears in the web app.'}
              </span>
            </div>
            {createError && <p className="v2-create__error">{createError}</p>}
          </form>
        )}


        <div className="v2-panel__list" ref={listRef}>
          {loading && <p className="v2-empty">Loading…</p>}
          {failed && <p className="v2-empty">Could not reach the server.</p>}

          {!loading && !failed && rows.length === 0 && (
            <p className="v2-empty">
              {query
                ? 'No match.'
                : openProject
                  // An empty task list and a failed one look identical otherwise,
                  // and "use + to add one" is wrong advice for the second.
                  ? taskError[openProject.id]
                    ? `${taskError[openProject.id]} — try opening the project again.`
                    : 'No tasks yet — use + to add one.'
                  : 'No projects yet — use + to create one.'}
            </p>
          )}

          {openProject
            ? (visible as Task[]).map((task) => {
                // A task counts its time in full, Simultaneous Time included (#400).
                const liveTimer = timers.find((t) => t.taskId === task.id)
                  ?? (timer?.taskId === task.id && timer.status !== 'stopped'
                    ? { elapsedToday: timer.elapsedToday }
                    : undefined);
                const live = !!liveTimer;
                const seconds = liveTimer ? liveTimer.elapsedToday : task.durationToday ?? 0;
                return (
                  <PanelRow
                    key={task.id}
                    name={task.name}
                    meta={openProject.name}
                    icon={<PlayIcon size={13} />}
                    end={seconds > 0 ? formatDuration(seconds) : undefined}
                    selected={live}
                    onClick={() => requestStart(task.name, task.crmProjectId, task.id, (mode) => start(task, openProject.name, mode))}
                  />
                );
              })
            : (visible as Project[]).map((project) => {
                const tasks = taskCache[project.id];
                const isActive = active?.projectName === project.name || timers.some((t) => t.projectName === project.name);
                return (
                  <PanelRow
                    key={project.id}
                    name={project.name}
                    icon={projectOnly ? <PlayIcon size={13} /> : <FolderIcon size={15} />}
                    meta={tasks ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : undefined}
                    end={isActive ? 'ACTIVE' : undefined}
                    endAccent={isActive}
                    selected={projectOnly && isActive}
                    onClick={() => {
                      setCreating(false);
                      if (projectOnly) requestStart(project.name, project.id, null, (mode) => startProject(project, mode));
                      else setOpenProjectId(project.id);
                    }}
                  />
                );
              })}
        </div>
      </PanelBody>

      <Pager page={current} pages={pages} onChange={setPage} />
    </Panel>
  );
}
