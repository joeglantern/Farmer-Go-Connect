import { ProduceCategory, ProduceInput, ProduceUpdateInput, Unit } from '@farmgo/contracts';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { produceName, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Chip, Switch } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';
import { SearchField, TextField } from '../../ui/TextField';
import { type Column, DataTable } from './DataTable';
import { type Produce, useAdminMutations, useCatalog } from './data';
import { AdminPage, MutationError, StatusPill } from './ui';

const CATEGORIES = ProduceCategory.options;
const UNITS = Unit.options;

/** APP_SPEC screen 60: produce catalog (list, add, edit). */
export function CatalogScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [editing, setEditing] = useState<Produce | 'new' | null>(null);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const query = useCatalog(debounced, category);
  const rows = query.data ?? [];

  const columns: Column<Produce>[] = [
    {
      key: 'name',
      title: tr('admin.catalog.col.produce'),
      flex: 2,
      primary: true,
      sort: (p) => p.name.toLowerCase(),
      render: (p) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <ProduceImage uri={p.imageUrl} category={p.category} produce={p} size={36} radius={8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {p.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {p.nameSw}
            </Text>
          </View>
        </View>
      ),
    },
    {
      key: 'category',
      title: tr('admin.catalog.col.category'),
      sort: (p) => p.category,
      render: (p) => (
        <Text variant="callout">
          {tr(`admin.catalog.categories.${p.category}`, { defaultValue: p.category })}
        </Text>
      ),
    },
    {
      key: 'unit',
      title: tr('admin.catalog.col.unit'),
      width: 80,
      sort: (p) => p.unit,
      render: (p) => <Text variant="callout">{unitLabel(p.unit)}</Text>,
    },
    {
      key: 'grades',
      title: tr('admin.catalog.col.grades'),
      width: 110,
      hideBelow: 'expanded',
      render: (p) => (
        <Text variant="callout" numeric>
          {p.grades.join(', ')}
        </Text>
      ),
    },
    {
      key: 'shelf',
      title: tr('admin.catalog.col.shelfLife'),
      width: 110,
      align: 'right',
      hideBelow: 'expanded',
      sort: (p) => p.shelfLifeDays,
      render: (p) => (
        <Text variant="callout" numeric>
          {tr('admin.catalog.days', { count: p.shelfLifeDays })}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 110,
      render: (p) => <StatusPill status={p.active ? 'ACTIVE' : 'INACTIVE'} size="sm" />,
    },
  ];

  return (
    <AdminPage
      title={tr('admin.catalog.title')}
      subtitle={tr('admin.catalog.subtitle')}
      back
      scroll={false}
      actions={
        <Button
          label={tr('admin.catalog.add')}
          icon="plus"
          size="sm"
          fullWidth={false}
          onPress={() => setEditing('new')}
        />
      }
    >
      <DataTable
        rows={rows}
        columns={columns}
        keyOf={(p) => p.id}
        onRowPress={(p) => setEditing(p)}
        rowLabel={(p) => `${produceName(p)}, ${tr('common.edit')}`}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
        defaultSort={{ key: 'name', dir: 'asc' }}
        empty={{
          art: 'noListings',
          title: tr('admin.catalog.empty'),
          body: tr('admin.catalog.emptyBody'),
          action: { label: tr('admin.catalog.add'), onPress: () => setEditing('new') },
        }}
        header={
          <View style={{ gap: 10, paddingBottom: 12 }}>
            <SearchField value={q} onChangeText={setQ} placeholder={tr('admin.catalog.search')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip
                label={tr('admin.catalog.allCategories')}
                selected={!category}
                onPress={() => setCategory(undefined)}
              />
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={tr(`admin.catalog.categories.${c}`, { defaultValue: c })}
                  selected={category === c}
                  onPress={() => setCategory(category === c ? undefined : c)}
                />
              ))}
            </ScrollView>
            <Text variant="caption" style={{ color: t.colors.textTertiary }}>
              {tr('admin.catalog.note')}
            </Text>
          </View>
        }
      />
      <ProduceSheet produce={editing} onClose={() => setEditing(null)} />
    </AdminPage>
  );
}

