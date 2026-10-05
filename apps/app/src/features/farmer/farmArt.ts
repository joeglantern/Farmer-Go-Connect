import { images } from '../../assets/registry';

const ART = [images.farms.rows, images.farms.orchard, images.farms.nursery].filter(Boolean);

/** Stable stock photo for a farm without its own photo. */
export function farmArt(id: string) {
  if (!ART.length) return null;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ART[h % ART.length]!;
}
