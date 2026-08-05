/**
 * Icon rail — the app's only navigation.
 *
 * The active item is not highlighted, it is *merged*: its background is the
 * panel's white, and two concave fillets above and below fake the curved join
 * so tab and panel read as one surface. The fillet radius must stay at or below
 * half the item gap (see --notch-r / --rail-gap in tokens.css) or the corner
 * paints over the neighbouring label.
 */

import { useAgent } from '../../app/stores/AgentContext';
import type { AppPage } from '../../app/types';
import { ClockIcon, ActivityIcon, CameraIcon, CogIcon } from '../icons';
import { AvatarMenu } from './AvatarMenu';

const ITEMS: { page: AppPage; label: string; Icon: typeof ClockIcon }[] = [
  { page: 'timer', label: 'TIMER', Icon: ClockIcon },
  { page: 'activity', label: 'ACTIVITY', Icon: ActivityIcon },
  { page: 'screenshots', label: 'SCREENS', Icon: CameraIcon },
  { page: 'settings', label: 'SETTINGS', Icon: CogIcon },
];

export function Rail() {
  const { state, dispatch } = useAgent();

  return (
    <nav className="v2-rail" aria-label="Screens">
      <span className="v2-rail__logo" aria-hidden="true">DF</span>

      <div className="v2-rail__nav">
        {ITEMS.map(({ page, label, Icon }) => {
          const active = state.page === page;
          return (
            <button
              key={page}
              className={`v2-rail__item${active ? ' v2-rail__item--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_PAGE', page })}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <>
                  <span className="v2-rail__fillet v2-rail__fillet--top" />
                  <span className="v2-rail__fillet v2-rail__fillet--bottom" />
                </>
              )}
              <span className="v2-rail__glyph"><Icon size={13} /></span>
              <span className="v2-rail__label">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="v2-rail__foot">
        <AvatarMenu />
      </div>
    </nav>
  );
}
