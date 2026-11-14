import React from 'react';
import Card from './Card';
import Button from './Button';
interface RouteErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RouteErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur inattendue lors du chargement de la vue.',
    };
  }

  render() {
    if (this.state.hasError) {
      const isAr =
        typeof window !== 'undefined' &&
        (document.documentElement.lang === 'ar' ||
          localStorage.getItem('syndik_lang') === 'ar');
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6" dir={isAr ? 'rtl' : 'ltr'}>
          <Card className="max-w-md w-full border border-rose-200 bg-rose-50/40 text-center space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              {isAr
                ? 'حدث خطأ غير متوقع أثناء تحميل هذه الصفحة'
                : 'Une erreur est survenue lors du chargement du module'}
            </h2>
            <p className="text-xs text-slate-600 font-mono">
              {this.state.errorMessage ||
                (isAr ? 'خطأ غير متوقع.' : 'Erreur inattendue lors du chargement de la vue.')}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: null });
                  window.location.reload();
                }}
              >
                {isAr ? 'تحديث الصفحة' : 'Actualiser la page'}
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}


export default RouteErrorBoundary;
