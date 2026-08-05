/**
 * Side-effect module: installs the mock bridge on `window` before any app
 * module is evaluated. Import this FIRST in the harness — ES modules evaluate
 * in import order, so this runs before AgentContext ever looks for
 * `window.agentBridge`.
 */
import { installMockBridge } from './mockBridge';

installMockBridge();