interface Form {
  name: string;
  nameSw: string;
  slug: string;
  category: string;
  unit: string;
  grades: string;
  shelfLifeDays: string;
  active: boolean;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function ProduceSheet({ produce, onClose }: { produce: Produce | 'new' | null; onClose: () => void }) {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const t = useTheme();
  const size = useSizeClass();
  const { createProduce, updateProduce } = useAdminMutations();
  const isNew = produce === 'new';
  const existing = produce && produce !== 'new' ? produce : null;
  const [form, setForm] = useState<Form>(blank());
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!produce) return;
    setErrors({});
    setSlugTouched(!!existing);
    setForm(
      existing
        ? {
            name: existing.name,
            nameSw: existing.nameSw,
            slug: existing.slug,
            category: existing.category,
            unit: existing.unit,
            grades: existing.grades.join(', '),
            shelfLifeDays: String(existing.shelfLifeDays),
            active: existing.active,
          }
        : blank(),
    );
  }, [produce, existing]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const body = {
      name: form.name.trim(),
      nameSw: form.nameSw.trim(),
      slug: form.slug.trim(),
      category: form.category,
      unit: form.unit,
      grades: form.grades
        .split(',')
        .map((g) => g.trim().toUpperCase())
        .filter(Boolean),
      shelfLifeDays: Number(form.shelfLifeDays),
      active: form.active,
    };
    const parsed = (isNew ? ProduceInput : ProduceUpdateInput).safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!e[key]) e[key] = tr(`admin.catalog.errors.${key}`, { defaultValue: issue.message });
      }
      setErrors(e);
      return;
    }
    setErrors({});
    try {
      if (isNew) {
        const p = await createProduce.mutateAsync(parsed.data);
        toast.success(tr('admin.catalog.created', { name: p.name }));
      } else if (existing) {
        const p = await updateProduce.mutateAsync({ id: existing.id, body: parsed.data });
        toast.success(tr('admin.catalog.updated', { name: p.name }));
      }
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const busy = createProduce.isPending || updateProduce.isPending;
  const two = size !== 'compact';

  return (
    <Sheet
      visible={!!produce}
      onClose={onClose}
      title={
        isNew ? tr('admin.catalog.addTitle') : tr('admin.catalog.editTitle', { name: existing?.name ?? '' })
      }
      dismissible={!busy}
      maxWidth={640}
      footer={
        <Button
          label={isNew ? tr('admin.catalog.create') : tr('common.saveChanges')}
          onPress={submit}
          loading={busy}
        />
      }
    >
      <View style={{ flexDirection: two ? 'row' : 'column', gap: 12 }}>
        <TextField
          containerStyle={{ flex: 1 }}
          label={tr('admin.catalog.name')}
          value={form.name}
          onChangeText={(v) => {
            set('name', v);
            if (!slugTouched) set('slug', slugify(v));
          }}
          error={errors.name}
          autoCapitalize="words"
          placeholder="Tomatoes"
        />
        <TextField
          containerStyle={{ flex: 1 }}
          label={tr('admin.catalog.nameSw')}
          value={form.nameSw}
          onChangeText={(v) => set('nameSw', v)}
          error={errors.nameSw}
          autoCapitalize="words"
          placeholder="Nyanya"
        />
      </View>
      <TextField
        label={tr('admin.catalog.slug')}
        value={form.slug}
        onChangeText={(v) => {
          setSlugTouched(true);
          set('slug', slugify(v));
        }}
        error={errors.slug}
        hint={tr('admin.catalog.slugHint')}
        autoCapitalize="none"
        editable={isNew}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.catalog.category')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={tr(`admin.catalog.categories.${c}`, { defaultValue: c })}
              selected={form.category === c}
              onPress={() => set('category', c)}
            />
          ))}
        </View>
        {errors.category && (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {errors.category}
          </Text>
        )}
      </View>
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.catalog.unit')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {UNITS.map((u) => (
            <Chip key={u} label={unitLabel(u)} selected={form.unit === u} onPress={() => set('unit', u)} />
          ))}
        </View>
        {errors.unit && (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {errors.unit}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: two ? 'row' : 'column', gap: 12 }}>
        <TextField
          containerStyle={{ flex: 1 }}
          label={tr('admin.catalog.grades')}
          value={form.grades}
          onChangeText={(v) => set('grades', v)}
          error={errors.grades}
          hint={tr('admin.catalog.gradesHint')}
          autoCapitalize="characters"
          placeholder="A, B, C"
        />
        <TextField
          containerStyle={{ flex: 1 }}
          label={tr('admin.catalog.shelfLife')}
          value={form.shelfLifeDays}
          onChangeText={(v) => set('shelfLifeDays', v.replace(/\D/g, ''))}
          error={errors.shelfLifeDays}
          hint={tr('admin.catalog.shelfLifeHint')}
          keyboardType="number-pad"
        />
      </View>
      <Switch
        value={form.active}
        onChange={(v) => set('active', v)}
        label={tr('admin.catalog.active')}
        description={tr('admin.catalog.activeHint')}
      />
      <MutationError error={createProduce.error ?? updateProduce.error} />
      {!isNew && existing && (
        <Pressable
          onPress={async () => {
            try {
              await Clipboard.setStringAsync(existing.id);
              toast.success(tr('admin.catalog.idCopied'));
            } catch {
              toast.error(tr('admin.catalog.copyFailed'));
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={tr('admin.catalog.copyId', { id: existing.id })}
          style={{
            alignSelf: 'flex-start',
            minHeight: 44,
            justifyContent: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="copy" size={14} color={t.colors.textTertiary} />
          <Text variant="caption" tone="tertiary" numeric selectable>
            {tr('admin.catalog.idLabel', { id: existing.id })}
          </Text>
        </Pressable>
      )}
    </Sheet>
  );
}

function blank(): Form {
  return {
    name: '',
    nameSw: '',
    slug: '',
    category: 'VEGETABLE',
    unit: 'KG',
    grades: 'A, B, C',
    shelfLifeDays: '7',
    active: true,
  };
}
