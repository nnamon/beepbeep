// Plays the class exercises: a run of cards, each in a set pattern of CW,
// voice and silence. Familiarity says the card first; recognition and TTR say
// it after; groups and copy read everything back at the end; Speed Racing plays
// each card fast to slow; VET and VST step the speed on a timer.
//
// Audio, speech and time come in through PlayerDeps, so tests can run the
// pattern on a fake clock.

import type { Card } from './cards';

export interface Recipe {
  /** Character and effective (Farnsworth) speed, wpm. */
  wpm: number;
  fwpm: number;
  /** Extra plays of each card, and the silence between plays in word spaces (default 1). */
  repeats?: number;
  repeatGap?: number;
  /**
   * The voice: before the CW (familiarity), after it (recognition, TTR), or
   * reading every card back at the end (groups, copy). `delay` is the silence
   * before it speaks and `after` the silence after, in seconds. `lastWord`
   * says only a card's last word.
   */
  voice?: { when: 'before' | 'after' | 'end'; spell: boolean; delay: number; after?: number; lastWord?: boolean };
  /** CW, voice, CW: the card plays once more after the voice. */
  again?: boolean;
  /** Silence between cards, seconds. */
  wait?: number;
  /**
   * Speed Racing: each card at wpm × each multiplier in turn. `say` speaks the
   * card after the last; `replay` then plays it once more at the first.
   */
  racer?: { multipliers: number[]; say?: boolean; replay?: boolean };
  /** Timed speed steps (VET, VST): each lasts `seconds`; the run ends after the last. */
  steps?: { seconds: number; wpm: number; fwpm: number }[];
  /** Run length for generated material, seconds: no card starts after it. */
  seconds?: number;
}

export interface Sound {
  done: Promise<void>;
  stop(): void;
}

export interface PlayerDeps {
  cw(text: string, wpm: number, fwpm: number): Promise<Sound>;
  say(text: string, spell: boolean): Promise<void>;
  hush(): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type Phase = 'ready' | 'voice' | 'cw' | 'gap' | 'paused' | 'recap' | 'done';

export interface PlayerState {
  phase: Phase;
  /** The card playing, or next to play. */
  index: number;
  total: number;
  /** Speeds of the card playing. */
  wpm: number;
  fwpm: number;
  /** Playing time so far, seconds (pauses excluded). */
  elapsed: number;
  /** Cards finished so far: these may be shown. */
  done: number;
}

/** Silence of n word spaces at an effective speed, ms. */
export const wordSpaceMs = (n: number, fwpm: number) => n * 7 * (1200 / fwpm);

export class Player {
  readonly state: PlayerState;
  private gen = 0;
  private sound: Sound | null = null;
  private activeSince: number | null = null;
  private activeMs = 0;

  constructor(
    readonly cards: Card[],
    readonly recipe: Recipe,
    private readonly deps: PlayerDeps,
    private readonly onChange: (s: PlayerState) => void = () => {},
  ) {
    this.state = { phase: 'ready', index: 0, total: cards.length, wpm: recipe.wpm, fwpm: recipe.fwpm, elapsed: 0, done: 0 };
  }

  /** Total length when the run is timed, seconds. */
  get length(): number | null {
    if (this.recipe.steps) return this.recipe.steps.reduce((a, s) => a + s.seconds, 0);
    return this.recipe.seconds ?? null;
  }

  private set(p: Partial<PlayerState>) {
    Object.assign(this.state, p);
    this.state.elapsed = this.elapsedMs() / 1000;
    this.onChange({ ...this.state });
  }

  private elapsedMs(): number {
    return this.activeMs + (this.activeSince === null ? 0 : this.deps.now() - this.activeSince);
  }

  /** Cuts whatever is sounding and invalidates the running loop. */
  private interrupt() {
    this.gen++;
    this.sound?.stop();
    this.sound = null;
    this.deps.hush();
    if (this.activeSince !== null) {
      this.activeMs += this.deps.now() - this.activeSince;
      this.activeSince = null;
    }
  }

  start() {
    if (this.state.phase === 'done' || this.state.phase === 'recap') {
      this.activeMs = 0;
      this.set({ index: 0, done: 0 });
    }
    this.interrupt();
    void this.run(this.gen);
  }

  pause() {
    if (this.state.phase === 'ready' || this.state.phase === 'done' || this.state.phase === 'paused') return;
    this.interrupt();
    // Pausing the read-back ends it; Read back starts it again.
    if (this.state.phase === 'recap') return this.set({ phase: 'done' });
    this.set({ phase: 'paused' });
  }

  /**
   * Plays the current card again from its start. Paused in the gap after a
   * card, it goes on with the next one rather than repeating the card just heard.
   */
  resume() {
    if (this.state.phase !== 'paused') return;
    this.interrupt();
    if (this.state.done > this.state.index) this.set({ index: Math.min(this.state.done, this.cards.length - 1) });
    void this.run(this.gen);
  }

  back() {
    this.jump(Math.max(0, this.state.index - 1));
  }

  next() {
    this.jump(Math.min(this.cards.length - 1, this.state.index + 1));
  }

