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
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import type { Project, Task } from '../../app/types';
import { Panel, PanelHead, PanelBody, PanelRow, Pager } from '../components/Panel';
import { useUi } from '../ui/UiContext';
import { useActiveTask } from '../ui/useActiveTask';
import { useFitCount } from '../ui/useFitCount';
import { formatDuration, formatElapsed } from '../format';
import { ArrowLeftIcon, FolderIcon, PlayIcon } from '../icons';

const ROW_H = 55;
const NAME_LIMIT = 120;

export function TimerPanel() {
  const { state, startTimer } = useAgent();
  const { search, setSearch, openProjectId, setOpenProjectId, showToast, clearCompleted } = useUi();
  const active = useActiveTask();
  const bridge = window.agentBridge;
  const timer = state.agentState?.timer;

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

  const [listRef, perPage] = useFitCount<HTMLDivElement>(ROW_H, { min: 2, max: 14 });

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

  /**
   * The one place a task response is applied. Both callers of `getTasks` — the
   * fetch below and the post-timer refresh — go through it, so a refresh cannot
   * leave behind an error its own success just disproved, and cannot fail
   * silently either.
   */
  function receiveTasks(projectId: string, r: Awaited<ReturnType<typeof bridge.getTasks>>) {
    if (!r.ok) {
      requested.current.delete(projectId);
      setTaskError((e) => ({ ...e, [projectId]: r.error ?? 'Could not load tasks' }));
      return;
    }
    setTaskCache((c) => ({ ...c, [projectId]: r.data }));
    setTaskError((e) => {
      if (!(projectId in e)) return e;
      const next = { ...e };
      delete next[projectId];
      return next;
    });
  }

  function ensureTasks(projectId: string) {
    if (requested.current.has(projectId)) return;
    requested.current.add(projectId);
    void bridge.getTasks({ crmProjectId: projectId }).then((r) => receiveTasks(projectId, r));
  }

  useEffect(() => {
    if (openProjectId) ensureTasks(openProjectId);
  }, [openProjectId]);

  // Durations move while a timer runs; re-read the open project shortly after
  // the entry changes so the row totals are not stale.
  useEffect(() => {
    if (!openProjectId) return;
    const t = setTimeout(() => {
      void bridge.getTasks({ crmProjectId: openProjectId }).then((r) =>
        receiveTasks(openProjectId, r),
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [timer?.entryId, openProjectId]);

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

  async function start(task: Task, projectName: string) {
    clearCompleted();
    const result = await startTimer({
      crmProjectId: task.crmProjectId,
      projectName,
      taskId: task.id,
      taskName: task.name,
      taskDurationToday: task.durationToday ?? 0,
    });
    showToast(
      result.ok ? `Tracking “${task.name}”` : result.error ?? 'Could not start the timer',
      result.ok ? 'now' : 'error',
    );
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setCreateError(null);

    if (openProject) {
      const result = await bridge.createTask({ crmProjectId: openProject.id, name });
      setBusy(false);
      if (!result.ok || !result.data) { setCreateError(result.error ?? 'Could not create the task'); return; }
      const created = result.data;
      setTaskCache((c) => ({ ...c, [openProject.id]: [...(c[openProject.id] ?? []), created] }));
      setCreating(false);
      setNewName('');
      await start(created, openProject.name);   // creating a task starts tracking it
      return;
    }

    const result = await bridge.createProject({ name });
    setBusy(false);
    if (!result.ok || !result.data) { setCreateError(result.error ?? 'Could not create the project'); return; }
    const created = result.data;
    setProjects((prev) => [created, ...prev]);
    setTaskCache((c) => ({ ...c, [created.id]: [] }));
    setCreating(false);
    setNewName('');
    setSearch('');
    setOpenProjectId(created.id);              // creating a project opens it
    showToast(`“${created.name}” created`);
  }

  // A stopped entry reads as paused at zero, which is what it is from here: the
  // task is still on screen and the play button still starts it.
  const statusLabel = active
    ? `${active.status === 'running' ? 'Recording' : 'Paused'} · ${formatElapsed(active.seconds)} this session`
    : '';

  return (
    <Panel>
      <PanelHead title="Select task">
        <div className="v2-search">
          <span className="v2-search__glyph" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects or tasks…"
            aria-label="Search projects or tasks"
          />
        </div>
      </PanelHead>

      <PanelBody>
        {active && (
          <>
            <p className="v2-seclabel"><span className="v2-seclabel__text">Active task</span></p>
            <div className="v2-active">
              <span className="v2-active__project">
                <span className="v2-active__dot" />
                {active.projectName}
              </span>
              <p className="v2-active__task">{active.taskName ?? 'Untitled task'}</p>
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
                const live = timer?.taskId === task.id && timer.status !== 'stopped';
                const seconds = live ? timer!.elapsedToday : task.durationToday ?? 0;
                return (
                  <PanelRow
                    key={task.id}
                    name={task.name}
                    meta={openProject.name}
                    icon={<PlayIcon size={13} />}
                    end={seconds > 0 ? formatDuration(seconds) : undefined}
                    selected={live}
                    onClick={() => void start(task, openProject.name)}
                  />
                );
              })
            : (visible as Project[]).map((project) => {
                const tasks = taskCache[project.id];
                const isActive = active?.projectName === project.name;
                return (
                  <PanelRow
                    key={project.id}
                    name={project.name}
                    icon={<FolderIcon size={15} />}
                    meta={tasks ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : undefined}
                    end={isActive ? 'ACTIVE' : undefined}
                    endAccent={isActive}
                    onClick={() => { setOpenProjectId(project.id); setCreating(false); }}
                  />
                );
              })}
        </div>
      </PanelBody>

      <Pager page={current} pages={pages} onChange={setPage} />
    </Panel>
  );
}
