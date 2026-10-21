import React from 'react';
import ReactDOM from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { notifyOperation } from './utils/formFeedback';
import App from './App';
import { I18nProvider } from './hooks/useI18n';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/common/Toast';

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error) => notifyOperation({ operation: 'save', error: error instanceof Error ? error.message || 'Enregistrement impossible.' : String(error || 'Enregistrement impossible.') }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
