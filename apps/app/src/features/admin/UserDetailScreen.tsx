import { PLATFORM_ROLES } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, dateShort, timeAgo } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Avatar, Pill, RadioRow } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Skeleton } from '../../ui/Skeleton';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { type AdminUserDetail, useAdminMutations, useAdminUser, useFileUrl } from './data';
import {
  AdminPage,
  Columns,
  DetailState,
  Facts,
  goOrg,
  LinkRow,
  MutationError,
  Section,
  StatusPill,
} from './ui';

/** APP_SPEC screen 57 detail: user, role, ban, KYC review with the ID image. */
export function UserDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const user = useAdminUser(id);
  const u = user.data;
  const [roleOpen, setRoleOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);

  return (
    <AdminPage
      title={u?.name ?? tr('admin.user.title')}
      back
      refreshing={user.isRefetching}
      onRefresh={() => user.refetch()}
    >
      {!u ? (
        <DetailState
          loading={user.isLoading}
          error={user.error}
          onRetry={() => user.refetch()}
          notFound={tr('admin.user.notFound')}
        />
      ) : (
        <Columns ratio={[1.1, 1]}>
          <View style={{ gap: 16 }}>
            <ProfileCard user={u} onChangeRole={() => setRoleOpen(true)} onBan={() => setBanOpen(true)} />
            {u.farmerProfile && <KycCard user={u} />}
          </View>
          <View style={{ gap: 16 }}>
            <Section title={tr('admin.user.memberships')}>
              {u.members.length === 0 ? (
                <Text variant="callout" tone="secondary">
                  {tr('admin.user.noMemberships')}
                </Text>
              ) : (
                u.members.map((m) => (
                  <LinkRow
                    key={m.id}
                    label={m.organization.name}
                    hint={`${tr(`admin.org.types.${m.organization.profile?.buyerCategory ?? m.organization.profile?.type ?? 'BUYER'}`, { defaultValue: '' })} · ${tr('admin.user.memberRole', { role: m.role })}`}
                    onPress={() => goOrg(m.organizationId)}
                  />
                ))
              )}
            </Section>
            {u.farmerProfile && (
              <Section title={tr('admin.user.farms')}>
                {u.farmerProfile.farms.length === 0 ? (
                  <Text variant="callout" tone="secondary">
                    {tr('admin.user.noFarms')}
                  </Text>
                ) : (
                  u.farmerProfile.farms.map((f) => (
                    <View
                      key={f.id}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
                    >
                      <Icon name="farm" size={18} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong">{f.name}</Text>
                        <Text variant="caption" tone="secondary">
                          {f.county}
                          {f.ward ? `, ${f.ward}` : ''}
                          {f.acreage ? ` · ${f.acreage} ac` : ''}
                          {f.isOrganic ? ` · ${tr('shop.organic')}` : ''}
                        </Text>
                      </View>
                      <StatusPill status={f.active ? 'ACTIVE' : 'INACTIVE'} size="sm" />
                    </View>
                  ))
                )}
              </Section>
            )}
            <Section title={tr('admin.user.sessions')}>
              {u.sessions.length === 0 ? (
                <Text variant="callout" tone="secondary">
                  {tr('admin.user.noSessions')}
                </Text>
              ) : (
                u.sessions.slice(0, 8).map((s) => (
                  <View
                    key={s.id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}
                  >
                    <Icon
                      name={/mobile|android|iphone|expo/i.test(s.userAgent ?? '') ? 'phone' : 'globe'}
                      size={16}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="callout" numberOfLines={1}>
                        {s.userAgent ? s.userAgent.split(' ')[0] : tr('admin.user.device')}
                        {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                      </Text>
                      <Text variant="caption" tone="tertiary" numeric>
                        {tr('admin.user.lastSeen', { when: timeAgo(s.createdAt) })}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Section>
          </View>
        </Columns>
      )}
      {u && <RoleSheet user={u} visible={roleOpen} onClose={() => setRoleOpen(false)} />}
      {u && <BanSheet user={u} visible={banOpen} onClose={() => setBanOpen(false)} />}
    </AdminPage>
  );
}

function ProfileCard({
  user: u,
  onChangeRole,
  onBan,
}: {
  user: AdminUserDetail;
  onChangeRole: () => void;
  onBan: () => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { ban } = useAdminMutations();
  const phoneOnly = u.email.endsWith('phone.farmgo.local');

  const unban = async () => {
    const ok = await dialog.confirm({
      title: tr('admin.user.unbanConfirm', { name: u.name }),
      message: tr('admin.user.unbanBody'),
      confirmLabel: tr('admin.user.unban'),
      icon: 'checkCircle',
    });
    if (!ok) return;
    try {
      await ban.mutateAsync({ id: u.id, banned: false, reason: tr('admin.user.unbanReason') });
      toast.success(tr('admin.user.banLifted', { name: u.name }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Section>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={u.name} uri={u.imageUrl} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title2" accessibilityRole="header">
            {u.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={tr(`roles.${u.role ?? 'user'}`)} tone={u.role === 'admin' ? 'brand' : 'neutral'} />
            <StatusPill status={u.banned ? 'BANNED' : 'ACTIVE'} />
            {u.twoFactorEnabled && <Pill label={tr('admin.user.twoStep')} tone="success" icon="shield" />}
          </View>
        </View>
      </View>
      {u.banned && (
        <Banner
          tone="danger"
          title={tr('admin.user.banned')}
          message={
            u.banReason
              ? tr('admin.user.bannedReason', { reason: u.banReason })
              : tr('admin.user.bannedNoReason')
          }
        />
      )}
      <Facts
        rows={[
          { label: tr('admin.common.email'), value: phoneOnly ? tr('admin.user.phoneOnly') : u.email },
          {
            label: tr('admin.common.phone'),
            value: u.phoneNumber ?? tr('admin.common.notSet'),
            numeric: true,
          },
          { label: tr('admin.common.county'), value: u.county ?? tr('admin.common.notSet') },
          {
            label: tr('common.language'),
            value: u.preferredLanguage === 'sw' ? tr('common.kiswahili') : tr('common.english'),
          },
          { label: tr('admin.user.since'), value: dateLong(u.createdAt) },
          { label: tr('admin.common.id'), value: u.id, numeric: true },
        ]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          label={tr('admin.user.changeRole')}
          icon="edit"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={onChangeRole}
        />
        {u.banned ? (
          <Button
            label={tr('admin.user.unban')}
            icon="checkCircle"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={unban}
            loading={ban.isPending}
          />
        ) : (
          <Button
            label={tr('admin.user.ban')}
            icon="warning"
            size="sm"
            variant="danger"
            fullWidth={false}
            onPress={onBan}
          />
        )}
      </View>
    </Section>
  );
}

function RoleSheet({
  user: u,
  visible,
  onClose,
}: {
  user: AdminUserDetail;
  visible: boolean;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { setRole } = useAdminMutations();
  const [role, setRoleValue] = useState<string>(u.role ?? 'user');

  const submit = async () => {
    if (role === u.role) return onClose();
    const ok = await dialog.confirm({
      title: tr('admin.user.setRoleConfirmTitle', { role: tr(`roles.${role}`) }),
      message: tr('admin.user.setRoleConfirmBody', { name: u.name, role: tr(`roles.${role}`) }),
      confirmLabel: tr('admin.user.changeRole'),
      icon: 'user',
    });
    if (!ok) return;
    try {
      await setRole.mutateAsync({ id: u.id, role });
      toast.success(tr('admin.user.roleUpdated', { name: u.name, role: tr(`roles.${role}`) }));
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('admin.user.changeRole')}
      subtitle={tr('admin.user.pickRole')}
      footer={
        <Button
          label={tr('admin.user.changeRole')}
          onPress={submit}
          loading={setRole.isPending}
          disabled={role === u.role}
        />
      }
    >
      {PLATFORM_ROLES.map((r) => (
        <RadioRow
          key={r}
          label={tr(`roles.${r}`)}
          description={tr(`admin.user.roleHints.${r}`, { defaultValue: '' })}
          selected={role === r}
          onPress={() => setRoleValue(r)}
        />
      ))}
      <MutationError error={setRole.error} />
    </Sheet>
  );
}

function BanSheet({
  user: u,
  visible,
  onClose,
}: {
  user: AdminUserDetail;
  visible: boolean;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { ban } = useAdminMutations();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 3) return setError(tr('admin.user.banReasonRequired'));
    setError(null);
    const ok = await dialog.confirm({
      title: tr('admin.user.banConfirm', { name: u.name }),
      message: tr('admin.user.banConfirmBody'),
      confirmLabel: tr('admin.user.ban'),
      destructive: true,
      icon: 'warning',
    });
    if (!ok) return;
    try {
      await ban.mutateAsync({ id: u.id, banned: true, reason: reason.trim() });
      toast.success(tr('admin.user.banApplied', { name: u.name }));
      setReason('');
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('admin.user.banTitle', { name: u.name })}
      subtitle={tr('admin.user.banBody')}
      footer={
        <Button label={tr('admin.user.ban')} variant="danger" onPress={submit} loading={ban.isPending} />
      }
    >
      <TextField
        label={tr('admin.user.banReasonLabel')}
        placeholder={tr('admin.user.banReasonPlaceholder')}
        value={reason}
        onChangeText={setReason}
        error={error}
        multiline
        numberOfLines={3}
        autoFocus
      />
      <MutationError error={ban.error} />
    </Sheet>
  );
}

function KycCard({ user: u }: { user: AdminUserDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const dialog = useDialog();
  const toast = useToast();
  const { reviewKyc } = useAdminMutations();
  const fp = u.farmerProfile!;
  const image = useFileUrl(fp.nationalIdKey);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [full, setFull] = useState(false);

  const decide = async (status: 'VERIFIED' | 'REJECTED') => {
    const ok = await dialog.confirm({
      title:
        status === 'VERIFIED'
          ? tr('admin.user.approveConfirm', { name: u.name })
          : tr('admin.user.rejectConfirm', { name: u.name }),
      message: status === 'VERIFIED' ? tr('admin.user.approveBody') : tr('admin.user.rejectBody'),
      confirmLabel: status === 'VERIFIED' ? tr('admin.user.approve') : tr('admin.user.reject'),
      destructive: status === 'REJECTED',
      icon: 'idCard',
    });
    if (!ok) return;
    try {
      await reviewKyc.mutateAsync({
        farmerProfileId: fp.id,
        status,
        note: note.trim() || undefined,
        userId: u.id,
      });
      toast.success(
        tr(status === 'VERIFIED' ? 'admin.user.kycApproved' : 'admin.user.kycRejected', { name: u.name }),
      );
      setRejecting(false);
      setNote('');
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Section title={tr('admin.user.kyc')} action={<StatusPill status={fp.kycStatus} />}>
      <Facts
        rows={[
          { label: tr('admin.user.mpesa'), value: fp.mpesaNumber, numeric: true },
          {
            label: tr('admin.user.dob'),
            value: fp.dateOfBirth ? dateShort(fp.dateOfBirth) : tr('admin.common.notSet'),
          },
          {
            label: tr('admin.user.gender'),
            value: tr(`admin.user.genders.${fp.gender}`, { defaultValue: fp.gender }),
          },
          { label: tr('admin.user.ordersCompleted'), value: fp.ordersCompleted, numeric: true },
          { label: tr('admin.user.qaPassRate'), value: `${Math.round(fp.qaPassRate * 100)}%`, numeric: true },
          { label: tr('admin.user.onTimeRate'), value: `${Math.round(fp.onTimeRate * 100)}%`, numeric: true },
        ]}
        columns={3}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.user.idDocument')}</Text>
        {!fp.nationalIdKey ? (
          <Text variant="callout" tone="secondary">
            {tr('admin.user.noIdDocument')}
          </Text>
        ) : image.isLoading ? (
          <Skeleton height={220} radius={12} />
        ) : image.error || !image.data ? (
          <Banner
            tone="warning"
            message={tr('admin.user.idLoadFailed')}
            action={{ label: tr('common.retry'), onPress: () => image.refetch() }}
          />
        ) : (
          <View style={{ gap: 8 }}>
            <View
              style={{
                borderRadius: t.radius.md,
                overflow: 'hidden',
                backgroundColor: t.colors.surfaceMuted,
                height: full ? 520 : 240,
              }}
              accessibilityRole="image"
              accessibilityLabel={tr('admin.user.idDocument')}
            >
              <Image
                source={{ uri: image.data.url }}
                style={{ width: '100%', height: '100%' }}
                contentFit={full ? 'contain' : 'cover'}
                transition={150}
              />
            </View>
            <Button
              label={full ? tr('admin.user.idShrink') : tr('admin.user.idEnlarge')}
              size="sm"
              variant="ghost"
              fullWidth={false}
              icon={full ? 'chevronUp' : 'chevronDown'}
              onPress={() => setFull((v) => !v)}
            />
          </View>
        )}
      </View>
      {fp.kycStatus !== 'VERIFIED' && (
        <View style={{ gap: 10 }}>
          {rejecting && (
            <TextField
              label={tr('admin.user.kycNoteLabel')}
              placeholder={tr('admin.user.kycNotePlaceholder')}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
              autoFocus
            />
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label={tr('admin.user.approve')}
              icon="check"
              size="sm"
              fullWidth={false}
              onPress={() => decide('VERIFIED')}
              loading={reviewKyc.isPending && reviewKyc.variables?.status === 'VERIFIED'}
            />
            {rejecting ? (
              <Button
                label={tr('admin.user.reject')}
                icon="close"
                size="sm"
                variant="danger"
                fullWidth={false}
                onPress={() => decide('REJECTED')}
                loading={reviewKyc.isPending && reviewKyc.variables?.status === 'REJECTED'}
              />
            ) : (
              <Button
                label={tr('admin.user.reject')}
                icon="close"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => setRejecting(true)}
              />
            )}
          </View>
        </View>
      )}
      <MutationError error={reviewKyc.error} />
    </Section>
  );
}