  private jump(index: number) {
    // Not once the run has finished: Again starts a new one.
    if (this.state.phase === 'done' || this.state.phase === 'recap') return;
    const playing = !['ready', 'paused'].includes(this.state.phase);
    this.interrupt();
    this.set({ index, done: Math.min(this.state.done, index) });
    if (playing) void this.run(this.gen);
    else this.set({});
  }

  stop() {
    this.interrupt();
    this.activeMs = 0;
    this.set({ phase: 'ready', index: 0, done: 0 });
  }

  /** Reads every card back, as at the end of a groups or copy run. */
  async recap() {
    this.interrupt();
    const gen = this.gen;
    this.set({ phase: 'recap' });
    const spell = this.recipe.voice?.spell ?? true;
    for (const c of this.cards.slice(0, Math.max(this.state.done, 1))) {
      if (gen !== this.gen) return;
      await this.deps.say(c.speech || c.cw, spell);
      await this.deps.sleep(400);
    }
    if (gen === this.gen) this.set({ phase: 'done' });
  }

  /** Speeds in effect now: the timed step, or the recipe's. */
  private speeds(): { wpm: number; fwpm: number } {
    const steps = this.recipe.steps;
    if (!steps?.length) return { wpm: this.recipe.wpm, fwpm: this.recipe.fwpm };
    let t = this.elapsedMs() / 1000;
    for (const s of steps) {
      if (t < s.seconds) return { wpm: s.wpm, fwpm: s.fwpm };
      t -= s.seconds;
    }
    const last = steps[steps.length - 1];
    return { wpm: last.wpm, fwpm: last.fwpm };
  }

  private async play(text: string, wpm: number, fwpm: number, gen: number): Promise<boolean> {
    if (!text) return gen === this.gen;
    this.set({ phase: 'cw', wpm, fwpm });
    const s = await this.deps.cw(text, wpm, fwpm);
    if (gen !== this.gen) {
      s.stop();
      return false;
    }
    this.sound = s;
    await s.done;
    this.sound = null;
    return gen === this.gen;
  }

  private async speak(c: Card, gen: number, lastWord = false): Promise<boolean> {
    const v = this.recipe.voice!;
    let text = c.speech || c.cw;
    if (lastWord) text = text.trim().split(/\s+/).at(-1) ?? text;
    await this.deps.sleep(v.delay * 1000);
    if (gen !== this.gen) return false;
    this.set({ phase: 'voice' });
    await this.deps.say(text, v.spell);
    if (gen !== this.gen) return false;
    await this.deps.sleep((v.after ?? 0) * 1000);
    return gen === this.gen;
  }

  private async gap(ms: number, gen: number): Promise<boolean> {
    if (ms <= 0) return gen === this.gen;
    this.set({ phase: 'gap' });
    await this.deps.sleep(ms);
    return gen === this.gen;
  }

  /** One card in the recipe's pattern; false when interrupted. */
  private async card(c: Card, gen: number): Promise<boolean> {
    const r = this.recipe;
    const { wpm, fwpm } = this.speeds();
    const between = wordSpaceMs(r.repeatGap ?? 1, fwpm);
    const plays = 1 + (r.repeats ?? 0);
    if (r.voice?.when === 'before' && c.speech && !(await this.speak(c, gen))) return false;
    if (r.racer) {
      const m = r.racer.multipliers;
      for (let i = 0; i < m.length; i++) {
        if (i && !(await this.gap(between, gen))) return false;
        if (!(await this.play(c.cw, Math.round(wpm * m[i]), Math.round(fwpm * m[i]), gen))) return false;
      }
      if (r.racer.say && r.voice && c.speech && !(await this.speak(c, gen))) return false;
      if (r.racer.replay) {
        if (!(await this.gap(between, gen))) return false;
        if (!(await this.play(c.cw, Math.round(wpm * m[0]), Math.round(fwpm * m[0]), gen))) return false;
      }
    } else {
      for (let i = 0; i < plays; i++) {
        if (i && !(await this.gap(between, gen))) return false;
        if (!(await this.play(c.cw, wpm, fwpm, gen))) return false;
      }
    }
    if (r.voice?.when === 'after' && !r.racer && c.speech && !(await this.speak(c, gen, r.voice.lastWord))) return false;
    if (r.again && !(await this.play(c.cw, wpm, fwpm, gen))) return false;
    return true;
  }

  private overTime(): boolean {
    const len = this.length;
    return len !== null && this.elapsedMs() / 1000 >= len;
  }

  private async run(gen: number) {
    this.activeSince = this.deps.now();
    while (gen === this.gen && this.state.index < this.cards.length) {
      const i = this.state.index;
      if (!(await this.card(this.cards[i], gen))) return;
      this.set({ done: Math.max(this.state.done, i + 1) });
      if (this.overTime() || i + 1 >= this.cards.length) break;
      if (!(await this.gap((this.recipe.wait ?? 0) * 1000, gen))) return;
      if (this.overTime()) break;
      this.set({ index: i + 1 });
    }
    if (gen !== this.gen) return;
    if (this.activeSince !== null) {
      this.activeMs += this.deps.now() - this.activeSince;
      this.activeSince = null;
    }
    if (this.recipe.voice?.when === 'end') await this.recap();
    else this.set({ phase: 'done' });
  }
}
