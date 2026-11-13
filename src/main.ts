export { createEncounter, stepEncounter, projectEncounter } from './combat/simulation.ts';

if (typeof document !== 'undefined') {
  void Promise.all([import('phaser'), import('./scenes/CombatScene.ts')]).then(([phaser, scene]) => {
    new phaser.default.Game({
      type: phaser.default.AUTO,
      parent: 'game',
      width: 960,
      height: 680,
      backgroundColor: '#171414',
      scale: { mode: phaser.default.Scale.FIT, autoCenter: phaser.default.Scale.CENTER_BOTH },
      scene: scene.CombatScene,
    });
  });
}
