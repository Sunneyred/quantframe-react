export const CUSTOM_SOUND_PREFIX = "custom:";
export const FALLBACK_SOUND = "cat_meow.mp3";

export const isCustomSound = (fileName: string) => fileName.startsWith(CUSTOM_SOUND_PREFIX);

export const toCustomSoundValue = (fileName: string) => `${CUSTOM_SOUND_PREFIX}${fileName}`;

export const stripCustomSoundPrefix = (fileName: string) =>
  isCustomSound(fileName) ? fileName.slice(CUSTOM_SOUND_PREFIX.length) : fileName;

/**
 * A scale on every app sound played through PlaySound (utils/helper). It is 1 unless the 3D game
 * is mounted: then the in-world master volume and mute drive it (game/audio/AudioSystem.ts).
 */
let appSoundScale = 1;
export const setAppSoundScale = (scale: number) => {
  appSoundScale = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
};
export const getAppSoundScale = () => appSoundScale;
