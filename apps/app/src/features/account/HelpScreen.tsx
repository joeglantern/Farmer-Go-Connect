import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSession } from '../../data/session';
import { PRIVACY_URL, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP, TERMS_URL } from '../../lib/config';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Chip } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';

type Topic = 'ordering' | 'payments' | 'delivery' | 'account';
const FAQ: Record<Topic, string[]> = {
  ordering: ['order', 'requirement', 'matches', 'cancel'],
  payments: ['mpesa', 'held', 'invoice', 'refund'],
  delivery: ['when', 'track', 'quality', 'crates'],
  account: ['language', 'business', 'password', 'delete'],
};
const TOPICS = Object.keys(FAQ) as Topic[];

/** Answers to common questions, plus support contacts when this build has them configured. */
export function HelpScreen() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const [topic, setTopic] = useState<Topic>('ordering');
  const [open, setOpen] = useState<string | null>(null);
  const role = useSession((s) => s.me?.user.role);
  const wide = size !== 'compact';

  const contacts = [
    SUPPORT_WHATSAPP ? (
      <ListRow
        key="wa"
        icon="chat"
        label={tr('profile.whatsapp')}
        detail={tr('help.whatsappHint')}
        external
        onPress={() => void Linking.openURL(`https://wa.me/${(SUPPORT_WHATSAPP ?? '').replace(/\D/g, '')}`)}
      />
    ) : null,
    SUPPORT_PHONE ? (
      <ListRow
        key="call"
        icon="phone"
        label={tr('profile.callUs')}
        value={SUPPORT_PHONE}
        onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
      />
    ) : null,
    SUPPORT_EMAIL ? (
      <ListRow
        key="mail"
        icon="mail"
        label={tr('profile.emailUs')}
        value={SUPPORT_EMAIL}
        external
        onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
      />
    ) : null,
  ].filter(Boolean);
  const legal = [
    TERMS_URL ? (
      <ListRow
        key="terms"
        icon="invoice"
        label={tr('profile.terms')}
        external
        onPress={() => void Linking.openURL(TERMS_URL ?? '')}
      />
    ) : null,
    PRIVACY_URL ? (
      <ListRow
        key="privacy"
        icon="shield"
        label={tr('profile.privacy')}
        external
        onPress={() => void Linking.openURL(PRIVACY_URL ?? '')}
      />
    ) : null,
  ].filter(Boolean);

  const faq = (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TOPICS.map((k) => (
          <Chip
            key={k}
            label={tr(`help.topics.${k}`)}
            selected={topic === k}
            onPress={() => {
              setTopic(k);
              setOpen(null);
            }}
          />
        ))}
      </View>
      <ListGroup>
        {FAQ[topic].map((q) => (
          <Question
            key={`${topic}.${q}`}
            q={tr(`help.faq.${topic}.${q}.q`)}
            a={tr(`help.faq.${topic}.${q}.a`, { context: role === 'farmer' ? 'farmer' : undefined })}
            open={open === `${topic}.${q}`}
            onToggle={() => setOpen(open === `${topic}.${q}` ? null : `${topic}.${q}`)}
          />
        ))}
      </ListGroup>
    </View>
  );

  const side = (
    <View style={{ gap: 20 }}>
      {contacts.length > 0 ? (
        <ListGroup title={tr('help.contact')} footer={tr('help.hours')}>
          {contacts}
        </ListGroup>
      ) : (
        <ListGroup title={tr('help.contact')}>
          <ListRow
            key="none"
            icon="info"
            label={tr('help.noContactTitle')}
            detail={tr('help.noContactBody')}
          />
        </ListGroup>
      )}
      {legal.length > 0 && <ListGroup title={tr('help.legal')}>{legal}</ListGroup>}
    </View>
  );

  return (
    <Screen
      header={<Header title={tr('help.title')} subtitle={tr('help.subtitle')} />}
      maxWidth={wide ? 980 : undefined}
    >
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 4 }}>
          <View style={{ flex: 1.5 }}>{faq}</View>
          <View style={{ flex: 1 }}>{side}</View>
        </View>
      ) : (
        <View style={{ gap: 24, paddingTop: 4 }}>
          {faq}
          {side}
        </View>
      )}
    </Screen>
  );
}

function Question({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={q}
        focusRadius={t.radius.md}
        style={({ hovered, pressed }) => [
          styles.q,
          { backgroundColor: hovered || pressed ? t.colors.surfaceMuted : 'transparent' },
        ]}
      >
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {q}
        </Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} color={t.colors.textTertiary} />
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(t.motion.base)} style={styles.a}>
          <Text variant="callout" tone="secondary">
            {a}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  q: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  a: { paddingHorizontal: 14, paddingBottom: 16 },
});
