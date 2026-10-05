import { useLocalSearchParams } from 'expo-router';
import { InvoiceDetailScreen } from '../../../features/buyer/InvoiceDetailScreen';

export default function ScreenInvoice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InvoiceDetailScreen id={id} />;
}
