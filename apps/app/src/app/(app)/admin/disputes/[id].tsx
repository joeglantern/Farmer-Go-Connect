import { useLocalSearchParams } from 'expo-router';
import { DisputeDetailScreen } from '../../../../features/admin/DisputeDetailScreen';

export default function ScreenAdminDispute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DisputeDetailScreen id={id} />;
}
