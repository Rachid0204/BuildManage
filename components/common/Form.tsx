import React, { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from './Toast';
import { readableError } from '../../utils/formFeedback';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function labelFor(control: Control) {
  return control.labels?.[0]?.textContent?.trim() ||
    control.closest('div')?.querySelector('label')?.textContent?.trim() ||
    control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.name;
}

export function FormNotice({ message }: { message?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { showToast, dismissToast } = useToast();
  useEffect(() => {
    if (!message) return;
    const toastId = showToast(message, 'error');
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // An old validation popup must not contradict a corrected or closed form.
    return () => dismissToast(toastId);
  }, [message, showToast, dismissToast]);
  return message ? <div ref={ref} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 whitespace-pre-line">{message}</div> : null;
}

interface FormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => unknown;
  onBusyChange?: (busy: boolean) => void;
}

/** Localized validation with a visible summary, first-error focus, and draft retention. */
export default function Form({ children, onSubmit, noValidate, onInput, onBusyChange, ...props }: FormProps) {
  const { tr, isAr } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const errorId = useId();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    setError('');
    if (!noValidate) {
      const controls = Array.from(form.elements).filter((el): el is Control => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement);
      const failures = controls.filter(el => el.willValidate && (!el.validity.valid || (el.required && !el.value.trim())));
      if (failures.length) {
        const messages = failures.map(control => {
          control.setAttribute('aria-invalid', 'true');
          const field = labelFor(control) || tr('Ce champ', 'هذا الحقل');
          const reason = control.validity.valueMissing || !control.value.trim()
            ? tr('obligatoire', 'مطلوب')
            : control.validity.typeMismatch ? tr('format invalide', 'صيغة غير صالحة')
            : control.validity.rangeUnderflow ? tr(`minimum : ${control.getAttribute('min')}`, `الحد الأدنى: ${control.getAttribute('min')}`)
            : control.validity.rangeOverflow ? tr(`maximum : ${control.getAttribute('max')}`, `الحد الأقصى: ${control.getAttribute('max')}`)
            : tr('valeur invalide, vérifiez le format demandé', 'قيمة غير صالحة، تحقق من الصيغة المطلوبة');
          return `${field} — ${reason}`;
        });
        setError(tr('Veuillez corriger les champs suivants :', 'يرجى تصحيح الحقول التالية:') + '\n' + messages.join('\n'));
        requestAnimationFrame(() => {
          failures[0].focus({ preventScroll: true });
          failures[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try { await onSubmit?.(event); }
    catch (failure) { setError(readableError(failure, isAr)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  };

  return <form {...props} noValidate onSubmit={submit} aria-busy={busy} aria-describedby={error ? errorId : props['aria-describedby']} onInput={event => {
    const target = event.target as Control;
    if (target.validity?.valid && (!target.required || target.value.trim())) target.removeAttribute('aria-invalid');
    onInput?.(event);
  }}>
    {error && <div id={errorId}><FormNotice message={error} /></div>}
    <fieldset disabled={busy} className="contents">{children}</fieldset>
  </form>;
}
