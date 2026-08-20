import Phaser from "phaser";
import {
  CHARACTER_ANIMATIONS,
  characterAnimationKey,
  characterSpriteSheetKey,
  characterVisualOffsetY,
  resolveLocomotionDirection,
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
  releaseFallback?: Phaser.Time.TimerEvent;
  completionFallback?: Phaser.Time.TimerEvent;
}

export class CharacterAnimator {
  private direction: CharacterDirection = "south";
  private moving = false;
  private pendingAction: PendingAction | null = null;
  private currentLoopKey: string | null = null;
  private locomotionPlaybackRate = 1;

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

  setLocomotion(x: number, y: number, moving: boolean, speedRatio = 1): void {
    this.moving = moving;
    this.locomotionPlaybackRate = moving ? Phaser.Math.Clamp(0.82 + speedRatio * 0.22, 0.82, 1.04) : 1;
    if (moving && !this.pendingAction) this.direction = resolveLocomotionDirection(x, y, this.direction);
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
    const pending: PendingAction = { key, releaseTextureFrame, released: false, onRelease, onComplete };
    this.pendingAction = pending;
    this.applyDirectionFlip();
    this.sprite.anims.timeScale = Math.max(0.1, playbackRate);
    this.sprite.play(key, true);
    const releaseFrame = clip.releaseFrame ?? clip.frameCount - 1;
    const releaseDelayMilliseconds = ((releaseFrame + 1) / clip.frameRate / Math.max(0.1, playbackRate)) * 1_000;
    pending.releaseFallback = this.scene.time.delayedCall(releaseDelayMilliseconds, () => {
      if (this.pendingAction === pending) this.releasePendingAction(pending);
    });
    const completionDelayMilliseconds = (clip.frameCount / clip.frameRate / Math.max(0.1, playbackRate)) * 1_000 + 50;
    pending.completionFallback = this.scene.time.delayedCall(completionDelayMilliseconds, () => {
      if (this.pendingAction === pending) this.finishPendingAction(pending);
    });
    return true;
  }

  setWorldTransform(x: number, y: number, depth: number): void {
    this.sprite.setPosition(x, y + characterVisualOffsetY(this.classId)).setDepth(depth);
  }

  destroy(): void {
    this.pendingAction?.releaseFallback?.remove(false);
    this.pendingAction?.completionFallback?.remove(false);
    this.pendingAction = null;
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
    if (!force && this.currentLoopKey === key && this.sprite.anims.isPlaying) {
      this.sprite.anims.timeScale = this.locomotionPlaybackRate;
      return;
    }
    this.currentLoopKey = key;
    this.sprite.anims.timeScale = this.locomotionPlaybackRate;
    this.applyDirectionFlip();
    this.sprite.play(key, true);
  }

  private applyDirectionFlip(): void {
    this.sprite.setFlipX(this.direction === "west");
  }

  private handleAnimationUpdate(_animation: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame): void {
    const pending = this.pendingAction;
    if (!pending || pending.released || Number(frame.textureFrame) !== pending.releaseTextureFrame) return;
    this.releasePendingAction(pending);
  }

  private handleAnimationComplete(animation: Phaser.Animations.Animation): void {
    const pending = this.pendingAction;
    if (!pending || animation.key !== pending.key) return;
    this.finishPendingAction(pending);
  }

  private finishPendingAction(pending: PendingAction): void {
    if (this.pendingAction !== pending) return;
    this.releasePendingAction(pending);
    pending.releaseFallback?.remove(false);
    pending.completionFallback?.remove(false);
    const onComplete = pending.onComplete;
    this.pendingAction = null;
    this.sprite.anims.timeScale = 1;
    this.playLocomotion(true);
    onComplete?.();
  }

  private releasePendingAction(pending: PendingAction): void {
    if (pending.released) return;
    pending.released = true;
    pending.onRelease();
  }
}
