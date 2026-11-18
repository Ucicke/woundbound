if (typeof document !== 'undefined') {
  const gameRoot = document.getElementById('game');

  if (!gameRoot) {
    console.error('[Woundbound] Game mount element #game was not found.');
  } else {
    const titleFont = new FontFace('Woundbound Title', `url(${import.meta.env.BASE_URL}assets/fonts/CormorantUnicase-Bold.ttf)`, { weight: '700' });
    const fontReady = titleFont.load()
      .then(font => { document.fonts.add(font); })
      .catch(error => { console.warn('[Woundbound] Title font failed to load; browser fallback will be used.', error); });

    void Promise.all([import('phaser'), import('./scenes/CombatScene.ts'), fontReady])
      .then(([phaser, scene]) => {
        new phaser.default.Game({
          type: phaser.default.AUTO,
          parent: gameRoot,
          width: 1280,
          height: 720,
          fps: { target: 60 },
          backgroundColor: '#171414',
          scale: { mode: phaser.default.Scale.RESIZE },
          pixelArt: true,
          roundPixels: true,
          render: { antialias: false, pixelArt: true, roundPixels: true },
          scene: scene.CombatScene,
        });
      })
      .catch(error => { console.error('[Woundbound] Game failed to initialize.', error); });
  }
}
