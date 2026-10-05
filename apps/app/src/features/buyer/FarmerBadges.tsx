import type { FarmerBadge } from '@farmgo/contracts';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { images } from '../../assets/registry';
import { Tag } from '../../ui/Controls';
import type { IconName } from '../../ui/Icon';

const SEALS: Record<
  FarmerBadge,
  { image: (typeof images.badges)[keyof typeof images.badges]; icon: IconName }
> = {
  youth: { image: images.badges.youthLed, icon: 'sparkle' },
  woman_led: { image: images.badges.womanLed, icon: 'user' },
  organic: { image: images.badges.organic, icon: 'leaf' },
  verified: { image: images.badges.verified, icon: 'shield' },
};

/** Farmer badges as seals with labels, like the product page tags. */
export function FarmerBadges({ badges, max }: { badges: readonly string[]; max?: number }) {
  const { t: tr } = useTranslation();
  const known = badges.filter((b): b is FarmerBadge => b in SEALS).slice(0, max);
  if (known.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8 }}>
      {known.map((b) => (
        <Tag key={b} label={tr(`farmers.badges.${b}`)} icon={SEALS[b].icon} badge={SEALS[b].image} />
      ))}
    </View>
  );
}
