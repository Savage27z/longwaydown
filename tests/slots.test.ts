import { describe, expect, it } from 'vitest';
import { VEHICLE_IDS } from '../src/config/vehicles';
import { vehicleSlots } from '../src/vehicles/slots';

describe('vehicle wheel slots', () => {
  it('offers every vehicle on the snow map when high enough for the wingsuit', () => {
    const slots = vehicleSlots('snow', 50);
    expect(slots.map((s) => s.id)).toEqual(VEHICLE_IDS);
    expect(slots.every((s) => s.enabled)).toBe(true);
  });

  it('needs altitude for the wingsuit', () => {
    expect(vehicleSlots('snow', 0).find((s) => s.id === 'wingsuit')).toMatchObject({ enabled: false, reason: 'Need altitude' });
    expect(vehicleSlots('snow', 3).find((s) => s.id === 'wingsuit')?.enabled).toBe(false);
  });

  it('never offers on foot', () => {
    expect(vehicleSlots('snow', 50).some((s) => s.id === 'onFoot')).toBe(false);
  });

  it('disables snow-only vehicles off snow', () => {
    const off = vehicleSlots('alpine', 50).filter((s) => !s.enabled);
    expect(off.map((s) => s.id).sort()).toEqual(['skis', 'snowboard']);
    expect(off.every((s) => s.reason === 'Snow only')).toBe(true);
  });

  it('marks locked vehicles before biome rules', () => {
    const slots = vehicleSlots('alpine', 50, (id) => id !== 'car' && id !== 'skis');
    expect(slots.find((s) => s.id === 'car')).toMatchObject({ enabled: false, reason: 'Locked' });
    expect(slots.find((s) => s.id === 'skis')).toMatchObject({ enabled: false, reason: 'Locked' });
  });
});
