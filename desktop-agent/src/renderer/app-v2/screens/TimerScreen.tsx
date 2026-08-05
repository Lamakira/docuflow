/**
 * Timer screen — panel and stage.
 *
 * Both halves are big enough to own a file; they share state through
 * UiContext rather than props.
 */

import { TimerPanel } from '../panels/TimerPanel';
import { Stage } from '../components/Stage';
import { TimerPage } from '../pages/TimerPage';

export function TimerScreen() {
  return (
    <>
      <TimerPanel />
      <Stage><TimerPage /></Stage>
    </>
  );
}
