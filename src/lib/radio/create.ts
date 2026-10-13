// The source the Radio screen listens with: every signal in the radio's audio
// at once (multi.ts).

import type { RadioSource } from './source';
import { MultiSignalSource } from './multi';

export function createRadioSource(): RadioSource {
  return new MultiSignalSource();
}
