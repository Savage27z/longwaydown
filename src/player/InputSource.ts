import { RIDING } from '../config/vehicles';
import type { Input } from '../core/Input';
import type { VehicleInput } from '../vehicles/Vehicle';

/**
 * Where a rider's controls come from each fixed step: this machine's keyboard/gamepad, a bot,
 * or (later) a remote player's inputs off the network. The rider applies race rules (countdown
 * freeze, auto-brake after the finish) on top, so sources only report intent.
 */
export interface InputSource {
  read(out: VehicleInput): void;
}

/** Keyboard / gamepad of the player at this machine. */
export class LocalInput implements InputSource {
  private steerSmooth = 0;

  constructor(private readonly input: Input) {}

  read(i: VehicleInput): void {
    const inp = this.input;
    i.throttle = inp.value('accelerate');
    i.brake = inp.value('brake');
    // Keys get a very short ramp so they don't twitch; analog sticks go straight through.
    const raw = inp.axis('steerLeft', 'steerRight');
    if (inp.lastDevice === 'gamepad') this.steerSmooth = raw;
    else {
      const rising = Math.abs(raw) > Math.abs(this.steerSmooth) && Math.sign(raw) === Math.sign(this.steerSmooth || raw);
      const rate = (rising ? RIDING.steerRise : RIDING.steerFall) / 60;
      this.steerSmooth += Math.max(-rate, Math.min(rate, raw - this.steerSmooth));
    }
    i.steer = this.steerSmooth;
    i.pitch = inp.axis('pitchBack', 'pitchForward');
    i.spin = inp.axis('spinLeft', 'spinRight');
    i.jumpPressed = inp.stepPressed('jump');
    i.jumpHeld = inp.isDown('jump');
    i.boost = inp.isDown('boost');
    i.trick = inp.isDown('trick');
  }
}
