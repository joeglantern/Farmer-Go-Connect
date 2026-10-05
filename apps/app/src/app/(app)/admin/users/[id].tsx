import { useLocalSearchParams } from 'expo-router';
import { UserDetailScreen } from '../../../../features/admin/UserDetailScreen';

export default function ScreenAdminUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <UserDetailScreen id={id} />;
}
