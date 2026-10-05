import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, kes } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Segmented, Switch } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Text } from '../../ui/Text';
import { type AdminOrgDetail, useAdminMutations, useAdminOrg } from './data';
import {
  AdminPage,
  Columns,
  DetailState,
  Facts,
  goUser,
  LinkRow,
  MoneyField,
  MutationError,
  Section,
  StatCard,
  StatGrid,
  StatusPill,
} from './ui';

const TERMS = ['PREPAID', 'NET_7', 'NET_14', 'NET_30'] as const;
type Terms = (typeof TERMS)[number];

/** APP_SPEC screen 57 detail: organization verification, payment terms, credit limit. */
export function OrgDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const org = useAdminOrg(id);
  const o = org.data;
  return (
    <AdminPage
      title={o?.name ?? tr('admin.org.title')}
      back
      refreshing={org.isRefetching}
      onRefresh={() => org.refetch()}
    >
      {!o ? (
        <DetailState
          loading={org.isLoading}
          error={org.error}
          onRetry={() => org.refetch()}
          notFound={tr('admin.org.notFound')}
        />
      ) : (
        <Body org={o} />
      )}
    </AdminPage>
  );
}

function Body({ org: o }: { org: AdminOrgDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const p = o.profile;
  return (
    <Columns ratio={[1.1, 1]}>
      <Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: t.colors.primaryTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name={
                p?.type === 'INPUT_SUPPLIER' ? 'sprout' : p?.type === 'FARMER_GROUP' ? 'users' : 'building'
              }
              size={26}
              color={t.colors.primary}
              weight="fill"
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title2" accessibilityRole="header">
              {o.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {p && <StatusPill status={p.verified ? 'VERIFIED' : 'PENDING'} />}
              {p && <StatusPill status={p.paymentTerms} />}
            </View>
          </View>
        </View>
        {!p ? (
          <Banner tone="warning" message={tr('admin.org.noProfile')} />
        ) : (
          <Facts
            rows={[
              {
                label: tr('admin.org.category'),
                value: tr(`admin.org.types.${p.buyerCategory ?? p.type}`, { defaultValue: p.type }),
              },
              { label: tr('admin.common.county'), value: `${p.county}${p.town ? `, ${p.town}` : ''}` },
              { label: tr('admin.org.address'), value: p.address ?? tr('admin.common.notSet') },
              { label: tr('admin.common.phone'), value: p.phone ?? tr('admin.common.notSet'), numeric: true },
              { label: tr('admin.common.email'), value: p.email ?? tr('admin.common.notSet') },
              { label: tr('admin.org.kraPin'), value: p.kraPin ?? tr('admin.common.notSet'), numeric: true },
              { label: tr('admin.org.since'), value: dateLong(o.createdAt) },
              { label: tr('admin.common.id'), value: o.id, numeric: true },
            ]}
          />
        )}
      </Section>
      <View style={{ gap: 16 }}>
        <Activity org={o} />
        {p && <VerifyForm org={o} />}
        <Members org={o} />
      </View>
    </Columns>
  );
}

/** Activity from GET /v1/admin/orgs/:id: buyer spend and orders, or supplier products and orders. */
function Activity({ org: o }: { org: AdminOrgDetail }) {
  const { t: tr } = useTranslation();
  const st = o.stats;
  const supplier = o.profile?.type === 'INPUT_SUPPLIER';
  return (
    <Section title={tr('admin.org.activity')}>
      {supplier ? (
        <StatGrid min={2}>
          <StatCard
            label={tr('admin.org.productsActive')}
            value={st.productsActive}
            icon="sprout"
            tone="success"
          />
          <StatCard
            label={tr('admin.org.inputOrders')}
            value={st.inputOrdersTotal}
            icon="orders"
            tone="brand"
          />
        </StatGrid>
      ) : (
        <StatGrid min={2}>
          <StatCard label={tr('admin.org.ordersTotal')} value={st.ordersTotal} icon="orders" tone="brand" />
          <StatCard label={tr('admin.org.ordersOpen')} value={st.ordersOpen} icon="timer" tone="info" />
          <StatCard label={tr('admin.org.demandOpen')} value={st.demandOpen} icon="megaphone" tone="info" />
          <StatCard label={tr('admin.org.spend')} value={kes(st.spendCents)} icon="wallet" tone="success" />
          <StatCard
            label={tr('admin.org.invoicesDue')}
            value={kes(st.invoicesDueCents)}
            icon="invoice"
            tone={st.invoicesDueCents > 0 ? 'warning' : 'neutral'}
          />
        </StatGrid>
      )}
    </Section>
  );
}

function Members({ org: o }: { org: AdminOrgDetail }) {
  const { t: tr } = useTranslation();
  return (
    <Section title={tr('admin.org.membersTitle', { count: o.members.length })}>
      {o.members.length === 0 ? (
        <Text variant="callout" tone="secondary">
          {tr('admin.org.noMembers')}
        </Text>
      ) : (
        o.members.map((m) => (
          <LinkRow
            key={m.id}
            label={m.user.name}
            hint={[
              tr(`admin.user.memberRole`, { role: m.role }),
              m.user.role ? tr(`roles.${m.user.role}`) : null,
              m.user.phoneNumber ?? m.user.email,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => goUser(m.user.id)}
            icon="user"
          />
        ))
      )}
    </Section>
  );
}

function VerifyForm({ org: o }: { org: AdminOrgDetail }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { verifyOrg } = useAdminMutations();
  const p = o.profile!;
  const household = p.buyerCategory === 'HOUSEHOLD';
  const buyer = p.type === 'BUYER';
  const [verified, setVerified] = useState(p.verified);
  const [terms, setTerms] = useState<Terms>(p.paymentTerms);
  const [limit, setLimit] = useState<number | null>(p.creditLimit);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setVerified(p.verified);
    setTerms(p.paymentTerms);
    setLimit(p.creditLimit);
  }, [p.verified, p.paymentTerms, p.creditLimit]);

  const credit = terms !== 'PREPAID';
  const dirty = verified !== p.verified || terms !== p.paymentTerms || (limit ?? 0) !== p.creditLimit;

  const submit = async () => {
    if (credit && (!limit || limit <= 0)) return setError(tr('admin.org.creditInvalid'));
    setError(null);
    const nextLimit = credit ? (limit ?? 0) : 0;
    const ok = await dialog.confirm({
      title: tr('admin.org.confirmTitle', { name: o.name }),
      message: tr('admin.org.confirmBody', {
        verified: verified ? tr('admin.status.VERIFIED') : tr('admin.org.unverified'),
        terms: tr(`admin.status.${terms}`),
        limit: credit ? kes(nextLimit) : tr('admin.common.none'),
      }),
      confirmLabel: tr('common.saveChanges'),
      destructive: p.verified && !verified,
      icon: 'shield',
    });
    if (!ok) return;
    try {
      await verifyOrg.mutateAsync({
        id: o.id,
        verified,
        paymentTerms: buyer ? terms : undefined,
        creditLimit: buyer ? nextLimit : undefined,
      });
      toast.success(tr('admin.org.saved', { name: o.name }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Section title={tr('admin.org.verifyTitle')}>
      <Switch
        value={verified}
        onChange={setVerified}
        label={tr('admin.org.verified')}
        description={tr('admin.org.verifiedHint')}
      />
      {buyer && (
        <>
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('admin.org.terms')}</Text>
            {household ? (
              <Banner tone="info" message={tr('admin.org.household')} />
            ) : (
              <Segmented
                value={terms}
                onChange={setTerms}
                options={TERMS.map((v) => ({ value: v, label: tr(`admin.status.${v}`) }))}
              />
            )}
            <Text variant="caption" tone="tertiary">
              {tr('admin.org.termsHint')}
            </Text>
          </View>
          {credit && !household && (
            <MoneyField
              key={String(p.creditLimit)}
              label={tr('admin.org.creditLimit')}
              cents={limit}
              onChangeCents={setLimit}
              hint={tr('admin.org.creditLimitHint')}
              error={error}
            />
          )}
        </>
      )}
      <MutationError error={verifyOrg.error} />
      <Button
        label={tr('common.saveChanges')}
        onPress={submit}
        disabled={!dirty}
        loading={verifyOrg.isPending}
        size="md"
        icon="check"
      />
    </Section>
  );
}
