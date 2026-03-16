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

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [newTaskName, setNewTaskName] = useState('');

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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
      setSelectedTaskId('');
      return;
    }
    setTasksLoading(true);
    setSelectedTaskId('');
    bridge.getTasks({ crmProjectId: selectedProjectId }).then((r) => {
      setTasksLoading(false);
      if (r.ok) setTasks(r.data);
      else setTasks([]);
    });
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const isNewTask = selectedTaskId === '__new__';
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const canStart = !!selectedProjectId && (!!selectedTask || (isNewTask && !!newTaskName.trim()));

  async function handleStart() {
    if (!canStart || !selectedProject) return;
    setStartError(null);
    setStarting(true);
    const result = await startTimer({
      crmProjectId: selectedProjectId,
      projectName: selectedProject.name,
      taskId: isNewTask ? undefined : selectedTask?.id,
      taskName: isNewTask ? newTaskName.trim() : selectedTask?.name,
    });
    setStarting(false);
    if (!result.ok) {
      setStartError(result.error ?? 'Failed to start timer');
      setTimeout(() => setStartError(null), 3000);
    }
  }

  async function handleStartRecent(r: typeof recentTasks[0]) {
    setStarting(true);
    await startTimer({
      crmProjectId: r.crmProjectId,
      taskId: r.taskId ?? undefined,
      taskName: r.taskName ?? undefined,
      projectName: r.projectName,
    });
    setStarting(false);
  }

  return (
    <div className="picker-v2">
      <div className="picker-v2__heading">What are you working on?</div>

      <div className="picker-v2__row">
        <div className="picker-v2__field">
          <label className="picker-v2__field-label">Project</label>
          <select
            className="picker-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={projectsLoading || projectsError}
          >
            <option value="">
              {projectsLoading ? 'Loading…' : projectsError ? 'Failed to load' : 'Select project'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="picker-v2__field">
          <label className="picker-v2__field-label">Task</label>
          <select
            className="picker-select"
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            disabled={!selectedProjectId || tasksLoading}
          >
            <option value="">
              {!selectedProjectId
                ? 'Select project first'
                : tasksLoading
                ? 'Loading…'
                : 'Select task'}
            </option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            {selectedProjectId && !tasksLoading && (
              <option value="__new__">+ New task…</option>
            )}
          </select>
        </div>

        <button
          className="btn btn--success picker-v2__start-btn"
          disabled={!canStart || starting}
          onClick={handleStart}
        >
          {starting ? '…' : '▶ Start'}
        </button>
      </div>

      {isNewTask && (
        <div className="picker-v2__new-task">
          <input
            className="field__input"
            placeholder="Enter task name…"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            autoFocus
          />
        </div>
      )}

      {startError && <div className="picker-v2__error">{startError}</div>}

      {!projectsLoading && !projectsError && projects.length === 0 && (
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

      {recentTasks.length > 0 && (
        <div className="picker-v2__recents">
          <div className="picker__section-label">Recent</div>
          <div className="picker__list">
            {recentTasks.map((r, i) => (
              <div key={i} className="recent-item">
                <span className="recent-item__icon">↺</span>
                <div className="recent-item__info">
                  <div className="recent-item__task">{r.taskName ?? '(no task)'}</div>
                  <div className="recent-item__project">{r.projectName}</div>
                </div>
                <button
                  className="btn btn--sm btn--success"
                  disabled={starting}
                  onClick={() => handleStartRecent(r)}
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
