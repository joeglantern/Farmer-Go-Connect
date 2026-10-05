import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { images, type StateKey } from '../assets/registry';
import { useTheme } from '../theme/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const FALLBACK_ICON: Record<StateKey, IconName> = {
  emptyCart: 'basket',
  noOrders: 'receipt',
  noMessages: 'messages',
  noNotifications: 'bell',
  noResults: 'search',
  noListings: 'sprout',
  noMatches: 'handshake',
  noRoutes: 'route',
  offline: 'wifiOff',
  error: 'warning',
  orderPlaced: 'checkCircle',
  paymentReceived: 'wallet',
};

/** Illustration, one line of copy, one action. */
export function EmptyState({
  art,
  title,
  body,
  action,
  compact,
}: {
  art: StateKey;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  compact?: boolean;
}) {
  const t = useTheme();
  const img = images.states[art];
  const size = compact ? 88 : 132;
  return (
    <View
      style={{ alignItems: 'center', paddingVertical: compact ? 20 : 40, paddingHorizontal: 24, gap: 12 }}
    >
      {img ? (
        <Image
          source={img}
          style={{ width: size, height: size }}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: t.colors.primaryTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={FALLBACK_ICON[art]} size={size * 0.42} color={t.colors.primary} weight="duotone" />
        </View>
      )}
      <Text variant={compact ? 'headline' : 'title3'} align="center">
        {title}
      </Text>
      {body && (
        <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 360 }}>
          {body}
        </Text>
      )}
      {action && (
        <Button
          label={action.label}
          icon={action.icon}
          onPress={action.onPress}
          fullWidth={false}
          size="md"
          style={{ marginTop: 8, alignSelf: 'center' }}
        />
      )}
    </View>
  );
}

export function ErrorState({
  onRetry,
  message,
  compact,
}: {
  onRetry?: () => void;
  message?: string;
  compact?: boolean;
}) {
  const { t: tr } = useTranslation();
  return (
    <EmptyState
      art="error"
      compact={compact}
      title={tr('common.errorTitle')}
      body={message ?? tr('common.errorBody')}
      action={onRetry ? { label: tr('common.retry'), onPress: onRetry, icon: 'refresh' } : undefined}
    />
  );
}
