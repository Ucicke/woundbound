export type AudioChannel = 'music' | 'effects';
export interface AudioSettings { music: number; effects: number; musicMuted: boolean; effectsMuted: boolean }

const storageKey = 'woundbound.audio.v1';
const defaults: AudioSettings = { music: 1, effects: 1, musicMuted: false, effectsMuted: false };
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function loadAudioSettings(): AudioSettings {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<AudioSettings>;
    return {
      music: typeof data.music === 'number' && Number.isFinite(data.music) ? clamp(data.music) : defaults.music,
      effects: typeof data.effects === 'number' && Number.isFinite(data.effects) ? clamp(data.effects) : defaults.effects,
      musicMuted: data.musicMuted === true, effectsMuted: data.effectsMuted === true,
    };
  } catch { return { ...defaults }; }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Settings still apply for this session. */ }
}
