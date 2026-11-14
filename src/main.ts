export { createEncounter, stepEncounter, projectEncounter } from './combat/simulation.ts';

if (typeof document !== 'undefined') {
  const titleFont = new FontFace('Woundbound Title', `url(${import.meta.env.BASE_URL}assets/fonts/CormorantUnicase-Bold.ttf)`, { weight: '700' });
  const fontReady = titleFont.load().then(font => { document.fonts.add(font); }).catch(() => undefined);
  void Promise.all([import('phaser'), import('./scenes/CombatScene.ts'), fontReady]).then(([phaser, scene]) => {
    new phaser.default.Game({
      type: phaser.default.AUTO,
      parent: 'game',
      width: 1280,
      height: 720,
      backgroundColor: '#171414',
      scale: { mode: phaser.default.Scale.RESIZE },
      pixelArt: true,
      roundPixels: true,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scene: scene.CombatScene,
    });
  });
}
