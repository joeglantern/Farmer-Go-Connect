import type { InputProductDto } from '@farmgo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../../data/session';
import { PhotoStrip, type UploadedPhoto } from '../../../features/qa/PhotoStrip';
import { CATEGORIES, CATEGORY_ICON, useProduct, useSupplierOrg } from '../../../features/supplier/data';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { kes, parseKes, unitLabel } from '../../../lib/format';
import { useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Checkbox, Chip } from '../../../ui/Controls';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { CountyPicker, SelectField } from '../../../ui/Pickers';
import { Header, Screen } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

const UNITS = ['BAG', 'KG', 'LITRE', 'PIECE', 'TRAY', 'CRATE', 'BUNCH'] as const;
type Unit = (typeof UNITS)[number];
type Category = (typeof CATEGORIES)[number];

/** Create (id = "new") or edit a green-input product. */
export default function ProductForm() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const dialog = useDialog();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const org = useSupplierOrg();
  const myCounty = useSession((s) => s.me?.user.county ?? null);
  const product = useProduct(id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('COMPOST');
  const [unit, setUnit] = useState<Unit>('BAG');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [organic, setOrganic] = useState(true);
  const [county, setCounty] = useState<string | null>(org?.profile?.county ?? myCounty);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const p = product.data;
  useEffect(() => {
    if (!p || loaded) return;
    setName(p.name);
    setDescription(p.description ?? '');
    setCategory(p.category);
    setUnit(p.unit as Unit);
    setPrice(String(p.pricePerUnit / 100));
    setStock(String(p.stock));
    setOrganic(p.isOrganic);
    setCounty(p.county);
    setPhotos(p.photos.map((key, i) => ({ key, uri: p.photoUrls[i] ?? '' })).filter((x) => x.uri));
    setLoaded(true);
  }, [p, loaded]);

  const header = (
    <Header
      title={isNew ? tr('supplier.newProduct') : (p?.name ?? tr('supplier.editProduct'))}
      subtitle={isNew ? tr('supplier.newProductSub') : undefined}
    />
  );

  if (!isNew && product.isLoading) {
    return (
      <Screen header={header} maxWidth={t.layout.formMax + 120}>
        <View style={{ gap: 16 }}>
          <Skeleton height={100} radius={14} />
          <Skeleton height={320} radius={14} />
        </View>
      </Screen>
    );
  }
  if (!isNew && product.error) {
    return (
      <Screen header={header}>
        <ErrorState onRetry={() => void product.refetch()} message={humanError(product.error)} />
      </Screen>
    );
  }
  if (!org || (!isNew && p && p.supplierOrgId !== org.id)) {
    return (
      <Screen header={header}>
        <EmptyState
          art="noResults"
          title={tr('supplier.notYours')}
          action={{ label: tr('supplier.backToProducts'), onPress: () => router.back(), icon: 'back' }}
        />
      </Screen>
    );
  }

  const validate = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = tr('supplier.nameRequired');
    if (!parseKes(price)) e.price = tr('supplier.priceRequired');
    const s = Number(stock);
    if (stock === '' || !Number.isFinite(s) || s < 0) e.stock = tr('supplier.stockRequired');
    if (!county) e.county = tr('setup.countyPlaceholder');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      category,
      unit,
      pricePerUnit: parseKes(price)!,
      stock: Number(stock),
      isOrganic: organic,
      photos: photos.map((x) => x.key),
      county,
    };
    try {
      if (isNew) await api.post<InputProductDto>('/v1/inputs', body);
      else await api.patch<InputProductDto>(`/v1/inputs/${id}`, body);
      void qc.invalidateQueries({ queryKey: ['inputs'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(isNew ? tr('supplier.productAdded', { name: body.name }) : tr('supplier.productSaved'));
      router.back();
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!p) return;
    const hide = p.active;
    const ok = await dialog.confirm({
      title: tr(hide ? 'supplier.hideTitle' : 'supplier.showTitle'),
      message: tr(hide ? 'supplier.hideBody' : 'supplier.showBody'),
      confirmLabel: tr(hide ? 'supplier.hide' : 'supplier.show'),
      destructive: hide,
      icon: hide ? 'eyeOff' : 'eye',
    });
    if (!ok) return;
    try {
      await api.patch<InputProductDto>(`/v1/inputs/${p.id}`, { active: !hide });
      void qc.invalidateQueries({ queryKey: ['inputs'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(tr(hide ? 'supplier.hidden' : 'supplier.shown'));
      if (hide) router.back();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const cents = parseKes(price);

  return (
    <Screen
      header={header}
      maxWidth={t.layout.formMax + 120}
      footer={
        <Button
          label={isNew ? tr('supplier.publish') : tr('common.saveChanges')}
          icon="checkCircle"
          size="lg"
          loading={busy}
          onPress={() => void save()}
        />
      }
    >
      <View style={{ gap: 20 }}>
        {formError && <Banner tone="danger" message={formError} />}
        {p && !p.active && (
          <Banner
            tone="warning"
            message={tr('supplier.isHidden')}
            action={{ label: tr('supplier.show'), onPress: () => void toggleActive() }}
          />
        )}

        <Card style={{ gap: 10 }}>
          <Text variant="headline">{tr('supplier.photos')}</Text>
          <Text variant="caption" tone="tertiary">
            {tr('supplier.photosHint')}
          </Text>
          <PhotoStrip bucket="produce-photos" photos={photos} onChange={setPhotos} max={5} size={92} />
        </Card>

        <Card style={{ gap: 16 }}>
          <TextField
            label={tr('supplier.name')}
            placeholder={tr('supplier.namePlaceholder')}
            value={name}
            onChangeText={setName}
            error={errors.name}
            maxLength={120}
            autoCapitalize="sentences"
          />
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('supplier.categoryLabel')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={tr(`supplier.category.${c}`)}
                  icon={CATEGORY_ICON[c]}
                  selected={category === c}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>
          </View>
          <TextField
            label={tr('supplier.description')}
            optional
            placeholder={tr('supplier.descriptionPlaceholder')}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={1000}
          />
          <Checkbox checked={organic} onChange={setOrganic} label={tr('supplier.organicLabel')} />
        </Card>

        <Card style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('supplier.soldBy')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {UNITS.map((u) => (
                <Chip key={u} label={unitLabel(u)} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TextField
              containerStyle={{ flex: 1 }}
              label={tr('supplier.pricePer', { unit: unitLabel(unit) })}
              prefix="KES"
              placeholder="850"
              keyboardType="decimal-pad"
              value={price}
              onChangeText={(v) => setPrice(v.replace(/[^\d.,]/g, ''))}
              error={errors.price}
            />
            <TextField
              containerStyle={{ flex: 1 }}
              label={tr('supplier.inStock')}
              placeholder="40"
              keyboardType="decimal-pad"
              value={stock}
              onChangeText={(v) => setStock(v.replace(/[^\d.]/g, ''))}
              error={errors.stock}
            />
          </View>
          {cents && Number(stock) > 0 ? (
            <Text variant="caption" tone="tertiary" numeric>
              {tr('supplier.stockValue', { value: kes(Math.round(cents * Number(stock))) })}
            </Text>
          ) : null}
          <SelectField
            label={tr('supplier.county')}
            value={county}
            placeholder={tr('setup.countyPlaceholder')}
            onPress={() => setPicker(true)}
            error={errors.county}
            icon="location"
          />
        </Card>

        {p?.active && (
          <Button
            label={tr('supplier.hide')}
            variant="ghost"
            icon="eyeOff"
            onPress={() => void toggleActive()}
          />
        )}
      </View>
      <CountyPicker visible={picker} onClose={() => setPicker(false)} value={county} onSelect={setCounty} />
    </Screen>
  );
}
