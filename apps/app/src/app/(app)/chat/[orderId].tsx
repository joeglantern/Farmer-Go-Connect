import { useLocalSearchParams } from 'expo-router';
import { ChatThread } from '../../../features/chat/ChatThread';

export default function ChatScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return <ChatThread orderId={orderId} />;
}
