import React, { useEffect, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { Project, Task } from '../../types';

export function ProjectTaskPicker() {
  const { state, startTimer } = useAgent();
  const bridge = window.agentBridge;
  const apiBase = state.agentState?.apiBase ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(false);

  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { recentTasks } = state;

  useEffect(() => {
    bridge.getProjects().then((r) => {
      setProjectsLoading(false);
      if (r.ok) setProjects(r.data);
      else setProjectsError(true);
    });
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setTasks([]);
      setTasksError(false);
      return;
    }
    setTasksLoading(true);
    setTasksError(false);
    setTasks([]);
    bridge.getTasks({ crmProjectId: selectedProjectId }).then((r) => {
      setTasksLoading(false);
      if (r.ok) setTasks(r.data);
      else setTasksError(true);
    });
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const filteredProjects = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  async function handleStartTask(task: Task) {
    if (!selectedProject) return;
    setStarting(task.id);
    setStartError(null);
    const result = await startTimer({
      crmProjectId: selectedProject.id,
      projectName: selectedProject.name,
      taskId: task.id,
      taskName: task.name,
    });
    setStarting(null);
    if (!result.ok) {
      setStartError(result.error ?? 'Failed to start timer');
      setTimeout(() => setStartError(null), 3000);
    }
  }

  async function handleStartRecent(r: typeof recentTasks[0]) {
    setStarting(`recent-${r.crmProjectId}-${r.taskId ?? 'none'}`);
    await startTimer({
      crmProjectId: r.crmProjectId,
      taskId: r.taskId ?? undefined,
      taskName: r.taskName ?? undefined,
      projectName: r.projectName,
    });
    setStarting(null);
  }

  return (
    <div className="picker-main">
      {/* Two-column: Projects | Tasks */}
      <div className="picker-cols">
        {/* Left: Projects */}
        <div className="picker-col picker-col--projects">
          <div className="picker-col__header">Projects</div>
          <div className="picker-search">
            <input
              className="picker-search__input"
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="picker-col__list">
            {projectsLoading && (
              <div className="picker-col__empty">Loading…</div>
            )}
            {projectsError && (
              <div className="picker-col__empty">
                Failed to load
                {apiBase && (
                  <a
                    href="#"
                    style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.72rem' }}
                    onClick={(e) => { e.preventDefault(); window.agentBridge.openExternal(apiBase!); }}
                  >
                    Open web app
                  </a>
                )}
              </div>
            )}
            {!projectsLoading && !projectsError && filteredProjects.length === 0 && (
              <div className="picker-col__empty">{search ? 'No match' : 'No projects found'}</div>
            )}
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                className={`picker-project-item${selectedProjectId === project.id ? ' picker-project-item--selected' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Tasks */}
        <div className="picker-col picker-col--tasks">
          <div className="picker-col__header">Tasks</div>
          <div className="picker-col__list">
            {!selectedProjectId && (
              <div className="picker-col__empty">← Select a project</div>
            )}
            {selectedProjectId && tasksLoading && (
              <div className="picker-col__empty">Loading…</div>
            )}
            {selectedProjectId && tasksError && (
              <div className="picker-col__empty">Failed to load tasks</div>
            )}
            {selectedProjectId && !tasksLoading && !tasksError && tasks.length === 0 && (
              <div className="picker-col__empty">
                No tasks.
                {apiBase && (
                  <a
                    href="#"
                    style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.72rem' }}
                    onClick={(e) => { e.preventDefault(); window.agentBridge.openExternal(apiBase!); }}
                  >
                    Create tasks in web app
                  </a>
                )}
              </div>
            )}
            {tasks.map((task) => (
              <button
                key={task.id}
                className="picker-task-item"
                disabled={starting === task.id}
                onClick={() => handleStartTask(task)}
              >
                <span className="picker-task-item__name">{task.name}</span>
                {starting === task.id && <span className="picker-task-item__loading">…</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {startError && <div className="picker-error">{startError}</div>}

      {/* Recent tasks */}
      {recentTasks.length > 0 && (
        <div className="picker-recents">
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
                    className="btn btn--sm btn--success"
                    disabled={starting === key}
                    onClick={() => handleStartRecent(r)}
                  >
                    {starting === key ? '…' : 'Start'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
