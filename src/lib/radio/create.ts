// The source the Radio screen listens with. The multi-signal engine replaces
// the interim one here, behind the same interface.

import type { RadioSource } from './source';
import { SingleSignalSource } from './single';

export function createRadioSource(): RadioSource {
  return new SingleSignalSource();
}
