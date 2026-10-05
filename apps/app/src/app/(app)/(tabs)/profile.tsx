import { PHONE_EMAIL_DOMAIN } from '@farmgo/contracts';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useBadges } from '../../../data/badges';
import { changeLanguage, useSession } from '../../../data/session';
import { downloadMyData } from '../../../features/account/exportData';
import { BuyerStatsCard } from '../../../features/home/BusinessSummary';
import type { Language } from '../../../i18n';
import { PRIVACY_URL, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP, TERMS_URL } from '../../../lib/config';
import { humanError } from '../../../lib/errors';
import { openGuide } from '../../../lib/guide';
import { useRole } from '../../../nav/Shell';
import { type SchemePreference, useSchemePreference, useSizeClass, useTheme } from '../../../theme/theme';
import { Avatar, Card, Pill, Segmented } from '../../../ui/Controls';
import { ListGroup, ListRow } from '../../../ui/ListRow';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { Text } from '../../../ui/Text';

/** Profile: who you are, the business you act for, preferences, help, sign out. */
export default function Profile() {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadMyData();
      toast.success(tr('dataExport.done'));
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setExporting(false);
    }
  };
  const role = useRole();
  const badges = useBadges();
  const me = useSession((s) => s.me);
  const orgId = useSession((s) => s.orgId);
  const signOut = useSession((s) => s.signOut);
  const impersonating = useSession((s) => s.impersonating);
  const { preference, setPreference } = useSchemePreference();

  const user = me?.user;
  const org = me?.organizations.find((o) => o.id === orgId) ?? me?.organizations[0] ?? null;
  const email = user?.email && !user.email.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? user.email : null;
  const contact = [user?.phoneNumber, email].filter(Boolean).join(' · ');
  const isBuyer = role === 'buyer' || role === 'user';
  const isFarmer = role === 'farmer';
  const wide = size !== 'compact';

  const confirmSignOut = async () => {
    const ok = await dialog.confirm({
      title: tr('profile.signOutTitle'),
      message: tr('profile.signOutBody'),
      confirmLabel: tr('common.signOut'),
      icon: 'logout',
    });
    if (ok) {
      await signOut();
      router.replace('/welcome');
    }
  };

  const hero = (
    <Card style={{ gap: 16 }}>
      <View style={styles.hero}>
        <Avatar uri={user?.imageUrl} name={user?.name} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title2" numberOfLines={1}>
            {user?.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill label={tr(`roles.${user?.role ?? 'user'}`)} tone="brand" size="sm" />
            {user?.county ? (
              <Text variant="caption" tone="secondary">
                {user.county}
              </Text>
            ) : null}
          </View>
          {contact ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {contact}
            </Text>
          ) : null}
        </View>
      </View>
      {isFarmer && me?.farmerProfile ? (
        <View style={[styles.kyc, { backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.sm }]}>
          <Text variant="callout" style={{ flex: 1 }}>
            {tr('profile.idCheck')}
          </Text>
          <Pill
            label={tr(`profile.kyc_${me.farmerProfile.kycStatus}`)}
            tone={
              me.farmerProfile.kycStatus === 'VERIFIED'
                ? 'success'
                : me.farmerProfile.kycStatus === 'REJECTED'
                  ? 'danger'
                  : 'warning'
            }
            size="sm"
          />
        </View>
      ) : null}
    </Card>
  );

  const activity = isBuyer ? (
    <View style={{ gap: 8 }}>
      <Text
        variant="micro"
        tone="secondary"
        style={{ paddingHorizontal: 4, textTransform: 'uppercase' }}
        accessibilityRole="header"
      >
        {tr('profile.activity')}
      </Text>
      <BuyerStatsCard />
    </View>
  ) : null;

  const business = org ? (
    <ListGroup title={tr('profile.business')}>
      <ListRow
        key="org"
        icon={org.profile?.buyerCategory === 'HOUSEHOLD' ? 'house' : 'building'}
        label={org.name}
        detail={[org.profile?.town, org.profile?.county].filter(Boolean).join(', ') || undefined}
        value={org.profile?.verified ? tr('profile.verified') : tr('profile.unverified')}
        onPress={() => router.push('/settings/business')}
      />
      {isBuyer ? (
        <ListRow
          key="addresses"
          icon="location"
          label={tr('addresses.title')}
          onPress={() => router.push('/addresses')}
        />
      ) : null}
    </ListGroup>
  ) : null;

  const account = (
    <ListGroup title={tr('profile.account')}>
      <ListRow
        key="edit"
        icon="user"
        label={tr('profile.editProfile')}
        onPress={() => router.push('/settings/profile')}
      />
      <ListRow
        key="notif"
        icon="bell"
        label={tr('profile.notifications')}
        badge={badges.profile}
        onPress={() => router.push('/notifications')}
      />
      <ListRow
        key="notifPrefs"
        icon="settings"
        label={tr('profile.notificationSettings')}
        onPress={() => router.push('/settings/notifications')}
      />
      <ListRow
        key="security"
        icon="lock"
        label={tr('security.title')}
        onPress={() => router.push('/settings/security')}
      />
      {user?.role === 'admin' || impersonating ? (
        <ListRow
          key="viewAs"
          icon="eye"
          label={tr('viewAs.title')}
          detail={tr('viewAs.rowDetail')}
          onPress={() => router.push('/settings/view-as')}
        />
      ) : null}
    </ListGroup>
  );

  const preferences = (
    <ListGroup title={tr('profile.preferences')}>
      <View key="lang" style={styles.prefRow}>
        <Text variant="body" style={{ flex: 1 }}>
          {tr('common.language')}
        </Text>
        <View style={{ width: 200 }}>
          <Segmented<Language>
            value={i18n.language === 'sw' ? 'sw' : 'en'}
            onChange={(l) => void changeLanguage(l)}
            options={[
              { value: 'en', label: tr('common.english') },
              { value: 'sw', label: tr('common.kiswahili') },
            ]}
          />
        </View>
      </View>
      <View key="theme" style={styles.prefRow}>
        <Text variant="body" style={{ flex: 1 }}>
          {tr('profile.appearance')}
        </Text>
        <View style={{ width: 240 }}>
          <Segmented<SchemePreference>
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'system', label: tr('profile.themeSystem') },
              { value: 'light', label: tr('profile.themeLight') },
              { value: 'dark', label: tr('profile.themeDark') },
            ]}
          />
        </View>
      </View>
    </ListGroup>
  );

  const support = (
    <ListGroup title={tr('profile.support')}>
      <ListRow key="guide" icon="book" label={tr('help.guide')} external onPress={() => openGuide(role)} />
      <ListRow key="help" icon="help" label={tr('help.title')} onPress={() => router.push('/help')} />
      {SUPPORT_WHATSAPP ? (
        <ListRow
          key="wa"
          icon="chat"
          label={tr('profile.whatsapp')}
          external
          onPress={() => void Linking.openURL(`https://wa.me/${(SUPPORT_WHATSAPP ?? '').replace(/\D/g, '')}`)}
        />
      ) : null}
      {SUPPORT_PHONE ? (
        <ListRow
          key="call"
          icon="phone"
          label={tr('profile.callUs')}
          value={SUPPORT_PHONE}
          onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
        />
      ) : null}
      {SUPPORT_EMAIL ? (
        <ListRow
          key="mail"
          icon="mail"
          label={tr('profile.emailUs')}
          external
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        />
      ) : null}
      {TERMS_URL ? (
        <ListRow
          key="terms"
          icon="invoice"
          label={tr('profile.terms')}
          external
          onPress={() => void Linking.openURL(TERMS_URL ?? '')}
        />
      ) : null}
      {PRIVACY_URL ? (
        <ListRow
          key="privacy"
          icon="shield"
          label={tr('profile.privacy')}
          external
          onPress={() => void Linking.openURL(PRIVACY_URL ?? '')}
        />
      ) : null}
    </ListGroup>
  );

  const danger = (
    <ListGroup>
      <ListRow
        key="out"
        icon="logout"
        label={tr('common.signOut')}
        tone="danger"
        onPress={confirmSignOut}
        trailing={null}
      />
      <ListRow
        key="export"
        icon="download"
        label={exporting ? tr('dataExport.preparing') : tr('dataExport.title')}
        onPress={exporting ? undefined : exportData}
      />
      <ListRow
        key="delete"
        icon="trash"
        label={tr('deleteAccount.title')}
        tone="danger"
        onPress={() => router.push('/settings/delete-account')}
      />
    </ListGroup>
  );

  return (
    <Screen
      header={<Header title={tr('tabs.profile')} back={false} large={!wide} />}
      maxWidth={wide ? 980 : undefined}
    >
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 8 }}>
          <View style={{ flex: 1, gap: 20 }}>
            {hero}
            {activity}
            {business}
            {account}
          </View>
          <View style={{ flex: 1, gap: 20 }}>
            {preferences}
            {support}
            {danger}
            <Version />
          </View>
        </View>
      ) : (
        <View style={{ gap: 20, paddingTop: 8 }}>
          {hero}
          {activity}
          {business}
          {account}
          {preferences}
          {support}
          {danger}
          <Version />
        </View>
      )}
    </Screen>
  );
}

function Version() {
  const { t: tr } = useTranslation();
  return (
    <Text variant="caption" tone="tertiary" align="center">
      {tr('profile.version', { version: Constants.expoConfig?.version ?? '' })}
    </Text>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  kyc: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexWrap: 'wrap',
  },
});
