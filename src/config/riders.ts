/**
 * Rider outfits from the Quaternius "Ultimate Modular Men" pack (CC0). Every character shares one
 * skeleton and splits into Head / Body / Legs / Feet meshes that can be mixed freely.
 * Mesh names follow `<Prefix>_<Part>` inside public/models/riders.glb.
 */
export const OUTFITS = ['SpaceSuit', 'Swat', 'Adventurer', 'Casual', 'Casual2', 'Beach', 'Farmer', 'Punk', 'Suit', 'Worker', 'King'] as const;
export type OutfitId = (typeof OUTFITS)[number];
export type OutfitPart = 'Head' | 'Body' | 'Legs' | 'Feet';

export const OUTFIT_LABELS: Record<OutfitId, string> = {
  SpaceSuit: 'Race Suit',
  Swat: 'Armour',
  Adventurer: 'Trail',
  Casual: 'Hoodie',
  Casual2: 'Casual',
  Beach: 'Beach',
  Farmer: 'Farmer',
  Punk: 'Punk',
  Suit: 'Suit',
  Worker: 'Hi-Vis',
  King: 'Royal',
};

/** Some packs name a part differently. */
const PART_ALIASES: Partial<Record<string, string>> = { Farmer_Legs: 'Farmer_Pants' };

export function partMeshName(outfit: OutfitId, part: OutfitPart): string {
  const name = `${outfit}_${part}`;
  return PART_ALIASES[name] ?? name;
}

export interface RiderLook {
  head: OutfitId;
  body: OutfitId;
  legs: OutfitId;
  feet: OutfitId;
  backpack: boolean;
  /** Colours per slot (unset = the outfit's own colours). */
  colors?: RiderColors;
  /** Index into SKIN_TONES (unset = the pack's own). */
  skin?: number;
  goggles?: 'none' | 'goggles' | 'shades';
  gloves?: boolean;
  bodyType?: 'slim' | 'regular' | 'strong';
}

export interface RiderColors {
  helmet?: string;
  top?: string;
  top2?: string;
  pants?: string;
  shoes?: string;
  gloves?: string;
  hair?: string;
  lens?: string;
}

export const DEFAULT_LOOK: RiderLook = { head: 'SpaceSuit', body: 'SpaceSuit', legs: 'SpaceSuit', feet: 'SpaceSuit', backpack: false };

export const RIDER_ASSET = {
  url: '/models/riders.glb',
  credit: 'Ultimate Modular Men by Quaternius (CC0) — quaternius.com',
};
