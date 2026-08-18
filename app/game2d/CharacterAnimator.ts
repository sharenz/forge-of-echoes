import Phaser from "phaser";
import {
  CHARACTER_ANIMATIONS,
  characterAnimationKey,
  characterSpriteSheetKey,
  characterVisualOffsetY,
  resolveCharacterDirection,
  type CharacterAnimationState,
  type CharacterDirection,
} from "../game/config/character-animations";
import type { CharacterClassId } from "../game/domain";

interface PendingAction {
  key: string;
  releaseTextureFrame: number;
  released: boolean;
  onRelease: () => void;
  onComplete?: () => void;
}

export class CharacterAnimator {
  private direction: CharacterDirection = "south";
  private moving = false;
  private pendingAction: PendingAction | null = null;
  private currentLoopKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprite: Phaser.GameObjects.Sprite,
    private readonly classId: CharacterClassId,
  ) {
    this.registerAnimations();
    this.sprite.setOrigin(0.5, 1).setScale(CHARACTER_ANIMATIONS[classId].renderScale);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.handleAnimationUpdate, this);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    this.playLocomotion(true);
  }

  get currentDirection(): CharacterDirection {
    return this.direction;
  }

  setLocomotion(x: number, y: number, moving: boolean): void {
    this.moving = moving;
    if (moving && !this.pendingAction) this.direction = resolveCharacterDirection(x, y, this.direction);
    if (!this.pendingAction) this.playLocomotion();
  }

  playAction(
    state: Extract<CharacterAnimationState, "attack" | "cast" | "dash">,
    direction: CharacterDirection,
    playbackRate: number,
    onRelease: () => void,
    onComplete?: () => void,
  ): boolean {
    if (this.pendingAction) return false;
    this.direction = direction;
    this.currentLoopKey = null;
    const definition = CHARACTER_ANIMATIONS[this.classId];
    const clip = definition.clips[direction][state];
    const sheet = definition.sheets[clip.sheet];
    if (!sheet) throw new Error(`Missing ${this.classId} sprite sheet: ${clip.sheet}`);
    const sourceDirection = direction === "west" ? "west" : direction;
    const key = characterAnimationKey(this.classId, sourceDirection, state);
    const releaseTextureFrame = clip.row * sheet.columns + clip.startColumn + (clip.releaseFrame ?? clip.frameCount - 1);
    this.pendingAction = { key, releaseTextureFrame, released: false, onRelease, onComplete };
    this.applyDirectionFlip();
    this.sprite.anims.timeScale = Math.max(0.1, playbackRate);
    this.sprite.play(key, true);
    return true;
  }

  setWorldTransform(x: number, y: number, depth: number): void {
    this.sprite.setPosition(Math.round(x), Math.round(y + characterVisualOffsetY(this.classId))).setDepth(depth);
  }

  destroy(): void {
    this.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.handleAnimationUpdate, this);
    this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
  }

  private registerAnimations(): void {
    const definition = CHARACTER_ANIMATIONS[this.classId];
    for (const direction of ["south", "north", "east", "west"] as const) {
      for (const state of ["idle", "run", "attack", "cast", "dash"] as const) {
        const key = characterAnimationKey(this.classId, direction, state);
        if (this.scene.anims.exists(key)) continue;
        const clip = definition.clips[direction][state];
        const sheet = definition.sheets[clip.sheet];
        if (!sheet) throw new Error(`Missing ${this.classId} sprite sheet: ${clip.sheet}`);
        const start = clip.row * sheet.columns + clip.startColumn;
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(characterSpriteSheetKey(this.classId, clip.sheet), {
            start,
            end: start + clip.frameCount - 1,
          }),
          frameRate: clip.frameRate,
          repeat: clip.repeat,
        });
      }
    }
  }

  private playLocomotion(force = false): void {
    const state = this.moving ? "run" : "idle";
    const key = characterAnimationKey(this.classId, this.direction, state);
    if (!force && this.currentLoopKey === key && this.sprite.anims.isPlaying) return;
    this.currentLoopKey = key;
    this.sprite.anims.timeScale = 1;
    this.applyDirectionFlip();
    this.sprite.play(key, true);
  }

  private applyDirectionFlip(): void {
    this.sprite.setFlipX(this.direction === "west");
  }

  private handleAnimationUpdate(_animation: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame): void {
    const pending = this.pendingAction;
    if (!pending || pending.released || Number(frame.textureFrame) !== pending.releaseTextureFrame) return;
    pending.released = true;
    pending.onRelease();
  }

  private handleAnimationComplete(animation: Phaser.Animations.Animation): void {
    const pending = this.pendingAction;
    if (!pending || animation.key !== pending.key) return;
    if (!pending.released) pending.onRelease();
    const onComplete = pending.onComplete;
    this.pendingAction = null;
    this.sprite.anims.timeScale = 1;
    this.playLocomotion(true);
    onComplete?.();
  }
}
