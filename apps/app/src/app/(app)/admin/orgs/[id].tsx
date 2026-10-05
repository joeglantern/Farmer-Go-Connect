import { useLocalSearchParams } from 'expo-router';
import { OrgDetailScreen } from '../../../../features/admin/OrgDetailScreen';

export default function ScreenAdminOrg() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrgDetailScreen id={id} />;
}
