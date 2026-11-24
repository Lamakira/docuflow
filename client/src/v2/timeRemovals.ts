/**
 * Time Entries removed on screen and not yet on the server (F68). Each one is
 * settled once, by the first of Undo, the end of its toast, or leaving the
 * page. No React in here, so leaving can send what is pending. A closed tab
 * sends nothing: the entry stays.
 */

type Removal = { key: string; id: string };

export type TimeRemovalsDeps = {
  /** Sends the one DELETE. */
  send: (id: string) => Promise<unknown>;
  /** Shows the Undo toast; `key` is new for each removal, so one toast never answers for another. */
  show: (removal: Removal, handlers: { undo: () => void; end: () => void }) => void;
  /** Takes a toast off the screen. */
  hide: (key: string) => void;
  onSent: (id: string) => void;
  onFailed: (id: string, error: unknown) => void;
  /** The hidden set changed. */
  onChange: () => void;
};

export class TimeRemovals {
  private pending = new Map<string, Removal>();
  /** Off the register: pending, being sent, or gone. A failure or Undo takes one out. */
  private hidden = new Set<string>();
  private sequence = 0;

  constructor(private readonly deps: TimeRemovalsDeps) {}

  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  hiddenIds(): string[] {
    return Array.from(this.hidden);
  }

  remove(id: string): void {
    if (this.hidden.has(id)) return;
    this.sequence += 1;
    const removal = { key: `v2-time-removal-${this.sequence}-${id}`, id };
    this.pending.set(removal.key, removal);
    this.hidden.add(id);
    this.deps.onChange();
    this.deps.show(removal, { undo: () => this.undo(removal.key), end: () => this.commit(removal.key) });
  }

  /** Sends everything pending, for a reader leaving the page. */
  flush(): void {
    for (const removal of Array.from(this.pending.values())) {
      this.commit(removal.key);
      this.deps.hide(removal.key);
    }
  }

  private undo(key: string): void {
    const removal = this.pending.get(key);
    if (!removal) return;
    this.pending.delete(key);
    this.hidden.delete(removal.id);
    this.deps.onChange();
  }

  private commit(key: string): void {
    const removal = this.pending.get(key);
    if (!removal) return;
    this.pending.delete(key);
    this.deps.send(removal.id).then(
      () => this.deps.onSent(removal.id),
      (error) => {
        this.hidden.delete(removal.id);
        this.deps.onChange();
        this.deps.onFailed(removal.id, error);
      },
    );
  }
}
