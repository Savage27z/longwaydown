import { describe, expect, it } from 'vitest';
import { VEHICLE_IDS } from '../src/config/vehicles';
import { vehicleSlots } from '../src/vehicles/slots';

describe('vehicle wheel slots', () => {
  it('offers every vehicle on the snow map', () => {
    const slots = vehicleSlots('snow');
    expect(slots.map((s) => s.id)).toEqual(VEHICLE_IDS);
    expect(slots.every((s) => s.enabled)).toBe(true);
  });

  it('disables snow-only vehicles off snow', () => {
    const off = vehicleSlots('alpine').filter((s) => !s.enabled);
    expect(off.map((s) => s.id).sort()).toEqual(['skis', 'snowboard']);
    expect(off.every((s) => s.reason === 'Snow only')).toBe(true);
  });

  it('marks locked vehicles before biome rules', () => {
    const slots = vehicleSlots('alpine', (id) => id !== 'jet' && id !== 'skis');
    expect(slots.find((s) => s.id === 'jet')).toMatchObject({ enabled: false, reason: 'Locked' });
    expect(slots.find((s) => s.id === 'skis')).toMatchObject({ enabled: false, reason: 'Locked' });
  });
});
