import React, { useEffect, useState, useRef } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { Project, Task } from '../../types';
import { InlineTaskCreator } from './InlineTaskCreator';

export function ProjectTaskPicker() {
  const { state, startTimer } = useAgent();
  const bridge = window.agentBridge;
  const apiBase = state.agentState?.apiBase ?? null;

  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskMap, setTaskMap] = useState<Record<string, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const { recentTasks } = state;

  useEffect(() => {
    setProjectsLoading(true);
    bridge.getProjects().then((r) => {
      setProjectsLoading(false);
      if (r.ok) {
        setProjects(r.data);
      } else {
        setProjectsError(true);
      }
    });
  }, []);

  async function toggleProject(projectId: string) {
    const isOpen = expanded[projectId];
    setExpanded((e) => ({ ...e, [projectId]: !isOpen }));

    if (!isOpen && !taskMap[projectId]) {
      setLoadingTasks((l) => ({ ...l, [projectId]: true }));
      const result = await bridge.getTasks({ crmProjectId: projectId });
      setLoadingTasks((l) => ({ ...l, [projectId]: false }));
      if (result.ok) {
        setTaskMap((m) => ({ ...m, [projectId]: result.data }));
      }
    }
  }

  async function handleStartTask(project: Project, task: Task) {
    const key = task.id;
    setStarting(key);
    await startTimer({
      crmProjectId: project.id,
      taskId: task.id,
      taskName: task.name,
      projectName: project.name,
    });
    setStarting(null);
  }

  async function handleStartRecent(r: typeof recentTasks[0]) {
    const key = `recent-${r.crmProjectId}-${r.taskId ?? 'none'}`;
    setStarting(key);
    await startTimer({
      crmProjectId: r.crmProjectId,
      taskId: r.taskId ?? undefined,
      taskName: r.taskName ?? undefined,
      projectName: r.projectName,
      description: r.description ?? undefined,
    });
    setStarting(null);
  }

  // Filter
  const q = search.toLowerCase();
  const filteredProjects = q
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (taskMap[p.id] ?? []).some((t) => t.name.toLowerCase().includes(q))
      )
    : projects;

  // Auto-expand on search
  useEffect(() => {
    if (!q) return;
    const next: Record<string, boolean> = {};
    projects.forEach((p) => {
      const matchesProject = p.name.toLowerCase().includes(q);
      const matchesTask = (taskMap[p.id] ?? []).some((t) => t.name.toLowerCase().includes(q));
      if (matchesProject || matchesTask) next[p.id] = true;
    });
    setExpanded((e) => ({ ...e, ...next }));
  }, [q]);

  return (
    <div className="picker">
      {/* Search */}
      <div className="picker__search-wrap">
        <input
          className="picker__search"
          placeholder="Search projects & tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Recent tasks */}
      {!q && recentTasks.length > 0 && (
        <>
          <div className="picker__section-label">Recent</div>
          <div className="picker__list">
            {recentTasks.map((r, i) => {
              const key = `recent-${r.crmProjectId}-${r.taskId ?? 'none'}`;
              return (
                <div key={i} className="recent-item">
                  <span className="recent-item__icon">↺</span>
                  <div className="recent-item__info">
                    <div className="recent-item__task">{r.taskName ?? '(no task)'}</div>
                    <div className="recent-item__project">{r.projectName}</div>
                  </div>
                  <button
                    className="btn btn--sm btn--success recent-item__start"
                    disabled={starting === key}
                    onClick={() => handleStartRecent(r)}
                  >
                    {starting === key ? '…' : 'Start'}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="picker__section-label">Projects</div>
        </>
      )}

      {/* Projects list */}
      {projectsLoading && (
        <div className="empty-state" style={{ padding: '1rem' }}>
          <span>Loading projects…</span>
        </div>
      )}
      {!projectsLoading && projectsError && (
        <div className="empty-state">
          <span>Failed to load projects.</span>
          {apiBase && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.agentBridge.openExternal(apiBase!); }}
            >
              Open web app
            </a>
          )}
        </div>
      )}
      {!projectsLoading && !projectsError && filteredProjects.length === 0 && (
        <div className="empty-state">
          <span>No projects found.</span>
          {apiBase && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.agentBridge.openExternal(apiBase!); }}
            >
              Create one in the web app
            </a>
          )}
        </div>
      )}

      <div className="picker__list">
        {filteredProjects.map((project) => {
          const isOpen = !!expanded[project.id];
          const tasks = taskMap[project.id] ?? [];
          const isLoadingTasks = !!loadingTasks[project.id];
          const filteredTasks = q
            ? tasks.filter((t) => t.name.toLowerCase().includes(q))
            : tasks;

          return (
            <div className="project-row" key={project.id}>
              <div
                className={`project-row__header${isOpen ? ' project-row__header--expanded' : ''}`}
                onClick={() => toggleProject(project.id)}
              >
                <span className="project-row__chevron">{isOpen ? '▼' : '▶'}</span>
                <span className="project-row__name">{project.name}</span>
              </div>

              {isOpen && (
                <div className="project-row__tasks">
                  {isLoadingTasks && (
                    <div className="task-item" style={{ color: 'var(--text-dim)', cursor: 'default' }}>
                      Loading…
                    </div>
                  )}
                  {!isLoadingTasks && filteredTasks.map((task) => {
                    const key = task.id;
                    return (
                      <button
                        key={task.id}
                        className="task-item"
                        disabled={starting === key}
                        onClick={() => handleStartTask(project, task)}
                      >
                        {starting === key ? 'Starting…' : task.name}
                      </button>
                    );
                  })}
                  {!isLoadingTasks && (
                    <InlineTaskCreator
                      crmProjectId={project.id}
                      projectName={project.name}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
