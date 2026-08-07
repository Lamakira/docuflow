/**
 * Stage — the right-hand column.
 *
 * The bar at its top is the window's title bar, and its drag region, in every
 * chrome mode the app draws for itself. Where the window is frameless — Linux
 * and Windows — the design's three decorative dots also get a real job as
 * minimise / maximise / close; on macOS the native traffic lights are inset
 * into the rail instead. Everything interactive in the bar opts out of dragging.
 */

import { useAgent } from '../../app/stores/AgentContext';
import { Toast } from './Toast';
import { UpdateBanner } from './UpdateBanner';
import { WindowControls } from './WindowControls';

export function Stage({ children }: { children: React.ReactNode }) {
  const { state } = useAgent();
  const source = state.agentState?.apiBaseSource;

  return (
    <main className="v2-stage">
      <div
        className="v2-stage__bar"
        onDoubleClick={() => { void window.agentBridge.windowToggleMaximize?.().catch(() => {}); }}
      >
        <span className="v2-stage__wordmark">DocuFlow</span>
        {/* Production is where the app runs, so labelling it says nothing; a
            build pointed at a dev server is what someone needs to notice. */}
        {source && source !== 'default' && <span className="v2-stage__badge">DEV</span>}
        {/* Left of the bar, not right: the update strip is positioned top-right
            and would sit on top of it. */}
        {state.agentState?.isPaired && <span className="v2-stage__conn">Connected</span>}
        {/* In the bar's flow rather than floating over it: the bar is otherwise
            empty, and a floating strip covered the connection state at the
            narrow end of the window. */}
        <UpdateBanner />
        <WindowControls />
      </div>
      <div className="v2-stage__body">{children}</div>
      {/* Positioned against the stage, bottom-centre. Never pushes the layout. */}
      <Toast />
    </main>
  );
}

export function StageHead({ title, subtitle, children }: {
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="v2-stage__head">
      <div>
        <h1 className="v2-h1">{title}</h1>
        {subtitle && <p className="v2-sub">{subtitle}</p>}
      </div>
      {children && <div className="v2-stage__head-end">{children}</div>}
    </header>
  );
}
