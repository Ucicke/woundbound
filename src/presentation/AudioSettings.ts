export type AudioChannel = 'music' | 'effects';
export interface AudioSettings { music: number; effects: number; musicMuted: boolean; effectsMuted: boolean }

const storageKey = 'woundbound.audio.v1';
const defaults: AudioSettings = { music: 1, effects: 1, musicMuted: false, effectsMuted: false };
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function normalizeAudioSettings(settings: Partial<AudioSettings>): AudioSettings {
  return {
    music: typeof settings.music === 'number' && Number.isFinite(settings.music) ? clamp(settings.music) : defaults.music,
    effects: typeof settings.effects === 'number' && Number.isFinite(settings.effects) ? clamp(settings.effects) : defaults.effects,
    musicMuted: settings.musicMuted === true,
    effectsMuted: settings.effectsMuted === true,
  };
}

export function loadAudioSettings(): AudioSettings {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<AudioSettings>;
    return normalizeAudioSettings(data);
  } catch { return { ...defaults }; }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(storageKey, JSON.stringify(normalizeAudioSettings(settings))); } catch { /* Settings still apply for this session. */ }
}
