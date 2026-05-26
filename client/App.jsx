import SafeID from './SafeID';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <SafeID />
    </AuthProvider>
  );
}
