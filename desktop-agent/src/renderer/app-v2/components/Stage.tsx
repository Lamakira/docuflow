/**
 * Stage — the right-hand column.
 *
 * The design's title bar carries three grey dots standing in for window
 * controls. They are not reproduced: this window has real ones from the OS, and
 * a second, dead set beside them is a control that lies. The bar keeps the
 * wordmark and gains the two things that were homeless after the tab bar was
 * removed — the staging-server badge and the connection state.
 */

import { useAgent } from '../../app/stores/AgentContext';
import { Toast } from './Toast';
import { UpdateBanner } from './UpdateBanner';

export function Stage({ children }: { children: React.ReactNode }) {
  const { state } = useAgent();
  const source = state.agentState?.apiBaseSource;

  return (
    <main className="v2-stage">
      <div className="v2-stage__bar">
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
