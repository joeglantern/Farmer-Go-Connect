import { useLocalSearchParams } from 'expo-router';
import { RouteDetailScreen } from '../../../../features/admin/RouteDetailScreen';

export default function ScreenAdminRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RouteDetailScreen id={id} />;
}
