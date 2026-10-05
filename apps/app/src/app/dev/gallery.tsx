import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSchemePreference, useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import {
  Avatar,
  Card,
  Checkbox,
  Chip,
  Pill,
  RadioRow,
  Segmented,
  Stepper,
  Switch,
  Tag,
} from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Text } from '../../ui/Text';
import { SearchField, TextField } from '../../ui/TextField';

/**
 * Temporary design-system gallery, shown while the real screens are being built.
 * Replaced by the Splash route once auth lands.
 */
/** The component gallery is a development tool: release builds send anyone who finds it home. */
export default function GalleryRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Gallery />;
}

function Gallery() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const { preference, setPreference } = useSchemePreference();
  const dialog = useDialog();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [chip, setChip] = useState('All');
  const [pay, setPay] = useState('mpesa');
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [sheet, setSheet] = useState(false);
  const [notify, setNotify] = useState(true);
  const [agree, setAgree] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: 64, alignItems: 'center' }}
    >
      <View style={[styles.col, { maxWidth: 960, paddingHorizontal: 20 }]}>
        <View style={styles.rowBetween}>
          <View style={{ gap: 4, flex: 1 }}>
            <Text variant="display">FarmGo Connect</Text>
            <Text variant="body" tone="secondary">
              Design system, live. Window class: {size}. Theme: {t.scheme}.
            </Text>
          </View>
          <Segmented
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Auto' },
            ]}
          />
        </View>

        <Section title="Colour roles">
          <View style={styles.swatches}>
            {(
              [
                ['band', 'Forest'],
                ['primary', 'Primary'],
                ['leaf', 'Leaf'],
                ['accentLime', 'Lime'],
                ['primaryTintStrong', 'Tint'],
                ['bg', 'Ground'],
                ['text', 'Ink'],
                ['danger', 'Danger'],
                ['warning', 'Warning'],
                ['info', 'Info'],
              ] as const
            ).map(([k, label]) => (
              <View key={k} style={styles.swatch}>
                <View
                  style={[styles.swatchChip, { backgroundColor: t.colors[k], borderColor: t.colors.line }]}
                />
                <Text variant="caption">{label}</Text>
                <Text variant="micro" tone="tertiary">
                  {t.colors[k]}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Type">
          <Text variant="display">Fresh. Local.</Text>
          <Text variant="title1">From Farm to Your Table</Text>
          <Text variant="title2">Create Your Account</Text>
          <Text variant="title3">Featured Farmers</Text>
          <Text variant="headline">Tomatoes (1kg)</Text>
          <Text variant="body">Fresh, organic tomatoes grown using sustainable farming practices.</Text>
          <Text variant="callout" tone="secondary">
            Murang&apos;a · 12 km away
          </Text>
          <Text variant="priceLarge" numeric>
            KES 1,520
          </Text>
        </Section>

        <Section title="Buttons">
          <View style={styles.wrap}>
            <Button label="Get Started" fullWidth={false} />
            <Button label="Login" variant="outline" fullWidth={false} />
            <Button label="Add to Cart" size="sm" variant="primary" fullWidth={false} />
            <Button label="Call" variant="secondary" icon="phone" size="md" fullWidth={false} />
            <Button label="Delete listing" variant="danger" size="md" fullWidth={false} />
            <Button label="Placing order" loading size="md" fullWidth={false} />
            <Button label="Disabled" disabled size="md" fullWidth={false} />
          </View>
          <View style={styles.wrap}>
            <IconButton icon="bell" label="Notifications" badge={3} />
            <IconButton icon="heart" label="Favourite" variant="surface" />
            <IconButton icon="back" label="Back" variant="tinted" />
            <View style={{ backgroundColor: t.colors.band, borderRadius: 12, padding: 8 }}>
              <IconButton icon="back" label="Back" variant="onBrand" />
            </View>
          </View>
        </Section>

        <Section title="Inputs">
          <SearchField placeholder="Search for products..." value="" onChangeText={() => undefined} />
          <TextField label="Delivery Address" placeholder="123 Riverside Drive, Westlands" icon="location" />
          <TextField
            label="M-Pesa number"
            prefix="+254"
            placeholder="712 345 678"
            keyboardType="phone-pad"
            hint="We send the payment prompt to this phone."
          />
          <TextField
            label="Password"
            secureToggle
            placeholder="At least 8 characters"
            error="Use at least 8 characters."
          />
        </Section>

        <Section title="Selection">
          <View style={styles.wrap}>
            {['All', 'Leafy Greens', 'Root Crops', 'Others'].map((c) => (
              <Chip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />
            ))}
          </View>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'active', label: 'Active', count: 3 },
              { value: 'past', label: 'Past' },
            ]}
          />
          <View style={{ gap: 10 }}>
            <RadioRow
              label="M-Pesa"
              description="Pay with a prompt on your phone"
              selected={pay === 'mpesa'}
              onPress={() => setPay('mpesa')}
            />
            <RadioRow label="Card / Bank Transfer" selected={pay === 'card'} onPress={() => setPay('card')} />
          </View>
          <Stepper value={qty} onChange={setQty} min={1} unit="kg" />
          <Switch
            value={notify}
            onChange={setNotify}
            label="Order updates by SMS"
            description="For when you have no data"
          />
          <Checkbox checked={agree} onChange={setAgree} label="I agree to the Terms and Privacy Policy" />
        </Section>

        <Section title="Status and tags">
          <View style={styles.wrap}>
            <Pill label="Confirmed" tone="brand" icon="check" />
            <Pill label="Out for delivery" tone="info" icon="truck" />
            <Pill label="Awaiting payment" tone="warning" icon="clock" />
            <Pill label="Cancelled" tone="danger" />
            <Pill label="Draft" />
          </View>
          <View style={styles.wrap}>
            <Tag label="Fresh" icon="leaf" />
            <Tag label="Organic" icon="sprout" />
            <Tag label="Local" icon="location" />
          </View>
        </Section>

        <Section title="Cards">
          <View style={styles.grid}>
            <Card style={{ flex: 1, minWidth: 150, gap: 6 }}>
              <Text variant="callout" tone="secondary">
                Total Listings
              </Text>
              <Text variant="statNumber" numeric>
                12
              </Text>
            </Card>
            <Card style={{ flex: 1, minWidth: 150, gap: 6 }}>
              <Text variant="callout" tone="secondary">
                Total Sales
              </Text>
              <Text variant="statNumber" numeric>
                KES 45,600
              </Text>
            </Card>
            <Card style={{ flex: 1, minWidth: 150, gap: 6 }}>
              <Text variant="callout" tone="secondary">
                Rating
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="statNumber" numeric>
                  4.8
                </Text>
                <Icon name="star" weight="fill" color={t.colors.star} size={20} />
              </View>
            </Card>
          </View>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name="Mary Wanjiku" size={56} />
            <View style={{ flex: 1 }}>
              <Text variant="headline">Mary Wanjiku</Text>
              <Text variant="callout" tone="secondary">
                Kiambu County
              </Text>
            </View>
            <Pill label="Verified" tone="success" icon="shield" />
          </Card>
        </Section>

        <Section title="Feedback">
          <Banner
            tone="warning"
            title="You are offline"
            message="Changes are saved on this phone and sent when you reconnect."
          />
          <Banner
            tone="brand"
            message="Buyers in Nairobi need 400 kg of tomatoes next week."
            action={{ label: 'List your harvest', onPress: () => undefined }}
          />
          <View style={styles.wrap}>
            <Button
              label="Confirm dialog"
              variant="outline"
              size="md"
              fullWidth={false}
              onPress={async () => {
                const ok = await dialog.confirm({
                  title: 'Cancel this order?',
                  message: 'The farmer will be told and the 20 kg goes back on sale. This cannot be undone.',
                  confirmLabel: 'Cancel order',
                  cancelLabel: 'Keep order',
                  destructive: true,
                  icon: 'warning',
                });
                toast.show(ok ? 'Order cancelled' : 'Order kept');
              }}
            />
            <Button
              label="Success toast"
              variant="outline"
              size="md"
              fullWidth={false}
              onPress={() => toast.success('Added to cart', { label: 'View cart', onPress: () => undefined })}
            />
            <Button
              label="Error toast"
              variant="outline"
              size="md"
              fullWidth={false}
              onPress={() =>
                toast.error('M-Pesa is not responding.', { label: 'Retry', onPress: () => undefined })
              }
            />
            <Button
              label="Open sheet"
              variant="outline"
              size="md"
              fullWidth={false}
              onPress={() => setSheet(true)}
            />
          </View>
        </Section>
      </View>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Delivery window"
        subtitle="Tomorrow, Saturday 27 September"
        footer={<Button label="Save window" onPress={() => setSheet(false)} />}
      >
        {['06:00 to 08:00', '08:00 to 10:00', '10:00 to 12:00', '14:00 to 16:00'].map((w) => (
          <RadioRow key={w} label={w} selected={w === '08:00 to 10:00'} onPress={() => undefined} />
        ))}
      </Sheet>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 14, marginTop: 36 }}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: '100%' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  swatch: { width: 84, gap: 4 },
  swatchChip: { width: 84, height: 56, borderRadius: 12, borderWidth: 1 },
});
